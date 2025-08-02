import { Request, Response, NextFunction } from 'express';
import * as validator from 'validator';
import multer from 'multer';
// import { Filter } from 'bad-words'
// const filter = new Filter();

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

let filter: any;

(async () => {
  const { Filter } = await import('bad-words');
  filter = new Filter();

  // Add Tagalog curse words and inappropriate terms
  const badWords: string[] = [
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
    'wanker', 'git', 'bollocks', 'bloody', 'arsehole'
  ];

  filter.addWords(...badWords);
})();

// Sexual content detection patterns
const sexualContentPatterns: RegExp[] = [
  /\b(sex|porn|xxx|nude|naked|breast|penis|vagina|fuck|orgasm)\b/gi,
  /\b(hookup|horny|sexy|hot\s*girl|hot\s*guy|escort|massage)\b/gi,
  /\b(dating|single|lonely|call\s*me|dm\s*me)\b/gi,
  /\b(kantot|chupa|jakol|tamod|titi|puke|suso|libog)\b/gi,
];

// Malicious URL patterns
const maliciousUrlPatterns: RegExp[] = [
  /\b(bit\.ly|tinyurl|shorturl|t\.co|goo\.gl|ow\.ly)\b/gi,
  /\b(download|click|free|win|prize|gift|money|cash)\b/gi,
  /\.(exe|bat|scr|vbs|jar|com|pif|cmd)(\?|$)/gi,
];

// Blocked domains list
const blockedDomains: string[] = [
  'malware-site.com', 
  'phishing-site.net',
  'spam-domain.org',
  'bit.ly',
  'tinyurl.com',
  '0x0.st',
  'anonfiles.com',
  'tempmail.org',
  'guerrillamail.com'
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

    // Ensure filter is initialized
    if (!filter) {
      throw new Error('Filter not initialized');
    }

    // Validate description for profanity and sexual content
    if (description) {
      if (filter.isProfane(description)) {
        const error: ValidationError = new Error('Content contains inappropriate language. Please modify your description.');
        error.statusCode = 400;
        throw error;
      }
      
      for (const pattern of sexualContentPatterns) {
        if (pattern.test(description)) {
          const error: ValidationError = new Error('Content contains inappropriate material. Please modify your description.');
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
        require_protocol: true 
      })) {
        const error: ValidationError = new Error('Invalid URL format. Please provide a valid HTTP/HTTPS URL.');
        error.statusCode = 400;
        throw error;
      }
      
      for (const pattern of maliciousUrlPatterns) {
        if (pattern.test(link)) {
          const error: ValidationError = new Error('Suspicious URL detected. Please use direct links only.');
          error.statusCode = 400;
          throw error;
        }
      }
      
      try {
        const urlDomain = new URL(link).hostname.toLowerCase();
        if (blockedDomains.some(domain => urlDomain.includes(domain))) {
          const error: ValidationError = new Error('This domain is not allowed. Please use a different link.');
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

// Image content validation
export const validateImages = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    const files = req.files;
    
    console.log('Validating images for user:', req.user.id);

    if (files?.images || files?.custom_pin) {
      const allImages: Express.Multer.File[] = [
        ...(files.images || []),
        ...(files.custom_pin || [])
      ];
      
      for (const image of allImages) {
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

        const suspiciousPatterns: RegExp[] = [
          /\.(exe|bat|scr|vbs|jar|com|pif|cmd)$/gi,
          /\.(php|jsp|asp|aspx)$/gi
        ];
        
        if (suspiciousPatterns.some(pattern => pattern.test(image.originalname))) {
          const error: ValidationError = new Error('Suspicious file name detected.');
          error.statusCode = 400;
          throw error;
        }
      }
    }
    
    console.log('Image validation passed for user:', req.user.id);
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
    
    console.log('Checking rate limit for user:', userId);

    const userAttempts: number[] = rateLimitMap.get(userId) || [];
    const recentAttempts: number[] = userAttempts.filter(time => now - time < windowMs);
    
    if (recentAttempts.length >= maxAttempts) {
      console.log('Rate limit exceeded for user:', userId);
      res.status(429).json({ error: 'Too many posts. Please wait before submitting again.' });
      return;
    }
    
    recentAttempts.push(now);
    rateLimitMap.set(userId, recentAttempts);
    
    console.log('Rate limit check passed for user:', userId);
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
    
    console.log('Checking IP rate limit for:', clientIP);

    const entry: RateLimitEntry = ipRateLimitMap.get(clientIP) || { 
      attempts: [], 
      blacklisted: false 
    };
    
    if (entry.blacklisted) {
      console.log('Blacklisted IP detected:', clientIP);
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    
    entry.attempts = entry.attempts.filter(time => now - time < windowMs);
    
    if (entry.attempts.length >= maxRequests) {
      const violationWindow = 5 * 60 * 1000; // 5 minutes
      const recentViolations = entry.attempts.filter(time => now - time < violationWindow);
      
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
  } catch (error: any) {
    console.error('IP rate limit error for IP:', req.ip, error.message);
    res.status(500).json({ error: 'IP rate limit check failed' });
  }
};

// Enhanced file upload configuration
export const enhancedFileUpload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 6 // Max 6 files (5 images + 1 custom pin)
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
    try {
      if (!file.mimetype.startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }
      
      const suspiciousPatterns: RegExp[] = [
        /\.php$/i, /\.jsp$/i, /\.asp$/i, /\.exe$/i,
        /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i
      ];
      
      if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
        throw new Error('Suspicious file name detected');
      }
      
      cb(null, true);
    } catch (error: any) {
      console.error('File upload filter error:', error.message);
      cb(error);
    }
  }
});

// Database sanitization function
export const sanitizeForDatabase = (input: any): any => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/['"]/g, '')
    .trim();
};

// Comprehensive validation middleware
export const comprehensiveValidation = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    console.log('Starting comprehensive validation for user:', (req as any).user.id);

    // Sanitize inputs
    if (req.body.type) req.body.type = sanitizeForDatabase(req.body.type);
    if (req.body.description) req.body.description = sanitizeForDatabase(req.body.description);
    if (req.body.link) req.body.link = sanitizeForDatabase(req.body.link);
    if (req.body.location) req.body.location = sanitizeForDatabase(req.body.location);
    
    // Run validations sequentially
    await new Promise<void>((resolve, reject) => {
      validateContent((req as any), res, (error?: any) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    await new Promise<void>((resolve, reject) => {
      validateImages((req as any), res, (error?: any) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    console.log('Comprehensive validation passed for user:', (req as any).user.id);
    next();
  } catch (error: any) {
    console.error('Comprehensive validation error for user:', (req as any).user.id, error.message);
    res.status(error.statusCode || 400).json({ error: error.message || 'Content validation failed' });
  }
};

// Export additional utilities
export {
  filter,
  validator,
  sexualContentPatterns,
  maliciousUrlPatterns,
  blockedDomains
};