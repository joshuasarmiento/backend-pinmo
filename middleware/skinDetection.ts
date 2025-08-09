// utils/skinDetection.ts
import sharp from 'sharp';
import { type TextAnalysisResult } from './tesseractDetection';

// Type definitions
export interface ImageAnalysisResult {
  isExplicit: boolean;
  skinPercentage: number;
  confidence: number;
}

export interface ImageAnalysisDetail extends ImageAnalysisResult {
  url: string;
  textAnalysis?: TextAnalysisResult;
}

export interface ExplicitContentAnalysis {
  hasExplicitContent: boolean;
  confidence: number;
  details: ImageAnalysisDetail[];
  hasExplicitText: boolean;
  textConfidence: number;
  detectedCategories: string[];
}

/**
 * Enhanced skin detection function
 */
function isSkinPixel(r: any, g: any, b: any) {
  // RGB classifier
  const rgbClassifier = (r > 95) && (g > 40 && g < 100) && (b > 20) && 
    ((Math.max(r, g, b) - Math.min(r, g, b)) > 15) && 
    (Math.abs(r - g) > 15) && (r > g) && (r > b);
  
  // Normalized RGB classifier
  const sum = r + g + b;
  if (sum === 0) return false;
  
  const nr = r / sum;
  const ng = g / sum;
  
  const normRgbClassifier = ((nr / ng) > 1.185) && 
    (((r * b) / (sum * sum)) > 0.107) && 
    (((r * g) / (sum * sum)) > 0.112);
  
  // HSV classifier
  let h = 0;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const dif = mx - mn;
  
  if (dif !== 0) {
    if (mx === r) {
      h = ((g - b) / dif) % 6;
    } else if (mx === g) {
      h = (b - r) / dif + 2;
    } else {
      h = (r - g) / dif + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  
  const s = mx === 0 ? 0 : 1 - (3 * (mn / sum));
  const hsvClassifier = (h > 0 && h < 35 && s > 0.23 && s < 0.68);
  
  return rgbClassifier || normRgbClassifier || hsvClassifier; 
}

/**
 * Analyze image for explicit content
 */
export async function analyzeImageForExplicitContent(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Fetch image from URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    // Process image with Sharp
    const { data, info } = await sharp(imageBuffer)
      .resize(100, 100, { withoutEnlargement: true }) // Small size for performance
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const { width, height, channels } = info;
    
    let skinPixels = 0;
    let totalPixels = 0;
    let skinRegions: Array<{ x: number; y: number }> = [];
    
    // Sample every 8th pixel for performance
    for (let i = 0; i < data.length; i += channels * 8) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      totalPixels++;
      
      if (isSkinPixel(r, g, b)) {
        skinPixels++;
        const x = ((i / channels) % width);
        const y = Math.floor((i / channels) / width);
        skinRegions.push({ x, y });
      }

      // Early exit if skin percentage is already high
      if (totalPixels > 100 && skinPixels / totalPixels > 0.35) {
        break;
      }
    }
    
    const skinPercentage = totalPixels > 0 ? (skinPixels / totalPixels) * 100 : 0;
    
    // Simple clustering check
    const hasLargeSkinRegions = skinRegions.length > 30 && skinPercentage > 15;
    
    // Determine if explicit
    const isExplicit = skinPercentage > 35 || (skinPercentage > 25 && hasLargeSkinRegions);
    
    // Calculate confidence
    let confidence = 0;
    if (skinPercentage > 40) confidence = 0.9;
    else if (skinPercentage > 30) confidence = 0.7;
    else if (skinPercentage > 20) confidence = 0.5;
    else confidence = 0.3;
    
    if (hasLargeSkinRegions) confidence += 0.2;
    confidence = Math.min(confidence, 1.0);
    
    return {
      isExplicit,
      skinPercentage: Math.round(skinPercentage * 100) / 100,
      confidence: Math.round(confidence * 100) / 100
    };
    
  } catch (error: any) {
    console.warn('Image analysis failed:', error.message);
    return {
      isExplicit: false,
      skinPercentage: 0,
      confidence: 0
    };
  }
}
