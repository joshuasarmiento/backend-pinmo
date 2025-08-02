"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../utils/supabase");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: admin } = await supabase_1.supabase
            .from('admins')
            .select('id')
            .eq('id', userId)
            .single();
        if (!admin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const { data, error } = await supabase_1.supabase
            .from('admins')
            .select('*');
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch admins' });
        }
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch admins' });
    }
});
exports.default = router;
