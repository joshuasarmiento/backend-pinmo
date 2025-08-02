import NodeCache from 'node-cache';

const cache = new NodeCache({ 
  stdTTL: 60, // 1 minute default TTL
  checkperiod: 120 
});

// Helper function to invalidate cache
export const invalidateNotificationCache = (userId: string) => {
  const keys = cache.keys();
  const userKeys = keys.filter(key => key.startsWith(`notifications:${userId}:`));
  
  userKeys.forEach(key => cache.del(key));
  console.log(`Invalidated ${userKeys.length} cache keys for user:`, userId);
};

export const autoInvalidateCache = (getUserId: (req: any) => string) => {
  return (req: any, res: any, next: any) => {
    // Store original json method
    const originalJson = res.json;
    
    // Override json method to invalidate cache after successful response
    res.json = function(data: any) {
      // Call original json method
      const result = originalJson.call(this, data);
      
      // If response was successful and involves notifications, invalidate cache
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = getUserId(req);
        if (userId) {
          invalidateNotificationCache(userId);
        }
      }
      
      return result;
    };
    
    next();
  };
};

// Posts cache invalidation
export const invalidatePostsCache = () => {
  const keys = cache.keys();
  const postKeys = keys.filter(key => key.startsWith('posts:'));
  
  postKeys.forEach(key => cache.del(key));
  console.log(`Invalidated ${postKeys.length} posts cache keys`);
};

// Invalidate specific user's posts cache
export const invalidateUserPostsCache = (userId: string) => {
  const keys = cache.keys();
  const userPostKeys = keys.filter(key => 
    key.startsWith('posts:') && key.includes(`userId:${userId}`)
  );
  
  userPostKeys.forEach(key => cache.del(key));
  console.log(`Invalidated ${userPostKeys.length} user posts cache keys for user:`, userId);
};

// Invalidate single post cache
export const invalidateSinglePostCache = (postNewId: string) => {
  const keys = cache.keys();
  const singlePostKeys = keys.filter(key => key.includes(postNewId));
  
  singlePostKeys.forEach(key => cache.del(key));
  console.log(`Invalidated cache for post:`, postNewId);
};
