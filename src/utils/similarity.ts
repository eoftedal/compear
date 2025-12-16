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

export function calculatePairwiseSimilarities(
  embeddings: number[][],
  excludeSelfComparison = true,
  onProgress?: (current: number, total: number) => void,
): SimilarityPair[] {
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
      if (onProgress && pairsProcessed % 100 === 0) {
        onProgress(pairsProcessed, totalPairs)
      }
    }
  }

  if (onProgress) {
    onProgress(totalPairs, totalPairs)
  }

  // Sort by score in descending order
  return results.sort((a, b) => b.score - a.score)
}
