"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAllCache = exports.getCacheStats = exports.autoInvalidateCache = exports.invalidateCommentsCache = exports.invalidateSinglePostCache = exports.invalidateUserPostsCache = exports.invalidatePostsCache = exports.invalidateNotificationCache = exports.safeDeleteCache = exports.safeSetCache = exports.safeGetCache = exports.cache = void 0;
const node_cache_1 = __importDefault(require("node-cache"));
// Create single cache instance for the entire application
const cache = new node_cache_1.default({
    stdTTL: 60, // 1 minute default TTL
    checkperiod: 120 // Check for expired keys every 2 minutes
});
exports.cache = cache;
// Safe cache operations with error handling
const safeGetCache = (key) => {
    try {
        return cache.get(key);
    }
    catch (error) {
        console.warn('Cache get error for key:', key, error);
        return null;
    }
};
exports.safeGetCache = safeGetCache;
const safeSetCache = (key, value, ttl) => {
    try {
        cache.set(key, value, ttl || 60);
        console.log('Cache set for key:', key);
    }
    catch (error) {
        console.warn('Cache set error for key:', key, error);
    }
};
exports.safeSetCache = safeSetCache;
const safeDeleteCache = (key) => {
    try {
        const deleted = cache.del(key);
        if (deleted > 0) {
            console.log('Cache deleted for key:', key);
        }
        return deleted;
    }
    catch (error) {
        console.warn('Cache delete error for key:', key, error);
        return 0;
    }
};
exports.safeDeleteCache = safeDeleteCache;
// Notification cache invalidation
const invalidateNotificationCache = (userId) => {
    try {
        const keys = cache.keys();
        const userKeys = keys.filter(key => key.startsWith(`notifications:${userId}:`));
        userKeys.forEach(key => (0, exports.safeDeleteCache)(key));
        console.log(`Invalidated ${userKeys.length} notification cache keys for user:`, userId);
    }
    catch (error) {
        console.error('Error invalidating notification cache for user:', userId, error);
    }
};
exports.invalidateNotificationCache = invalidateNotificationCache;
// Posts cache invalidation
const invalidatePostsCache = () => {
    try {
        const keys = cache.keys();
        const postKeys = keys.filter(key => key.startsWith('posts:'));
        postKeys.forEach(key => (0, exports.safeDeleteCache)(key));
        console.log(`Invalidated ${postKeys.length} posts cache keys`);
    }
    catch (error) {
        console.error('Error invalidating posts cache:', error);
    }
};
exports.invalidatePostsCache = invalidatePostsCache;
// Invalidate specific user's posts cache
const invalidateUserPostsCache = (userId) => {
    try {
        const keys = cache.keys();
        // Match various patterns that might contain user ID
        const userPostKeys = keys.filter(key => (key.startsWith('posts:') && key.includes(`user-${userId}`)) ||
            (key.startsWith('posts:') && key.includes(`:${userId}:`)) ||
            key.startsWith(`user-posts:${userId}`));
        userPostKeys.forEach(key => (0, exports.safeDeleteCache)(key));
        console.log(`Invalidated ${userPostKeys.length} user posts cache keys for user:`, userId);
    }
    catch (error) {
        console.error('Error invalidating user posts cache for user:', userId, error);
    }
};
exports.invalidateUserPostsCache = invalidateUserPostsCache;
// Invalidate single post cache
const invalidateSinglePostCache = (postNewId) => {
    try {
        const keys = cache.keys();
        const singlePostKeys = keys.filter(key => key.startsWith(`post:${postNewId}`) ||
            key.includes(`post-${postNewId}`) ||
            key.includes(postNewId));
        singlePostKeys.forEach(key => (0, exports.safeDeleteCache)(key));
        console.log(`Invalidated ${singlePostKeys.length} cache keys for post:`, postNewId);
    }
    catch (error) {
        console.error('Error invalidating single post cache for post:', postNewId, error);
    }
};
exports.invalidateSinglePostCache = invalidateSinglePostCache;
// Invalidate comments cache for a specific post
const invalidateCommentsCache = (postNewId) => {
    try {
        const keys = cache.keys();
        const commentKeys = keys.filter(key => key.includes(`comments:${postNewId}`) ||
            key.includes(`comment-${postNewId}`));
        commentKeys.forEach(key => (0, exports.safeDeleteCache)(key));
        console.log(`Invalidated ${commentKeys.length} comments cache keys for post:`, postNewId);
    }
    catch (error) {
        console.error('Error invalidating comments cache for post:', postNewId, error);
    }
};
exports.invalidateCommentsCache = invalidateCommentsCache;
// Auto invalidate cache middleware
const autoInvalidateCache = (keyFunction) => {
    return (req, res, next) => {
        // Store original json method
        const originalJson = res.json;
        // Override json method to invalidate cache after successful response
        res.json = function (data) {
            try {
                const cacheKey = keyFunction(req);
                // Only invalidate cache if we have a valid cache key and successful response
                if (cacheKey && cacheKey !== 'anonymous' && res.statusCode < 400) {
                    if (cacheKey === 'posts') {
                        (0, exports.invalidatePostsCache)();
                    }
                    else if (cacheKey.startsWith('user:')) {
                        const userId = cacheKey.split(':')[1];
                        (0, exports.invalidateUserPostsCache)(userId);
                    }
                    else if (cacheKey.startsWith('post:')) {
                        const postId = cacheKey.split(':')[1];
                        (0, exports.invalidateSinglePostCache)(postId);
                    }
                    else if (cacheKey.startsWith('notifications:')) {
                        const userId = cacheKey.split(':')[1];
                        (0, exports.invalidateNotificationCache)(userId);
                    }
                    else {
                        console.log(`Cache invalidation for key: ${cacheKey}`);
                        (0, exports.safeDeleteCache)(cacheKey);
                    }
                }
                else if (!cacheKey || cacheKey === 'anonymous') {
                    console.log('Skipping cache invalidation for anonymous user or missing key');
                }
                else {
                    console.log('Skipping cache invalidation due to error response');
                }
            }
            catch (error) {
                console.error('Cache invalidation error:', error);
            }
            return originalJson.call(this, data);
        };
        next();
    };
};
exports.autoInvalidateCache = autoInvalidateCache;
// Cache statistics
const getCacheStats = () => {
    try {
        return {
            keys: cache.keys().length,
            stats: cache.getStats(),
            memoryUsage: process.memoryUsage()
        };
    }
    catch (error) {
        console.error('Error getting cache stats:', error);
        return null;
    }
};
exports.getCacheStats = getCacheStats;
// Clear all cache
const clearAllCache = () => {
    try {
        cache.flushAll();
        console.log('All cache cleared');
    }
    catch (error) {
        console.error('Error clearing all cache:', error);
    }
};
exports.clearAllCache = clearAllCache;
