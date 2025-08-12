import { analyzeImageForExplicitContent, type ImageAnalysisDetail, type ExplicitContentAnalysis } from './skinDetection';
import { analyzeImageText, type TextAnalysisResult } from './tesseractDetection';
import { cache, safeGetCache, safeSetCache } from '../utils/cache';

/**
 * Add timeout wrapper for OCR analysis
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Analysis timeout')), timeoutMs)
    )
  ]);
}

/**
 * Fast image analysis - prioritizes skin detection, OCR with timeout
 */
export async function analyzeImageFast(imageUrl: string): Promise<ImageAnalysisDetail> {

  // Generate cache key for single image analysis
  const cacheKey = `image-analysis:${imageUrl}`;
  
  // Check cache first
  const cachedResult = safeGetCache(cacheKey);
  if (cachedResult) {
    return cachedResult as ImageAnalysisDetail;
  }

  try {
    // Always do skin detection (fast)
    const skinAnalysis = await analyzeImageForExplicitContent(imageUrl);

    // If skin analysis already shows high confidence, skip OCR
    if (skinAnalysis.isExplicit && skinAnalysis.confidence > 0.7) {
      const result = {
        url: imageUrl,
        isExplicit: true,
        skinPercentage: skinAnalysis.skinPercentage,
        confidence: skinAnalysis.confidence,
        textAnalysis: {
          hasExplicitText: false,
          confidence: 0,
          detectedWords: [],
          categories: [],
          extractedText: ''
        }
      };
      // Cache the result for 5 minutes
      safeSetCache(cacheKey, result, 300);
      return result;
    }

    // Try OCR with timeout (3 seconds max)
    let textAnalysis: TextAnalysisResult;
    try {
      textAnalysis = await withTimeout(analyzeImageText(imageUrl), 3000);
    } catch (timeoutError) {
      textAnalysis = {
        hasExplicitText: false,
        confidence: 0,
        detectedWords: [],
        categories: [],
        extractedText: ''
      };
    }

    // Combine results
    const combinedConfidence = Math.max(skinAnalysis.confidence, textAnalysis.confidence * 0.8);
    const isExplicit = skinAnalysis.isExplicit || (textAnalysis.hasExplicitText && textAnalysis.confidence > 0.4);

    const result = {
      url: imageUrl,
      isExplicit,
      skinPercentage: skinAnalysis.skinPercentage,
      confidence: combinedConfidence,
      textAnalysis
    };

    // Cache the result for 5 minutes
    safeSetCache(cacheKey, result, 300);
    return result;

  } catch (error: any) {
    console.warn(`Fast analysis failed for ${imageUrl}:`, error.message);
    const result = {
      url: imageUrl,
      isExplicit: false,
      skinPercentage: 0,
      confidence: 0,
      textAnalysis: {
        hasExplicitText: false,
        confidence: 0,
        detectedWords: [],
        categories: [],
        extractedText: ''
      }
    };
    // Cache failed result for 1 minute to prevent repeated failures
    safeSetCache(cacheKey, result, 60);
    return result;
  }
}

/**
 * Analyze multiple images with parallel processing and limits
 */
export async function analyzeImagesBatch(imageUrls: string[]): Promise<ExplicitContentAnalysis> {

  // Generate cache key for batch analysis
  const batchCacheKey = `batch-image-analysis:${imageUrls.join(',')}`;
  
  // Check cache for batch result
  const cachedBatchResult = safeGetCache(batchCacheKey);
  if (cachedBatchResult) {
    return cachedBatchResult as ExplicitContentAnalysis;
  }

  // Limit concurrent analysis (max 2 at a time to avoid overwhelming)
  const batchSize = 2;
  const results: ImageAnalysisDetail[] = [];

  for (let i = 0; i < imageUrls.length; i += batchSize) {
    const batch = imageUrls.slice(i, i + batchSize);
    const batchPromises = batch.map(url => analyzeImageFast(url));
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
  }

  // Process results
  const explicitImages = results.filter(analysis => analysis.isExplicit);
  const imagesWithExplicitText = results.filter(analysis => 
    analysis.textAnalysis?.hasExplicitText && analysis.textAnalysis.confidence > 0.3
  );

  // Collect all detected categories
  const allCategories = new Set<string>();
  results.forEach(analysis => {
    if (analysis.textAnalysis?.categories) {
      analysis.textAnalysis.categories.forEach(category => allCategories.add(category));
    }
  });

  const hasExplicitContent = explicitImages.length > 0;
  const hasExplicitText = imagesWithExplicitText.length > 0;

  const overallConfidence = explicitImages.length > 0 ? 
    Math.max(...explicitImages.map(img => img.confidence)) : 0;
    
  const textConfidence = imagesWithExplicitText.length > 0 ? 
    Math.max(...imagesWithExplicitText.map(img => img.textAnalysis?.confidence || 0)) : 0;

  const batchResult = {
    hasExplicitContent: hasExplicitContent || hasExplicitText,
    confidence: Math.max(overallConfidence, textConfidence),
    details: results,
    hasExplicitText,
    textConfidence,
    detectedCategories: Array.from(allCategories)
  };

  // Cache batch result for 5 minutes
  safeSetCache(batchCacheKey, batchResult, 300);
  return batchResult;
}

export { type ImageAnalysisDetail, type ExplicitContentAnalysis };