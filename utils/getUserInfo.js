"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserInfo = void 0;
const supabase_1 = require("./supabase");
const getUserInfo = async (userId) => {
    var _a, _b, _c;
    try {
        const { data: { user }, error: userError } = await supabase_1.supabase.auth.admin.getUserById(userId);
        if (!userError && user) {
            return {
                id: user.id,
                email: user.email || 'unknown@example.com',
                full_name: ((_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.full_name) || ((_b = user.email) === null || _b === void 0 ? void 0 : _b.split('@')[0]) || 'Anonymous',
                profile_picture: ((_c = user.user_metadata) === null || _c === void 0 ? void 0 : _c.profile_picture) || null,
                email_verified: user.email_confirmed_at ? true : false
            };
        }
    }
    catch (authError) {
        console.warn('Failed to get user info for:', userId, authError);
    }
    return {
        id: userId,
        email: 'unknown@example.com',
        full_name: 'Anonymous User',
        profile_picture: null,
        email_verified: false
    };
};
exports.getUserInfo = getUserInfo;
