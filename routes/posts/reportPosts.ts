import { Router, Request, Response } from 'express';
import { supabase } from '../../utils/supabase';
import { authenticate } from '../../middleware/auth';
import { 
  cache,
  safeGetCache,
  safeSetCache,
  autoInvalidateCache
} from '../../utils/cache';

const router = Router();

// Report categories and subcategories validation
const VALID_REPORT_CATEGORIES = {
  'minor': [
    'minor-harm',
    'minor-exploitation', 
    'minor-bullying',
    'minor-inappropriate'
  ],
  'harassment': [
    'harassment-targeted',
    'harassment-threats',
    'harassment-doxxing',
    'harassment-impersonation'
  ],
  'self-harm': [
    'self-harm-suicide',
    'self-harm-instructions',
    'self-harm-promotion'
  ],
  'violent': [
    'violent-graphic',
    'violent-hate',
    'violent-disturbing',
    'violent-terrorism'
  ],
  'restricted': [
    'restricted-drugs',
    'restricted-weapons',
    'restricted-services'
  ],
  'adult': [
    'adult-nudity',
    'adult-exploitation',
    'adult-solicitation'
  ],
  'fraud': [
    'fraud-scam',
    'fraud-fake',
    'fraud-phishing',
    'fraud-identity'
  ],
  'intellectual': [
    'ip-copyright',
    'ip-trademark',
    'ip-counterfeit'
  ]
};

// Utility function to validate report data
const validateReportData = (category: string, subcategory: string): boolean => {
  const validSubcategories = VALID_REPORT_CATEGORIES[category as keyof typeof VALID_REPORT_CATEGORIES];
  return validSubcategories && validSubcategories.includes(subcategory);
};

// Utility function to sanitize input
const sanitizeInput = (input: string): string => {
  return input.trim().substring(0, 1000); // Limit length and trim whitespace
};

// Create a new report
router.post('/reports', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { post_id, category, subcategory, reason } = req.body;

    console.log('Creating report for post:', post_id, 'by user:', userId);

    // Validate required fields
    if (!post_id || !category || !subcategory || !reason) {
      console.log('Missing required fields:', { post_id: !!post_id, category: !!category, subcategory: !!subcategory, reason: !!reason });
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['post_id', 'category', 'subcategory', 'reason']
      });
    }

    // Validate category and subcategory
    if (!validateReportData(category, subcategory)) {
      console.log('Invalid category/subcategory:', { category, subcategory });
      return res.status(400).json({ 
        error: 'Invalid report category or subcategory',
        validCategories: Object.keys(VALID_REPORT_CATEGORIES)
      });
    }

    // Sanitize inputs
    const sanitizedCategory = sanitizeInput(category);
    const sanitizedSubcategory = sanitizeInput(subcategory);
    const sanitizedReason = sanitizeInput(reason);

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, user_id')
      .eq('id', post_id)
      .single();

    if (postError || !post) {
      console.log('Post not found:', post_id);
      return res.status(404).json({ error: 'Post not found' });
    }

    // Prevent users from reporting their own posts
    if (post.user_id === userId) {
      console.log('User trying to report own post:', userId, post_id);
      return res.status(400).json({ error: 'Cannot report your own post' });
    }

    // Check if user has already reported this post
    const { data: existingReport, error: checkError } = await supabase
      .from('reports')
      .select('id')
      .eq('post_id', post_id)
      .eq('reporter_user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" error
      console.error('Error checking existing report:', checkError);
      return res.status(500).json({ error: 'Failed to check existing reports' });
    }

    if (existingReport) {
      console.log('User has already reported this post:', userId, post_id);
      return res.status(409).json({ error: 'You have already reported this post' });
    }

    // Create the report
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        post_id: parseInt(post_id),
        reporter_user_id: userId,
        category: sanitizedCategory,
        subcategory: sanitizedSubcategory,
        reason: sanitizedReason,
        status: 'pending'
      })
      .select()
      .single();

    if (reportError) {
      console.error('Database error creating report:', reportError);
      return res.status(500).json({ error: 'Failed to create report' });
    }

    // Invalidate reports cache
    cache.del('reports:*');
    cache.del(`user:${userId}:reports:*`);

    console.log('Report created successfully:', report.id);
    res.status(201).json({
      message: 'Report submitted successfully',
      report: {
        id: report.id,
        status: report.status,
        created_at: report.created_at
      }
    });

  } catch (error) {
    console.error('Server error creating report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// Get user's reports
router.get('/my-reports', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = '1', limit = '10', status } = req.query;

    console.log('Fetching reports for user:', userId);

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Create cache key
    const cacheKey = `user:${userId}:reports:page-${page}:limit-${limit}:status-${status || 'all'}`;
    
    const cached = safeGetCache(cacheKey);
    if (cached) {
      console.log('Returning cached user reports');
      return res.json(cached);
    }

    // Build query
    let query = supabase
      .from('reports')
      .select(`
        id,
        post_id,
        category,
        subcategory,
        reason,
        status,
        admin_notes,
        created_at,
        updated_at,
        post:posts(id, type, description, location, new_id)
      `)
      .eq('reporter_user_id', userId)
      .order('created_at', { ascending: false });

    // Apply status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: reports, error } = await query;

    if (error) {
      console.error('Error fetching user reports:', error);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    // Get total count
    let countQuery = supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('reporter_user_id', userId);

    if (status && status !== 'all') {
      countQuery = countQuery.eq('status', status);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Error getting reports count:', countError);
      return res.status(500).json({ error: 'Failed to get reports count' });
    }

    const result = {
      reports: reports || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        hasMore: (reports?.length || 0) === limitNum
      }
    };

    // Cache for 2 minutes
    safeSetCache(cacheKey, result, 120);

    console.log('User reports fetched:', reports?.length || 0);
    res.json(result);

  } catch (error) {
    console.error('Server error fetching user reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Get report statistics for a user
router.get('/my-stats', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    console.log('Fetching report stats for user:', userId);

    const cacheKey = `user:${userId}:report-stats`;
    const cached = safeGetCache(cacheKey);
    if (cached) {
      console.log('Returning cached report stats');
      return res.json(cached);
    }

    // Get counts by status
    const { data: stats, error } = await supabase
      .from('reports')
      .select('status')
      .eq('reporter_user_id', userId);

    if (error) {
      console.error('Error fetching report stats:', error);
      return res.status(500).json({ error: 'Failed to fetch report statistics' });
    }

    // Count by status
    const statsCounts = {
      total: stats?.length || 0,
      pending: 0,
      reviewing: 0,
      resolved: 0,
      dismissed: 0
    };

    stats?.forEach(report => {
      if (report.status in statsCounts) {
        statsCounts[report.status as keyof typeof statsCounts]++;
      }
    });

    // Cache for 5 minutes
    safeSetCache(cacheKey, statsCounts, 300);

    console.log('Report stats fetched for user:', userId, statsCounts);
    res.json(statsCounts);

  } catch (error) {
    console.error('Server error fetching report stats:', error);
    res.status(500).json({ error: 'Failed to fetch report statistics' });
  }
});

// Admin: Get all reports (requires admin authentication)
router.get('/admin/all', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = '1', limit = '20', status, category, sort = 'created_at', order = 'desc' } = req.query;

    console.log('Admin fetching all reports:', userId);

    // Check if user is admin
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('id, is_active')
      .eq('id', userId)
      .eq('is_active', true)
      .single();

    if (adminError || !admin) {
      console.log('Unauthorized admin access attempt:', userId);
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Create cache key
    const cacheKey = `admin:reports:page-${page}:limit-${limit}:status-${status || 'all'}:category-${category || 'all'}:sort-${sort}:order-${order}`;
    
    const cached = safeGetCache(cacheKey);
    if (cached) {
      console.log('Returning cached admin reports');
      return res.json(cached);
    }

    // Build query
    let query = supabase
      .from('reports')
      .select(`
        id,
        post_id,
        reporter_user_id,
        category,
        subcategory,
        reason,
        status,
        admin_notes,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at,
        post:posts(id, type, description, location, new_id, user_id),
        reporter:users!reports_reporter_user_id_fkey(id, full_name, email),
        reviewer:admins!reports_reviewed_by_fkey(id, full_name, email)
      `);

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    // Apply sorting
    const ascending = order === 'asc';
    query = query.order(sort as string, { ascending });

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: reports, error } = await query;

    if (error) {
      console.error('Error fetching admin reports:', error);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    // Get total count with same filters
    let countQuery = supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });

    if (status && status !== 'all') {
      countQuery = countQuery.eq('status', status);
    }

    if (category && category !== 'all') {
      countQuery = countQuery.eq('category', category);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Error getting admin reports count:', countError);
      return res.status(500).json({ error: 'Failed to get reports count' });
    }

    const result = {
      reports: reports || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        hasMore: (reports?.length || 0) === limitNum
      },
      filters: {
        status: status || 'all',
        category: category || 'all',
        sort,
        order
      }
    };

    // Cache for 1 minute (shorter for admin data)
    safeSetCache(cacheKey, result, 60);

    console.log('Admin reports fetched:', reports?.length || 0);
    res.json(result);

  } catch (error) {
    console.error('Server error fetching admin reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Admin: Update report status
router.put('/admin/:reportId', authenticate, autoInvalidateCache(() => 'reports'), async (req: Request, res: Response) => {
  try {
    const reportId = req.params.reportId;
    const userId = (req as any).user.id;
    const { status, admin_notes } = req.body;

    console.log('Admin updating report:', reportId, 'by admin:', userId);

    // Check if user is admin
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('id, is_active')
      .eq('id', userId)
      .eq('is_active', true)
      .single();

    if (adminError || !admin) {
      console.log('Unauthorized admin update attempt:', userId);
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }

    // Validate status
    const validStatuses = ['pending', 'reviewing', 'resolved', 'dismissed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses
      });
    }

    // Check if report exists
    const { data: existingReport, error: fetchError } = await supabase
      .from('reports')
      .select('id, status')
      .eq('id', reportId)
      .single();

    if (fetchError || !existingReport) {
      console.log('Report not found:', reportId);
      return res.status(404).json({ error: 'Report not found' });
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (status) {
      updateData.status = status;
      updateData.reviewed_by = userId;
      updateData.reviewed_at = new Date().toISOString();
    }

    if (admin_notes !== undefined) {
      updateData.admin_notes = sanitizeInput(admin_notes || '');
    }

    // Update the report
    const { error: updateError } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId);

    if (updateError) {
      console.error('Error updating report:', updateError);
      return res.status(500).json({ error: 'Failed to update report' });
    }

    console.log('Report updated successfully:', reportId);
    res.json({ 
      message: 'Report updated successfully',
      updated_fields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('Server error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Get report categories (for frontend reference)
router.get('/categories', (req: Request, res: Response) => {
  res.json({
    categories: VALID_REPORT_CATEGORIES,
    message: 'Available report categories and subcategories'
  });
});

export default router;