export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i]! * vecB[i]!
    normA += vecA[i]! * vecA[i]!
    normB += vecB[i]! * vecB[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)

  if (denominator === 0) {
    return 0
  }

  return dotProduct / denominator
}

export interface SimilarityPair {
  rowIndexA: number
  rowIndexB: number
  score: number
}

// Let the browser paint between chunks of work. Reporting progress is not enough on
// its own — the pair scan is one long synchronous run, so without yielding the bar
// cannot repaint and the tab locks up until the whole phase is over.
export const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Pairs per yield. Small enough that the bar moves steadily, large enough that the
// ~4ms timer clamp stays a rounding error against the work itself.
export const PAIRS_PER_CHUNK = 20000

/**
 * The scan is reported across the first 90% of the phase and the final sort owns the
 * last 10%. Sorting hundreds of thousands of pairs is a single call that can't be
 * chunked, so it gets its own slice rather than landing after a displayed 100%.
 */
export const SCAN_SHARE = 0.9

// CPU fallback implementation
async function calculatePairwiseSimilaritiesCPU(
  embeddings: number[][],
  excludeSelfComparison = true,
  onProgress?: (current: number, total: number) => void,
): Promise<SimilarityPair[]> {
  const results: SimilarityPair[] = []
  const n = embeddings.length
  const totalPairs = (n * (n - 1)) / 2
  let pairsProcessed = 0

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      // Skip self-comparison (though j starts at i+1, so this is already excluded)
      if (excludeSelfComparison && i === j) {
        continue
      }

      const score = cosineSimilarity(embeddings[i]!, embeddings[j]!)
      results.push({
        rowIndexA: i,
        rowIndexB: j,
        score,
      })

      pairsProcessed++
      if (pairsProcessed % PAIRS_PER_CHUNK === 0) {
        onProgress?.(Math.round(pairsProcessed * SCAN_SHARE), totalPairs)
        await yieldToUI()
      }
    }
  }

  onProgress?.(Math.round(totalPairs * SCAN_SHARE), totalPairs)
  await yieldToUI()

  // Sort by score in descending order
  const sorted = results.sort((a, b) => b.score - a.score)
  onProgress?.(totalPairs, totalPairs)
  return sorted
}

export async function calculatePairwiseSimilarities(
  embeddings: number[][],
  excludeSelfComparison = true,
  onProgress?: (current: number, total: number) => void,
): Promise<SimilarityPair[]> {
  // Try WebGPU first for better performance
  try {
    const { calculateSimilaritiesOnGPU, initializeWebGPU } = await import('./webgpuSimilarity')
    const initialized = await initializeWebGPU()

    if (initialized) {
      console.log('[Similarity] Using WebGPU acceleration')
      return await calculateSimilaritiesOnGPU(embeddings, onProgress)
    }
  } catch (error) {
    console.log('[Similarity] WebGPU not available, falling back to CPU:', error)
  }

  // Fallback to CPU
  console.log('[Similarity] Using CPU calculation')
  return calculatePairwiseSimilaritiesCPU(embeddings, excludeSelfComparison, onProgress)
}
