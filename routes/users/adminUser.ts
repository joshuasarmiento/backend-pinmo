// Optional: Admin routes for managing profile update cooldowns
// Add these to your users.ts backend file
import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import { authenticate } from '../../middleware/auth';

const router = Router();

// Admin route to reset a user's profile update cooldown
router.post('/admin/profile/reset-cooldown/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const adminUserId = (req as any).user.id;

    // Check if the requesting user is an admin (implement your admin check logic)
    const { data: adminUser, error: adminError } = await supabase
      .from('users')
      .select('role')
      .eq('id', adminUserId)
      .single();

    if (adminError || !adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Reset the profile_updated_at to allow immediate update
    const { error: updateError } = await supabase
      .from('users')
      .update({
        profile_updated_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to reset cooldown:', updateError);
      return res.status(500).json({ error: 'Failed to reset profile cooldown' });
    }

    console.log(`Admin ${adminUserId} reset profile cooldown for user ${userId}`);
    res.json({ message: 'Profile update cooldown reset successfully' });
  } catch (error) {
    console.error('Admin cooldown reset error:', error);
    res.status(500).json({ error: 'Failed to reset profile cooldown' });
  }
});

// Admin route to get profile update statistics
router.get('/admin/profile/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const adminUserId = (req as any).user.id;

    // Check admin permissions
    const { data: adminUser, error: adminError } = await supabase
      .from('users')
      .select('role')
      .eq('id', adminUserId)
      .single();

    if (adminError || !adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get profile update statistics
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();

    const { data: stats, error: statsError } = await supabase
      .from('users')
      .select('id, full_name, email, profile_updated_at, created_at')
      .order('profile_updated_at', { ascending: false });

    if (statsError) {
      console.error('Failed to fetch profile stats:', statsError);
      return res.status(500).json({ error: 'Failed to fetch profile statistics' });
    }

    // Process stats
    const usersInCooldown = stats.filter(user => {
      if (!user.profile_updated_at) return false;
      const lastUpdate = new Date(user.profile_updated_at);
      const daysSince = Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
      return daysSince < 30;
    });

    const recentUpdates = stats.filter(user => {
      if (!user.profile_updated_at) return false;
      return new Date(user.profile_updated_at) > new Date(thirtyDaysAgo);
    });

    const canUpdateNow = stats.filter(user => {
      if (!user.profile_updated_at) return true;
      const lastUpdate = new Date(user.profile_updated_at);
      const daysSince = Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
      return daysSince >= 30;
    });

    res.json({
      totalUsers: stats.length,
      usersInCooldown: usersInCooldown.length,
      canUpdateNow: canUpdateNow.length,
      recentUpdates: recentUpdates.length,
      users: stats.map(user => ({
        id: user.id,
        name: user.full_name,
        email: user.email,
        lastUpdate: user.profile_updated_at,
        canUpdate: user.profile_updated_at ? 
          Math.floor((Date.now() - new Date(user.profile_updated_at).getTime()) / (1000 * 60 * 60 * 24)) >= 30 : 
          true,
        daysRemaining: user.profile_updated_at ? 
          Math.max(0, 30 - Math.floor((Date.now() - new Date(user.profile_updated_at).getTime()) / (1000 * 60 * 60 * 24))) : 
          0
      }))
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch profile statistics' });
  }
});

// Frontend component for admin dashboard (Vue.js)
/*
<template>
  <div class="admin-profile-management p-6">
    <h2 class="text-2xl font-bold mb-6">Profile Update Management</h2>
    
    <!-- Statistics -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-white p-4 rounded-lg shadow">
        <h3 class="text-lg font-semibold">Total Users</h3>
        <p class="text-3xl font-bold text-blue-600">{{ stats.totalUsers }}</p>
      </div>
      <div class="bg-white p-4 rounded-lg shadow">
        <h3 class="text-lg font-semibold">In Cooldown</h3>
        <p class="text-3xl font-bold text-red-600">{{ stats.usersInCooldown }}</p>
      </div>
      <div class="bg-white p-4 rounded-lg shadow">
        <h3 class="text-lg font-semibold">Can Update</h3>
        <p class="text-3xl font-bold text-green-600">{{ stats.canUpdateNow }}</p>
      </div>
      <div class="bg-white p-4 rounded-lg shadow">
        <h3 class="text-lg font-semibold">Recent Updates</h3>
        <p class="text-3xl font-bold text-purple-600">{{ stats.recentUpdates }}</p>
      </div>
    </div>

    <!-- User List -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Update</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="user in stats.users" :key="user.id">
            <td class="px-6 py-4 whitespace-nowrap">
              <div>
                <div class="text-sm font-medium text-gray-900">{{ user.name }}</div>
                <div class="text-sm text-gray-500">{{ user.email }}</div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
              {{ user.lastUpdate ? new Date(user.lastUpdate).toLocaleDateString() : 'Never' }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span v-if="user.canUpdate" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                Can Update
              </span>
              <span v-else class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                {{ user.daysRemaining }} days remaining
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <button 
                v-if="!user.canUpdate"
                @click="resetCooldown(user.id)"
                class="text-indigo-600 hover:text-indigo-900"
              >
                Reset Cooldown
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '@/api';

const stats = ref({
  totalUsers: 0,
  usersInCooldown: 0,
  canUpdateNow: 0,
  recentUpdates: 0,
  users: []
});

const loadStats = async () => {
  try {
    const response = await api.get('/api/v1/users/admin/profile/stats');
    stats.value = response.data;
  } catch (error) {
    console.error('Failed to load profile stats:', error);
  }
};

const resetCooldown = async (userId) => {
  try {
    await api.post(`/api/v1/users/admin/profile/reset-cooldown/${userId}`);
    await loadStats(); // Reload stats
    alert('Cooldown reset successfully');
  } catch (error) {
    console.error('Failed to reset cooldown:', error);
    alert('Failed to reset cooldown');
  }
};

onMounted(loadStats);
</script>
*/