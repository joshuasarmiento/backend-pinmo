"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockedDomains = exports.maliciousUrlPatterns = exports.sexualContentPatterns = exports.badWords = exports.validator = exports.comprehensiveValidation = exports.sanitizeForDatabase = exports.enhancedFileUpload = exports.advancedRateLimit = exports.rateLimit = exports.validateImages = exports.validateContent = void 0;
const validator = __importStar(require("validator"));
exports.validator = validator;
const multer_1 = __importDefault(require("multer"));
const leo_profanity_1 = __importDefault(require("leo-profanity"));
// Initialize leo-profanity with custom bad words
const badWords = [
    'putang', 'tangina', 'gago', 'ulol', 'bobo', 'tanga',
    'leche', 'pakyu', 'shet', 'buwisit', 'kupal', 'hinayupak',
    'kingina', 'tarantado', 'peste', 'inutil', 'walang kwenta',
    'bwakang', 'kantot', 'chupa', 'jakol', 'tamod', 'titi',
    'puke', 'suso', 'libog',
    'fuck', 'shit', 'damn', 'bitch', 'asshole', 'bastard',
    'crap', 'piss', 'cock', 'dick', 'pussy', 'whore', 'slut',
    'motherfucker', 'cunt', 'fucker', 'jackass', 'retard', 'nigga', 'nigger',
    'hoe', 'skank', 'faggot', 'twat', 'douche', 'dipshit', 'bullshit', 'hell',
    'prick', 'bugger', 'suck', 'dumbass', 'fatass', 'shithead', 'goddamn',
    'mofo', 'jerkoff', 'bastardo', 'mf', 'biatch', 'asswipe', 'cringeass',
    'licker', 'sucker', 'nutsack', 'nutjob', 'crackhead', 'trashbag', 'smegma',
    'wanker', 'git', 'bollocks', 'bloody', 'arsehole',
];
exports.badWords = badWords;
leo_profanity_1.default.add(badWords);
// Sexual content detection patterns (unchanged)
const sexualContentPatterns = [
    /\b(sex|porn|xxx|nude|naked|breast|penis|vagina|fuck|orgasm)\b/gi,
    /\b(hookup|horny|sexy|hot\s*girl|hot\s*guy|escort|massage)\b/gi,
    /\b(dating|single|lonely|call\s*me|dm\s*me)\b/gi,
    /\b(kantot|chupa|jakol|tamod|titi|puke|suso|libog)\b/gi,
];
exports.sexualContentPatterns = sexualContentPatterns;
// Malicious URL patterns (unchanged)
const maliciousUrlPatterns = [
    /\b(bit\.ly|tinyurl|shorturl|t\.co|goo\.gl|ow\.ly)\b/gi,
    /\b(download|click|free|win|prize|gift|money|cash)\b/gi,
    /\.(exe|bat|scr|vbs|jar|com|pif|cmd)(\?|$)/gi,
];
exports.maliciousUrlPatterns = maliciousUrlPatterns;
// Blocked domains list (unchanged)
const blockedDomains = [
    'malware-site.com',
    'phishing-site.net',
    'spam-domain.org',
    'bit.ly',
    'tinyurl.com',
    '0x0.st',
    'anonfiles.com',
    'tempmail.org',
    'guerrillamail.com',
];
exports.blockedDomains = blockedDomains;
// Content validation middleware
const validateContent = async (req, res, next) => {
    try {
        const { description, link } = req.body;
        console.log('Validating content for user:', req.user.id);
        // Validate description for profanity and sexual content
        if (description) {
            if (leo_profanity_1.default.check(description)) {
                const error = new Error('Content contains inappropriate language. Please modify your description.');
                error.statusCode = 400;
                throw error;
            }
            for (const pattern of sexualContentPatterns) {
                if (pattern.test(description)) {
                    const error = new Error('Content contains inappropriate material. Please modify your description.');
                    error.statusCode = 400;
                    throw error;
                }
            }
            if (description.length > 500) {
                const error = new Error('Description is too long. Maximum 500 characters allowed.');
                error.statusCode = 400;
                throw error;
            }
            const upperCaseRatio = (description.match(/[A-Z]/g) || []).length / description.length;
            if (upperCaseRatio > 0.5 && description.length > 10) {
                const error = new Error('Please avoid excessive use of capital letters.');
                error.statusCode = 400;
                throw error;
            }
        }
        // Validate URLs
        if (link) {
            if (!validator.isURL(link, {
                protocols: ['http', 'https'],
                require_protocol: true,
            })) {
                const error = new Error('Invalid URL format. Please provide a valid HTTP/HTTPS URL.');
                error.statusCode = 400;
                throw error;
            }
            for (const pattern of maliciousUrlPatterns) {
                if (pattern.test(link)) {
                    const error = new Error('Suspicious URL detected. Please use direct links only.');
                    error.statusCode = 400;
                    throw error;
                }
            }
            try {
                const urlDomain = new URL(link).hostname.toLowerCase();
                if (blockedDomains.some((domain) => urlDomain.includes(domain))) {
                    const error = new Error('This domain is not allowed. Please use a different link.');
                    error.statusCode = 400;
                    throw error;
                }
            }
            catch (urlError) {
                const error = new Error('Invalid URL format.');
                error.statusCode = 400;
                throw error;
            }
        }
        console.log('Content validation passed for user:', req.user.id);
        next();
    }
    catch (error) {
        console.error('Content validation error for user:', req.user.id, error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Content validation failed' });
    }
};
exports.validateContent = validateContent;
// Image content validation (unchanged)
const validateImages = async (req, res, next) => {
    try {
        const files = req.files;
        console.log('Validating images for user:', req.user.id);
        if ((files === null || files === void 0 ? void 0 : files.images) || (files === null || files === void 0 ? void 0 : files.custom_pin)) {
            const allImages = [
                ...(files.images || []),
                ...(files.custom_pin || []),
            ];
            for (const image of allImages) {
                if (image.size > 5 * 1024 * 1024) {
                    const error = new Error('Image file too large. Maximum 5MB allowed.');
                    error.statusCode = 400;
                    throw error;
                }
                if (!image.mimetype.startsWith('image/')) {
                    const error = new Error('Invalid file type. Only images are allowed.');
                    error.statusCode = 400;
                    throw error;
                }
                const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
                const fileExtension = image.originalname.toLowerCase().substring(image.originalname.lastIndexOf('.'));
                if (!allowedExtensions.includes(fileExtension)) {
                    const error = new Error('Invalid image format. Allowed: JPG, PNG, GIF, WebP');
                    error.statusCode = 400;
                    throw error;
                }
                const suspiciousPatterns = [
                    /\.(exe|bat|scr|vbs|jar|com|pif|cmd)$/gi,
                    /\.(php|jsp|asp|aspx)$/gi,
                ];
                if (suspiciousPatterns.some((pattern) => pattern.test(image.originalname))) {
                    const error = new Error('Suspicious file name detected.');
                    error.statusCode = 400;
                    throw error;
                }
            }
        }
        console.log('Image validation passed for user:', req.user.id);
        next();
    }
    catch (error) {
        console.error('Image validation error for user:', req.user.id, error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Image validation failed' });
    }
};
exports.validateImages = validateImages;
// Rate limiting for post submissions (unchanged)
const rateLimitMap = new Map();
const rateLimit = (req, res, next) => {
    var _a;
    try {
        const userId = req.user.id;
        const now = Date.now();
        const windowMs = 15 * 60 * 1000; // 15 minutes
        const maxAttempts = 5; // 5 posts per 15 minutes
        console.log('Checking rate limit for user:', userId);
        const userAttempts = rateLimitMap.get(userId) || [];
        const recentAttempts = userAttempts.filter((time) => now - time < windowMs);
        if (recentAttempts.length >= maxAttempts) {
            console.log('Rate limit exceeded for user:', userId);
            res.status(429).json({ error: 'Too many posts. Please wait before submitting again.' });
            return;
        }
        recentAttempts.push(now);
        rateLimitMap.set(userId, recentAttempts);
        console.log('Rate limit check passed for user:', userId);
        next();
    }
    catch (error) {
        console.error('Rate limit error for user:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.id, error.message);
        res.status(500).json({ error: 'Rate limit check failed' });
    }
};
exports.rateLimit = rateLimit;
// IP-based rate limiting and blacklisting (unchanged)
const ipRateLimitMap = new Map();
const advancedRateLimit = (req, res, next) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute
        const maxRequests = 10; // 10 requests per minute per IP
        console.log('Checking IP rate limit for:', clientIP);
        const entry = ipRateLimitMap.get(clientIP) || {
            attempts: [],
            blacklisted: false,
        };
        if (entry.blacklisted) {
            console.log('Blacklisted IP detected:', clientIP);
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        entry.attempts = entry.attempts.filter((time) => now - time < windowMs);
        if (entry.attempts.length >= maxRequests) {
            const violationWindow = 5 * 60 * 1000; // 5 minutes
            const recentViolations = entry.attempts.filter((time) => now - time < violationWindow);
            if (recentViolations.length > 50) {
                entry.blacklisted = true;
                console.log(`IP ${clientIP} blacklisted for excessive requests`);
            }
            console.log('IP rate limit exceeded:', clientIP);
            res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
            return;
        }
        entry.attempts.push(now);
        ipRateLimitMap.set(clientIP, entry);
        console.log('IP rate limit check passed for:', clientIP);
        next();
    }
    catch (error) {
        console.error('IP rate limit error for IP:', req.ip, error.message);
        res.status(500).json({ error: 'IP rate limit check failed' });
    }
};
exports.advancedRateLimit = advancedRateLimit;
// Enhanced file upload configuration (unchanged)
exports.enhancedFileUpload = (0, multer_1.default)({
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 6, // Max 6 files (5 images + 1 custom pin)
    },
    fileFilter: (req, file, cb) => {
        try {
            if (!file.mimetype.startsWith('image/')) {
                throw new Error('Only image files are allowed');
            }
            const suspiciousPatterns = [
                /\.php$/i, /\.jsp$/i, /\.asp$/i, /\.exe$/i,
                /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i,
            ];
            if (suspiciousPatterns.some((pattern) => pattern.test(file.originalname))) {
                throw new Error('Suspicious file name detected');
            }
            cb(null, true);
        }
        catch (error) {
            console.error('File upload filter error:', error.message);
            cb(error);
        }
    },
});
// Database sanitization function (unchanged)
const sanitizeForDatabase = (input) => {
    if (typeof input !== 'string')
        return input;
    return input
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .replace(/['"]/g, '')
        .trim();
};
exports.sanitizeForDatabase = sanitizeForDatabase;
// Comprehensive validation middleware (unchanged)
const comprehensiveValidation = async (req, res, next) => {
    try {
        console.log('Starting comprehensive validation for user:', req.user.id);
        // Sanitize inputs
        if (req.body.type)
            req.body.type = (0, exports.sanitizeForDatabase)(req.body.type);
        if (req.body.description)
            req.body.description = (0, exports.sanitizeForDatabase)(req.body.description);
        if (req.body.link)
            req.body.link = (0, exports.sanitizeForDatabase)(req.body.link);
        if (req.body.location)
            req.body.location = (0, exports.sanitizeForDatabase)(req.body.location);
        // Run validations sequentially
        await new Promise((resolve, reject) => {
            (0, exports.validateContent)(req, res, (error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
        await new Promise((resolve, reject) => {
            (0, exports.validateImages)(req, res, (error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
        console.log('Comprehensive validation passed for user:', req.user.id);
        next();
    }
    catch (error) {
        console.error('Comprehensive validation error for user:', req.user.id, error.message);
        res.status(error.statusCode || 400).json({ error: error.message || 'Content validation failed' });
    }
};
exports.comprehensiveValidation = comprehensiveValidation;
