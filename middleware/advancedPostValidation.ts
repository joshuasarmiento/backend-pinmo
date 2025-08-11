import { Request, Response, NextFunction } from 'express';
import * as validator from 'validator';
import multer from 'multer';
import leoProfanity from 'leo-profanity';
import axios from 'axios'
import FormData from 'form-data';

// Type definitions
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
  files?: { [fieldname: string]: Express.Multer.File[] };
}

interface ValidationError extends Error {
  statusCode?: number;
}

interface RateLimitEntry {
  attempts: number[];
  blacklisted: boolean;
}

interface PostBody {
  type: string;
  description: string;
  lat: string;
  lng: string;
  location: string;
  link?: string;
  emoji?: string;
}

// Enhanced bad words list with more explicit terms
const badWords: string[] = [
  // Existing bad words
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
  // Additional explicit terms
  'porn', 'xxx', 'adult', 'erotic', 'nude', 'naked', 'sex', 'blowjob', 'cum',
  'orgasm', 'masturbate', 'anal', 'vaginal', 'boob', 'tits', 'ass', 'booty',
  'clit', 'dildo', 'vibrator', 'hardcore', 'softcore', 'webcam', 'camgirl',
  'escort', 'prostitute', 'strip', 'bukkake', 'gangbang', 'milf', 'teen',
  'amateur', 'threesome', 'bdsm', 'kink', 'fetish', 'swinger', 'orgy',
  'creampie', 'cumshot', 'facial', 'squirt', 'nsfw', 'onlyfans'
];

// Analyze image metadata and filename for suspicious content
const analyzeImageMetadata = (file: Express.Multer.File, filename: string): string[] => {
  const errors: string[] = [];

  const lowerFilename = filename.toLowerCase();
  const foundTerms = badWords.filter(term => lowerFilename.includes(term));
  
  if (foundTerms.length > 0) {
    errors.push(`Image filename contains inappropriate terms and cannot be uploaded`);
    console.log(`🚫 Blocked terms found: ${foundTerms.join(', ')}`);
  }
  
  // Check for suspicious file patterns
  if (lowerFilename.match(/\d{4}-\d{2}-\d{2}.*\.(jpg|png)/i)) {
    // Pattern often used for adult content screenshots
    console.warn(`Suspicious filename pattern detected: ${filename}`);
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /only.*fans?/i,
    /leak.*ed/i,
    /private.*pics?/i,
    /hot.*girl/i,
    /sexy.*teen/i,
    /adult.*content/i
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(filename))) {
    errors.push('Image filename contains suspicious content patterns');
  }
  
  return errors;
};

leoProfanity.add(badWords);

// Enhanced sexual content detection patterns
const sexualContentPatterns: RegExp[] = [
  /\b(sex|porn|xxx|nude|naked|breast|penis|vagina|fuck|orgasm|blowjob|cum|anal|vaginal|boob|tits|ass|booty|clit|dildo|vibrator|hardcore|softcore|webcam|camgirl|escort|prostitute|strip|bukkake|gangbang|milf|teen|amateur|threesome|bdsm|kink|fetish|swinger|orgy|creampie|cumshot|facial|squirt|nsfw|onlyfans)\b/gi,
  /\b(hookup|horny|sexy|hot\s*girl|hot\s*guy|escort|massage|adult\s*content|live\s*cam|web\s*cam|sex\s*chat|erotic\s*chat)\b/gi,
  /\b(dating|single|lonely|call\s*me|dm\s*me|meet\s*up|hook\s*up|nsfw\s*content|adult\s*site)\b/gi,
  /\b(kantot|chupa|jakol|tamod|titi|puke|suso|libog|pekpek|iyot|salsal|tete)\b/gi,
];

// Enhanced malicious URL patterns
const maliciousUrlPatterns: RegExp[] = [
  /\b(bit\.ly|tinyurl|shorturl|t\.co|goo\.gl|ow\.ly|is\.gd|shorte\.st|adf\.ly|bc\.vc)\b/gi,
  /\b(download|click|free|win|prize|gift|money|cash|adult|porn|xxx|sex|erotic|nude|cam|webcam)\b/gi,
  /\.(exe|bat|scr|vbs|jar|com|pif|cmd|zip|rar|7z)(\?|$)/gi,
];

// Expanded blocked domains list
const blockedDomains: string[] = [
  'malware-site.com',
  'phishing-site.net',
  'spam-domain.org',
  'bit.ly',
  'tinyurl.com',
  '0x0.st',
  'anonfiles.com',
  'tempmail.org',
  'guerrillamail.com',
  // Adult content domains
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'youporn.com',
  'redtube.com',
  'tube8.com',
  'brazzers.com',
  'onlyfans.com',
  'livejasmin.com',
  'chaturbate.com',
  'xhamster.com',
  'adultfriendfinder.com',
  'camsoda.com',
  'manyvids.com',
  'erome.com',
  'fapello.com',
  'nsfw.xxx',
  'porntube.com',
  'spankbang.com',
  'daftsex.com'
];

// Content validation middleware
export const validateContent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { description, link }: PostBody = req.body;

    console.log('Validating content for user:', req.user.id);

    // Validate description for profanity and sexual content
    if (description) {
      if (leoProfanity.check(description)) {
        const error: ValidationError = new Error('Content contains inappropriate language. Please modify your description.');
        error.statusCode = 400;
        throw error;
      }

      for (const pattern of sexualContentPatterns) {
        if (pattern.test(description)) {
          const error: ValidationError = new Error('Content contains explicit or inappropriate material. Please modify your description.');
          error.statusCode = 400;
          throw error;
        }
      }

      if (description.length > 500) {
        const error: ValidationError = new Error('Description is too long. Maximum 500 characters allowed.');
        error.statusCode = 400;
        throw error;
      }

      const upperCaseRatio = (description.match(/[A-Z]/g) || []).length / description.length;
      if (upperCaseRatio > 0.5 && description.length > 10) {
        const error: ValidationError = new Error('Please avoid excessive use of capital letters.');
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
        const error: ValidationError = new Error('Invalid URL format. Please provide a valid HTTP/HTTPS URL.');
        error.statusCode = 400;
        throw error;
      }

      for (const pattern of maliciousUrlPatterns) {
        if (pattern.test(link)) {
          const error: ValidationError = new Error('Suspicious or explicit URL detected. Please use direct, safe links only.');
          error.statusCode = 400;
          throw error;
        }
      }

      try {
        const urlDomain = new URL(link).hostname.toLowerCase();
        if (blockedDomains.some((domain) => urlDomain.includes(domain))) {
          const error: ValidationError = new Error('This domain is not allowed due to explicit or unsafe content.');
          error.statusCode = 400;
          throw error;
        }
      } catch (urlError) {
        const error: ValidationError = new Error('Invalid URL format.');
        error.statusCode = 400;
        throw error;
      }
    }

    console.log('Content validation passed for user:', req.user.id);
    next();
  } catch (error: any) {
    console.error('Content validation error for user:', req.user.id, error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Content validation failed' });
  }
};

// Sanitize filename helper
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
};

// Replace your validateImages function with this improved version
export const validateImages = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files;

    if (files?.images || files?.custom_pin) {
      const allImages: Express.Multer.File[] = [
        ...(files.images || []),
        ...(files.custom_pin || []),
      ];

      for (const image of allImages) {
        // Basic file checks
        if (image.size > 5 * 1024 * 1024) {
          const error: ValidationError = new Error('Image file too large. Maximum 5MB allowed.');
          error.statusCode = 400;
          throw error;
        }

        if (!image.mimetype.startsWith('image/')) {
          const error: ValidationError = new Error('Invalid file type. Only images are allowed.');
          error.statusCode = 400;
          throw error;
        }

        const allowedExtensions: string[] = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const fileExtension = image.originalname.toLowerCase().substring(image.originalname.lastIndexOf('.'));

        if (!allowedExtensions.includes(fileExtension)) {
          const error: ValidationError = new Error('Invalid image format. Allowed: JPG, PNG, GIF, WebP');
          error.statusCode = 400;
          throw error;
        }

        // Create safe filename
        const safeFilename = sanitizeFilename(image.originalname);

        const suspiciousPatterns: RegExp[] = [
          /\.(exe|bat|scr|vbs|jar|com|pif|cmd)$/gi,
          /\.(php|jsp|asp|aspx)$/gi,
        ];

        if (suspiciousPatterns.some((pattern) => pattern.test(safeFilename))) {
          const error: ValidationError = new Error('Suspicious file name detected.');
          error.statusCode = 400;
          throw error;
        }

        // Filename and metadata analysis
        const metadataErrors = analyzeImageMetadata(image, safeFilename);
        if (metadataErrors.length > 0) {
          const error: ValidationError = new Error(metadataErrors[0]);
          error.statusCode = 400;
          throw error;
        }        
      }
    }

    next();
  } catch (error: any) {
    console.error('Image validation error for user:', req.user.id, error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Image validation failed' });
  }
};

// Rate limiting for post submissions
const rateLimitMap = new Map<string, number[]>();

export const rateLimit = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const userId: string = (req as any).user.id;
    const now: number = Date.now();
    const windowMs: number = 15 * 60 * 1000; // 15 minutes
    const maxAttempts: number = 5; // 5 posts per 15 minutes

    const userAttempts: number[] = rateLimitMap.get(userId) || [];
    const recentAttempts: number[] = userAttempts.filter((time) => now - time < windowMs);

    if (recentAttempts.length >= maxAttempts) {
      res.status(429).json({ error: 'Too many posts. Please wait before submitting again.' });
      return;
    }

    recentAttempts.push(now);
    rateLimitMap.set(userId, recentAttempts);

    next();
  } catch (error: any) {
    console.error('Rate limit error for user:', (req as any).user?.id, error.message);
    res.status(500).json({ error: 'Rate limit check failed' });
  }
};

// IP-based rate limiting and blacklisting
const ipRateLimitMap = new Map<string, RateLimitEntry>();

export const advancedRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const clientIP: string = req.ip || req.connection.remoteAddress || 'unknown';
    const now: number = Date.now();
    const windowMs: number = 60 * 1000; // 1 minute
    const maxRequests: number = 10; // 10 requests per minute per IP

    const entry: RateLimitEntry = ipRateLimitMap.get(clientIP) || {
      attempts: [],
      blacklisted: false,
    };

    if (entry.blacklisted) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    entry.attempts = entry.attempts.filter((time) => now - time < windowMs);

    if (entry.attempts.length >= maxRequests) {
      const violationWindow = 5 * 60 * 1000; // 5 minutes
      const recentViolations = entry.attempts.filter((time) => now - time < violationWindow);

      if (recentViolations.length > 50) {
        entry.blacklisted = true;
      }

      res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return;
    }

    entry.attempts.push(now);
    ipRateLimitMap.set(clientIP, entry);

    next();
  } catch (error: any) {
    console.error('IP rate limit error for IP:', req.ip, error.message);
    res.status(500).json({ error: 'IP rate limit check failed' });
  }
};

// Enhanced file upload configuration
export const enhancedFileUpload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 6, // Max 6 files (5 images + 1 custom pin)
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
    try {
      if (!file.mimetype.startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }

      const suspiciousPatterns: RegExp[] = [
        /\.php$/i, /\.jsp$/i, /\.asp$/i, /\.exe$/i,
        /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i,
      ];

      if (suspiciousPatterns.some((pattern) => pattern.test(file.originalname))) {
        throw new Error('Suspicious file name detected');
      }

      cb(null, true);
    } catch (error: any) {
      console.error('File upload filter error:', error.message);
      cb(error);
    }
  },
});

// Database sanitization function
export const sanitizeForDatabase = (input: any): any => {
  if (typeof input !== 'string') return input;
  return input
    // .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, hyphens
    // .replace(/\s+/g, '_') // Replace spaces with underscores
    // .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .substring(0, 150); // Limit length
};

// Comprehensive validation middleware
export const comprehensiveValidation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Sanitize inputs
    if (req.body.type) req.body.type = sanitizeForDatabase(req.body.type);
    if (req.body.description) req.body.description = sanitizeForDatabase(req.body.description);
    if (req.body.link) req.body.link = sanitizeForDatabase(req.body.link);
    if (req.body.location) req.body.location = sanitizeForDatabase(req.body.location);

    // Run validations sequentially
    await new Promise<void>((resolve, reject) => {
      validateContent(req as any, res, (error?: any) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      validateImages(req as any, res, (error?: any) => {
        if (error) reject(error);
        else resolve();
      });
    });

    next();
  } catch (error: any) {
    console.error('Comprehensive validation error for user:', (req as any).user.id, error.message);
    res.status(error.statusCode || 400).json({ error: error.message || 'Content validation failed' });
  }
};

// Export additional utilities
export {
  validator,
  badWords,
  sexualContentPatterns,
  maliciousUrlPatterns,
  blockedDomains,
};