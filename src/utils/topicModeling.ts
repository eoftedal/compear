import {
  initializeWebGPU,
  isWebGPUAvailableForSimilarity,
  kMeansClusteringGPU,
  hierarchicalClusteringGPU,
} from './webgpuSimilarity'
import { mulberry32, kMeansPlusPlusInit } from './random'

export type ClusteringMethod = 'kmeans' | 'hierarchical'

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] || 0
    const bVal = b[i] || 0
    dotProduct += aVal * bVal
    normA += aVal * aVal
    normB += bVal * bVal
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// K-means clustering
export interface Cluster {
  centroid: number[]
  documentIndices: number[]
  coherence?: number
}

export async function performClustering(
  embeddings: number[][],
  k: number,
  method: ClusteringMethod = 'kmeans',
  onProgress?: (progress: number) => void,
): Promise<Cluster[]> {
  if (embeddings.length === 0) {
    return []
  }

  // Asking for more clusters than documents would spin forever in centroid selection
  const effectiveK = Math.max(1, Math.min(k, embeddings.length))

  let clusters: Cluster[] | null = null

  // Try GPU acceleration first for both methods
  try {
    if (!isWebGPUAvailableForSimilarity()) {
      await initializeWebGPU()
    }

    if (isWebGPUAvailableForSimilarity()) {
      if (method === 'kmeans') {
        console.log('[TopicModeling] Using GPU-accelerated K-means clustering')
        clusters = await kMeansClusteringGPU(embeddings, effectiveK, onProgress)
      } else {
        console.log('[TopicModeling] Using GPU-accelerated hierarchical clustering')
        clusters = await hierarchicalClusteringGPU(embeddings, effectiveK, onProgress)
      }
    }
  } catch (error) {
    console.warn('[TopicModeling] GPU clustering failed, falling back to CPU:', error)
    clusters = null
  }

  // Fallback to CPU
  if (!clusters) {
    if (method === 'kmeans') {
      console.log('[TopicModeling] Using CPU K-means clustering')
      clusters = await kMeansClustering(embeddings, effectiveK, onProgress)
    } else {
      console.log('[TopicModeling] Using CPU hierarchical clustering')
      clusters = await hierarchicalClustering(embeddings, effectiveK, onProgress)
    }
  }

  // K-means can leave clusters empty; drop them rather than showing "0 docs" topics
  return clusters.filter((cluster) => cluster.documentIndices.length > 0)
}

// Let the browser paint progress updates between heavy iterations
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function kMeansClustering(
  embeddings: number[][],
  k: number,
  onProgress?: (progress: number) => void,
): Promise<Cluster[]> {
  const maxIterations = 100
  const dimension = embeddings[0]?.length || 0

  if (embeddings.length === 0 || dimension === 0) {
    return []
  }

  // Seeded k-means++ initialization: reproducible and spread across the data
  const centroids = kMeansPlusPlusInit(embeddings, k, mulberry32(embeddings.length))

  let assignments = new Array(embeddings.length).fill(0)
  let converged = false
  let iteration = 0

  while (!converged && iteration < maxIterations) {
    // Assign each point to nearest centroid
    const newAssignments = embeddings.map((emb) => {
      let maxSim = -Infinity
      let bestCluster = 0

      for (let c = 0; c < k; c++) {
        const centroid = centroids[c]
        if (centroid) {
          const sim = cosineSimilarity(emb, centroid)
          if (sim > maxSim) {
            maxSim = sim
            bestCluster = c
          }
        }
      }

      return bestCluster
    })

    // Check convergence
    converged = newAssignments.every((a, i) => a === assignments[i])
    assignments = newAssignments

    // Update centroids
    for (let c = 0; c < k; c++) {
      const clusterPoints = embeddings.filter((_, i) => assignments[i] === c)

      if (clusterPoints.length > 0) {
        const newCentroid = new Array(dimension).fill(0)

        for (const point of clusterPoints) {
          for (let d = 0; d < dimension; d++) {
            newCentroid[d] += point[d]
          }
        }

        for (let d = 0; d < dimension; d++) {
          newCentroid[d] /= clusterPoints.length
        }

        // Normalize centroid
        const norm = Math.sqrt(newCentroid.reduce((sum, val) => sum + val * val, 0))
        for (let d = 0; d < dimension; d++) {
          newCentroid[d] /= norm
        }

        centroids[c] = newCentroid
      }
    }

    iteration++
    if (onProgress) {
      onProgress(iteration / maxIterations)
    }
    await yieldToUI()
  }

  // Build clusters with coherence scores
  const clusters: Cluster[] = []
  for (let c = 0; c < k; c++) {
    const documentIndices = assignments.map((a, i) => (a === c ? i : -1)).filter((i) => i !== -1)

    // Calculate coherence (average similarity to centroid)
    let coherence = 0
    const centroid = centroids[c]
    if (documentIndices.length > 0 && centroid) {
      coherence =
        documentIndices.reduce((sum, idx) => {
          const emb = embeddings[idx]
          return sum + (emb ? cosineSimilarity(emb, centroid) : 0)
        }, 0) / documentIndices.length
    }

    if (centroid) {
      clusters.push({
        centroid,
        documentIndices,
        coherence,
      })
    }
  }

  // Sort by cluster size (descending)
  clusters.sort((a, b) => b.documentIndices.length - a.documentIndices.length)

  return clusters
}

async function hierarchicalClustering(
  embeddings: number[][],
  k: number,
  onProgress?: (progress: number) => void,
): Promise<Cluster[]> {
  // Centroid-based agglomerative hierarchical clustering
  const n = embeddings.length
  const dimension = embeddings[0]?.length || 0

  // Helper to calculate and normalize centroid
  const calculateCentroid = (indices: number[]): number[] => {
    const centroid = new Array(dimension).fill(0)

    for (const idx of indices) {
      const emb = embeddings[idx]
      if (emb) {
        for (let d = 0; d < dimension; d++) {
          centroid[d] += emb[d] || 0
        }
      }
    }

    for (let d = 0; d < dimension; d++) {
      centroid[d] /= indices.length
    }

    // Normalize
    const norm = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0))
    if (norm > 0) {
      for (let d = 0; d < dimension; d++) {
        centroid[d] /= norm
      }
    }

    return centroid
  }

  // Start with each point as its own cluster with its centroid
  interface ClusterData {
    indices: number[]
    centroid: number[]
  }

  const clusters: ClusterData[] = embeddings.map((emb, i) => ({
    indices: [i],
    centroid: [...emb],
  }))

  while (clusters.length > k) {
    let maxSim = -Infinity
    let mergeI = 0
    let mergeJ = 1

    // Find most similar pair based on centroid similarity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const clusterI = clusters[i]
        const clusterJ = clusters[j]
        if (!clusterI || !clusterJ) continue

        // Calculate centroid similarity
        const centroidSim = cosineSimilarity(clusterI.centroid, clusterJ.centroid)

        // Apply aggressive size balancing to prevent giant clusters
        const sizeA = clusterI.indices.length
        const sizeB = clusterJ.indices.length
        const totalSize = sizeA + sizeB
        const sizeRatio = Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB)

        // Strong bonus for equal-sized merges (up to 3x multiplier)
        const sizeBonus = 1.0 + sizeRatio * 2.0

        // Penalty for creating very large clusters
        const maxReasonableSize = Math.ceil(embeddings.length / k) * 1.5
        const largeSizePenalty = totalSize > maxReasonableSize ? 0.5 : 1.0

        const adjustedSim = centroidSim * sizeBonus * largeSizePenalty

        if (adjustedSim > maxSim) {
          maxSim = adjustedSim
          mergeI = i
          mergeJ = j
        }
      }
    }

    // Merge clusters
    const clusterI = clusters[mergeI]
    const clusterJ = clusters[mergeJ]
    if (clusterI && clusterJ) {
      const mergedIndices = [...clusterI.indices, ...clusterJ.indices]
      const mergedCentroid = calculateCentroid(mergedIndices)

      clusters[mergeI] = {
        indices: mergedIndices,
        centroid: mergedCentroid,
      }
      clusters.splice(mergeJ, 1)
    }

    if (onProgress) {
      onProgress((n - clusters.length) / (n - k))
    }
    // Yield periodically; every merge would add ~4ms of timer clamping each
    if (clusters.length % 10 === 0) {
      await yieldToUI()
    }
  }

  // Build final clusters with coherence
  return clusters.map((cluster) => {
    // Calculate coherence
    const coherence =
      cluster.indices.reduce((sum, idx) => {
        const emb = embeddings[idx]
        return sum + (emb ? cosineSimilarity(emb, cluster.centroid) : 0)
      }, 0) / cluster.indices.length

    return {
      centroid: cluster.centroid,
      documentIndices: cluster.indices,
      coherence,
    }
  })
}

// Extract top keywords using TF-IDF
// Stop word presets
export const STOPWORDS_MINIMAL = [
  'the',
  'be',
  'to',
  'of',
  'and',
  'a',
  'in',
  'that',
  'have',
  'i',
  'it',
  'for',
  'not',
  'on',
  'with',
  'he',
  'as',
  'you',
  'do',
  'at',
  'this',
  'but',
  'his',
  'by',
  'from',
  'they',
  'we',
  'say',
  'her',
  'she',
  'or',
  'an',
  'will',
  'my',
  'one',
  'all',
  'would',
  'there',
  'their',
  'your',
  'yours',
  'our',
  'ours',
  'us',
  'me',
  'him',
  'them',
  'am',
  // Stems left over when contraction suffixes are stripped ("don't" -> "don")
  'don',
  'doesn',
  'didn',
  'isn',
  'aren',
  'wasn',
  'weren',
  'hasn',
  'haven',
  'hadn',
  'won',
  'wouldn',
  'couldn',
  'shouldn',
  'mustn',
  'ain',
] as const

export const STOPWORDS_STANDARD = [
  ...STOPWORDS_MINIMAL,
  'is',
  'are',
  'was',
  'were',
  'been',
  'has',
  'had',
  'can',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'would',
  'what',
  'which',
  'who',
  'when',
  'where',
  'how',
  'why',
  'about',
  'into',
  'through',
  'over',
  'under',
  'between',
  'among',
  'these',
  'those',
  'such',
  'very',
  'just',
  'than',
  'then',
  'so',
  'if',
  'out',
  'up',
  'down',
  'who',
  'some',
  'any',
  'no',
  'more',
  'only',
  'other',
  'its',
  'now',
  'also',
  'being',
  'here',
  'after',
  'before',
  'does',
  'did',
  'having',
  'each',
  'both',
  'few',
  'more',
  'most',
  'same',
  'too',
] as const

export const STOPWORDS_EXTENSIVE = [
  ...STOPWORDS_STANDARD,
  'because',
  'while',
  'during',
  'without',
  'within',
  'against',
  'upon',
  'below',
  'above',
  'across',
  'around',
  'since',
  'until',
  'unless',
  'although',
  'though',
  'whether',
  'however',
  'therefore',
  'thus',
  'hence',
  'moreover',
  'furthermore',
  'nevertheless',
  'nonetheless',
  'meanwhile',
  'otherwise',
  'instead',
  'besides',
  'indeed',
  'actually',
  'really',
  'quite',
  'rather',
  'enough',
  'almost',
  'even',
  'still',
  'already',
  'yet',
  'ever',
  'never',
  'always',
  'often',
  'sometimes',
  'usually',
  'perhaps',
  'maybe',
  'probably',
  'possibly',
  'certainly',
  'definitely',
  'sure',
  'ok',
  'yes',
  'no',
  'well',
  'oh',
  'um',
  'uh',
  'ah',
  'like',
  'know',
  'thing',
  'things',
  'stuff',
  'get',
  'got',
  'gotten',
  'make',
  'made',
  'go',
  'went',
  'come',
  'came',
  'take',
  'took',
  'give',
  'gave',
  'use',
  'used',
  'find',
  'found',
  'tell',
  'told',
  'ask',
  'asked',
  'work',
  'worked',
  'seem',
  'seemed',
  'feel',
  'felt',
  'try',
  'tried',
  'leave',
  'left',
  'call',
  'called',
] as const

export function getStopWordsSet(
  preset: 'minimal' | 'standard' | 'extensive',
  customStopWordsStr: string,
): Set<string> {
  let presetWords: readonly string[]

  switch (preset) {
    case 'minimal':
      presetWords = STOPWORDS_MINIMAL
      break
    case 'standard':
      presetWords = STOPWORDS_STANDARD
      break
    case 'extensive':
      presetWords = STOPWORDS_EXTENSIVE
      break
  }

  const customWords = customStopWordsStr
    .toLowerCase()
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)

  return new Set([...presetWords, ...customWords])
}

// Unicode-aware so accented and non-Latin words survive; length > 1 keeps
// terms like "ai" while dropping single characters
function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Drop contraction/possessive suffixes ("we'll", "don't", "microsoft's",
      // straight or curly apostrophe) before punctuation stripping turns them
      // into standalone fragments like "ll", "re", "ve"
      .replace(/['’]\p{L}*/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
  )
}

function generateNgrams(tokens: string[], ngramSize: number): string[] {
  if (ngramSize === 1) {
    return tokens
  }

  const ngrams: string[] = []
  for (let i = 0; i <= tokens.length - ngramSize; i++) {
    ngrams.push(tokens.slice(i, i + ngramSize).join(' '))
  }
  return ngrams
}

// c-TF-IDF (as in BERTopic): a term is a good keyword for a cluster when it is
// frequent within the cluster but rare across the corpus as a whole. Plain
// per-cluster TF-IDF would zero out exactly the terms that characterize the
// cluster, since they appear in most of its documents.
export function extractKeywordsForClusters(
  clusterTexts: string[][],
  topN: number = 10,
  stopWordsSet: Set<string> = new Set(STOPWORDS_STANDARD),
  ngramSize: number = 1,
): string[][] {
  // Term frequency per cluster (exclude n-grams containing any stop word)
  const clusterTermFreqs = clusterTexts.map((texts) => {
    const freq = new Map<string, number>()
    for (const text of texts) {
      for (const ngram of generateNgrams(tokenize(text), ngramSize)) {
        if (ngram.split(' ').some((w) => stopWordsSet.has(w))) continue
        freq.set(ngram, (freq.get(ngram) || 0) + 1)
      }
    }
    return freq
  })

  // Total frequency of each term across all clusters
  const corpusFreq = new Map<string, number>()
  let totalTerms = 0
  for (const freqs of clusterTermFreqs) {
    for (const [term, tf] of freqs) {
      corpusFreq.set(term, (corpusFreq.get(term) || 0) + tf)
      totalTerms += tf
    }
  }
  const avgTermsPerCluster = totalTerms / (clusterTermFreqs.length || 1)

  // score = tf(term, cluster) * log(1 + avgTermsPerCluster / corpusFreq(term))
  return clusterTermFreqs.map((freqs) => {
    const scored: Array<[string, number]> = []
    for (const [term, tf] of freqs) {
      const idf = Math.log(1 + avgTermsPerCluster / (corpusFreq.get(term) || 1))
      scored.push([term, tf * idf])
    }
    scored.sort((a, b) => b[1] - a[1])
    return scored.slice(0, topN).map(([term]) => term)
  })
}
