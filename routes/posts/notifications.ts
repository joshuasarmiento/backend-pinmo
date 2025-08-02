import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import { authenticate } from '../../middleware/auth';
import { invalidateNotificationCache, autoInvalidateCache } from '../../utils/cache'
import NodeCache from 'node-cache';

const router = Router();

// Create cache instance (TTL in seconds)
const cache = new NodeCache({ 
  stdTTL: 60, // 1 minute default TTL
  checkperiod: 120 // Check for expired keys every 2 minutes
});


// Get notifications for a user
router.get('/notifications', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = '1', limit = '10' } = req.query;

    console.log('Fetching notifications for user:', userId);

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Create cache key
    const cacheKey = `notifications:${userId}:${page}:${limit}`;

    // Try to get from cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Returning cached notifications for user:', userId);
      return res.json(cached);
    }

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Get unique source_user_ids
    const sourceUserIds = [...new Set(notifications.map(n => n.source_user_id).filter(Boolean))];

    // Fetch user data separately
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, full_name, email, profile_picture')
      .in('id', sourceUserIds);

    if (usersError) {
      console.error('Users fetch error:', usersError);
    }

    // Create a map for quick lookup
    const usersMap: Record<string, any> = (users || []).reduce((map: Record<string, any>, user: any) => {
      map[user.id] = user;
      return map;
      }, {});

    // Map users to notifications
    const notificationsWithUsers = notifications.map((notification: any) => ({
    ...notification,
    source_user: usersMap[notification.source_user_id] || {
      id: notification.source_user_id,
      full_name: 'Anonymous',
      email: 'unknown@example.com',
      profile_picture: null,
    },
    }));

    const { count, error: countError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      console.error('Count error:', countError);
      return res.status(500).json({ error: 'Failed to get notifications count' });
    }

    console.log('Notifications fetched:', notificationsWithUsers.length);
    console.log('Notifications User:', notificationsWithUsers);

    const result = {
      notifications: notificationsWithUsers,
      hasMore: notificationsWithUsers.length === limitNum,
      total: count || 0,
    };

    // Cache the result for 1 minute
    cache.set(cacheKey, result, 60);
    console.log('Cached notifications for user:', userId);

    res.json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', authenticate, autoInvalidateCache(req => req.user.id), async (req: Request, res: Response) => {
  try {
    const notificationId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Marking notification as read:', notificationId);

    const { data: notification, error: fetchError } = await supabase
      .from('notifications')
      .select('user_id')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) {
      console.log('Notification not found:', notificationId);
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.user_id !== userId) {
      console.log('Unauthorized attempt by user:', userId);
      return res.status(403).json({ error: 'Unauthorized to modify this notification' });
    }

    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to mark notification as read' });
    }

    // 🚨 INVALIDATE CACHE for the post owner
    invalidateNotificationCache(userId);

    console.log('Notification marked as read:', notificationId);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/notifications/read-all', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    console.log('Marking all notifications as read for user:', userId);

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }

    // 🚨 INVALIDATE CACHE for the post owner
    invalidateNotificationCache(userId);

    console.log('All notifications marked as read for user:', userId);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export default router;
