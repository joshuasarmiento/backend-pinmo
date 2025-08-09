// utils/tesseractDetection.ts
import Tesseract from 'tesseract.js';

export interface TextAnalysisResult {
  hasExplicitText: boolean;
  confidence: number;
  detectedWords: string[];
  categories: string[];
  extractedText: string;
}

// Explicit content keywords categorized
const EXPLICIT_KEYWORDS = {
  nudity: [
    'nude', 'naked', 'undressed', 'topless', 'bottomless', 'bare',
    'exposed', 'revealing', 'strip', 'bikini', 'underwear', 'lingerie'
  ],
  sexual: [
    'sex', 'sexual', 'porn', 'xxx', 'adult', 'erotic', 'intimate',
    'orgasm', 'masturbate', 'horny', 'sexy', 'seduce', 'arousal',
    'pleasure', 'kinky', 'fetish', 'bdsm', 'escort', 'hookup'
  ],
  pornography: [
    'pornography', 'pornographic', 'porn', 'xxx', 'adult film',
    'sex tape', 'webcam', 'camgirl', 'onlyfans', 'premium content',
    'adult content', 'nsfw', 'explicit', 'mature content'
  ],
  violence: [
    'violence', 'violent', 'fight', 'attack', 'assault', 'abuse',
    'hit', 'punch', 'kick', 'slap', 'beat', 'torture', 'harm',
    'hurt', 'wound', 'injure', 'threat', 'weapon', 'gun', 'knife'
  ],
  gore: [
    'gore', 'blood', 'bleeding', 'wound', 'injury', 'death', 'dead',
    'corpse', 'murder', 'kill', 'suicide', 'mutilation', 'dismember',
    'brutal', 'savage', 'graphic', 'disturbing', 'gruesome'
  ]
};

/**
 * Clean and normalize text for analysis
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if text contains explicit content
 */
function analyzeTextContent(text: string): {
  detectedWords: string[];
  categories: string[];
  confidence: number;
} {
  const normalizedText = normalizeText(text);
  const words = normalizedText.split(' ');
  
  const detectedWords: string[] = [];
  const categories: Set<string> = new Set();
  let totalMatches = 0;

  // Check each category
  Object.entries(EXPLICIT_KEYWORDS).forEach(([category, keywords]) => {
    keywords.forEach(keyword => {
      // Check for exact word matches and partial matches
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(normalizedText) || normalizedText.includes(keyword)) {
        detectedWords.push(keyword);
        categories.add(category);
        totalMatches++;
      }
    });
  });

  // Calculate confidence based on matches and text length
  const confidence = Math.min(totalMatches * 0.3, 1.0);

  return {
    detectedWords: [...new Set(detectedWords)], // Remove duplicates
    categories: Array.from(categories),
    confidence
  };
}

/**
 * Extract text from image using Tesseract OCR and analyze for explicit content
 */
export async function analyzeImageText(imageUrl: string): Promise<TextAnalysisResult> {
  try {
    console.log('Starting OCR analysis for:', imageUrl);

    // Perform OCR on the image
    const { data } = await Tesseract.recognize(imageUrl, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          // console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const extractedText = data.text?.trim() || '';
    
    if (!extractedText) {
      return {
        hasExplicitText: false,
        confidence: 0,
        detectedWords: [],
        categories: [],
        extractedText: ''
      };
    }

    // console.log('Extracted text:', extractedText.substring(0, 100) + '...');

    // Analyze the extracted text
    const analysis = analyzeTextContent(extractedText);

    const hasExplicitText = analysis.detectedWords.length > 0 && analysis.confidence > 0.3;

    return {
      hasExplicitText,
      confidence: analysis.confidence,
      detectedWords: analysis.detectedWords,
      categories: analysis.categories,
      extractedText
    };

  } catch (error: any) {
    console.warn('OCR analysis failed:', error.message);
    return {
      hasExplicitText: false,
      confidence: 0,
      detectedWords: [],
      categories: [],
      extractedText: ''
    };
  }
}

/**
 * Batch analyze multiple images
 */
export async function analyzeMultipleImageTexts(imageUrls: string[]): Promise<TextAnalysisResult[]> {
  const results = await Promise.all(
    imageUrls.map(url => analyzeImageText(url))
  );
  
  return results;
}