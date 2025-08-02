"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_1 = __importDefault(require("./users/users"));
const posts_1 = __importDefault(require("./posts/posts"));
const feedback_1 = __importDefault(require("./feedback"));
const views_1 = __importDefault(require("./posts/views"));
const likes_1 = __importDefault(require("./posts/likes"));
const admins_1 = __importDefault(require("./admins"));
const comments_1 = __importDefault(require("./posts/comments"));
const router = (0, express_1.Router)();
// Mount all route modules
router.use('/users', users_1.default);
router.use('/posts', posts_1.default);
router.use('/posts', comments_1.default);
router.use('/posts', feedback_1.default);
router.use('/posts', views_1.default);
router.use('/posts', likes_1.default);
router.use('/admins', admins_1.default);
exports.default = router;
