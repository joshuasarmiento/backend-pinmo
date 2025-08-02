import NodeCache from 'node-cache';

// Create single cache instance for the entire application
const cache = new NodeCache({ 
  stdTTL: 60, // 1 minute default TTL
  checkperiod: 120 // Check for expired keys every 2 minutes
});

// Export the cache instance for consistent usage across the app
export { cache };

// Safe cache operations with error handling
export const safeGetCache = (key: string) => {
  try {
    return cache.get(key);
  } catch (error) {
    console.warn('Cache get error for key:', key, error);
    return null;
  }
};

export const safeSetCache = (key: string, value: any, ttl?: number) => {
  try {
    cache.set(key, value, ttl || 60);
    console.log('Cache set for key:', key);
  } catch (error) {
    console.warn('Cache set error for key:', key, error);
  }
};

export const safeDeleteCache = (key: string) => {
  try {
    const deleted = cache.del(key);
    if (deleted > 0) {
      console.log('Cache deleted for key:', key);
    }
    return deleted;
  } catch (error) {
    console.warn('Cache delete error for key:', key, error);
    return 0;
  }
};

// Notification cache invalidation
export const invalidateNotificationCache = (userId: string) => {
  try {
    const keys = cache.keys();
    const userKeys = keys.filter(key => key.startsWith(`notifications:${userId}:`));
    
    userKeys.forEach(key => safeDeleteCache(key));
    console.log(`Invalidated ${userKeys.length} notification cache keys for user:`, userId);
  } catch (error) {
    console.error('Error invalidating notification cache for user:', userId, error);
  }
};

// Posts cache invalidation
export const invalidatePostsCache = () => {
  try {
    const keys = cache.keys();
    const postKeys = keys.filter(key => key.startsWith('posts:'));
    
    postKeys.forEach(key => safeDeleteCache(key));
    console.log(`Invalidated ${postKeys.length} posts cache keys`);
  } catch (error) {
    console.error('Error invalidating posts cache:', error);
  }
};

// Invalidate specific user's posts cache
export const invalidateUserPostsCache = (userId: string) => {
  try {
    const keys = cache.keys();
    // Match various patterns that might contain user ID
    const userPostKeys = keys.filter(key => 
      (key.startsWith('posts:') && key.includes(`user-${userId}`)) ||
      (key.startsWith('posts:') && key.includes(`:${userId}:`)) ||
      key.startsWith(`user-posts:${userId}`)
    );
    
    userPostKeys.forEach(key => safeDeleteCache(key));
    console.log(`Invalidated ${userPostKeys.length} user posts cache keys for user:`, userId);
  } catch (error) {
    console.error('Error invalidating user posts cache for user:', userId, error);
  }
};

// Invalidate single post cache
export const invalidateSinglePostCache = (postNewId: string) => {
  try {
    const keys = cache.keys();
    const singlePostKeys = keys.filter(key => 
      key.startsWith(`post:${postNewId}`) || 
      key.includes(`post-${postNewId}`) ||
      key.includes(postNewId)
    );
    
    singlePostKeys.forEach(key => safeDeleteCache(key));
    console.log(`Invalidated ${singlePostKeys.length} cache keys for post:`, postNewId);
  } catch (error) {
    console.error('Error invalidating single post cache for post:', postNewId, error);
  }
};

// Invalidate comments cache for a specific post
export const invalidateCommentsCache = (postNewId: string) => {
  try {
    const keys = cache.keys();
    const commentKeys = keys.filter(key => 
      key.includes(`comments:${postNewId}`) ||
      key.includes(`comment-${postNewId}`)
    );
    
    commentKeys.forEach(key => safeDeleteCache(key));
    console.log(`Invalidated ${commentKeys.length} comments cache keys for post:`, postNewId);
  } catch (error) {
    console.error('Error invalidating comments cache for post:', postNewId, error);
  }
};

// Auto invalidate cache middleware
export const autoInvalidateCache = (keyFunction: (req: any) => string) => {
  return (req: any, res: any, next: any) => {
    // Store original json method
    const originalJson = res.json;
    
    // Override json method to invalidate cache after successful response
    res.json = function(data: any) {
      try {
        const cacheKey = keyFunction(req);
        
        // Only invalidate cache if we have a valid cache key and successful response
        if (cacheKey && cacheKey !== 'anonymous' && res.statusCode < 400) {
          if (cacheKey === 'posts') {
            invalidatePostsCache();
          } else if (cacheKey.startsWith('user:')) {
            const userId = cacheKey.split(':')[1];
            invalidateUserPostsCache(userId);
          } else if (cacheKey.startsWith('post:')) {
            const postId = cacheKey.split(':')[1];
            invalidateSinglePostCache(postId);
          } else if (cacheKey.startsWith('notifications:')) {
            const userId = cacheKey.split(':')[1];
            invalidateNotificationCache(userId);
          } else {
            console.log(`Cache invalidation for key: ${cacheKey}`);
            safeDeleteCache(cacheKey);
          }
        } else if (!cacheKey || cacheKey === 'anonymous') {
          console.log('Skipping cache invalidation for anonymous user or missing key');
        } else {
          console.log('Skipping cache invalidation due to error response');
        }
      } catch (error) {
        console.error('Cache invalidation error:', error);
      }
      
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// Cache statistics
export const getCacheStats = () => {
  try {
    return {
      keys: cache.keys().length,
      stats: cache.getStats(),
      memoryUsage: process.memoryUsage()
    };
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return null;
  }
};

// Clear all cache
export const clearAllCache = () => {
  try {
    cache.flushAll();
    console.log('All cache cleared');
  } catch (error) {
    console.error('Error clearing all cache:', error);
  }
};