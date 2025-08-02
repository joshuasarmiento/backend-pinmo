"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const supabase_1 = require("../utils/supabase");
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            console.log('No authorization header found');
            return res.status(401).json({ error: 'No authorization header' });
        }
        if (!authHeader.startsWith('Bearer ')) {
            console.log('Invalid authorization header format:', authHeader);
            return res.status(401).json({ error: 'Invalid authorization header format' });
        }
        const token = authHeader.substring(7);
        if (!token || token.trim() === '' || token === 'null' || token === 'undefined') {
            console.log('Invalid token:', token);
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.log('Verifying token...');
        console.log('Token length:', token.length);
        console.log('Token preview:', token.substring(0, 20) + '...');
        const { data: { user }, error } = await supabase_1.supabase.auth.getUser(token);
        if (error) {
            console.log('Token verification error:', error.message);
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (!user) {
            console.log('No user found for token');
            return res.status(401).json({ error: 'User not found' });
        }
        console.log('Token verified successfully for user:', user.id);
        req.user = user;
        next();
    }
    catch (error) {
        console.error('Authentication middleware error:', error);
        return res.status(500).json({ error: 'Authentication failed' });
    }
};
exports.authenticate = authenticate;
