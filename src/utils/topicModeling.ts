import { pipeline, env, type PipelineType } from '@huggingface/transformers'
import {
  initializeWebGPU,
  isWebGPUAvailableForSimilarity,
  kMeansClusteringGPU,
  hierarchicalClusteringGPU,
} from './webgpuSimilarity'

// Configure to use local models (cached in browser)
env.allowLocalModels = false

// Detect WebGPU availability
let deviceConfig: { device?: 'webgpu' } = {}
let deviceDetected = false

async function detectWebGPU() {
  if (deviceDetected) return
  deviceDetected = true

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = await (navigator as any).gpu?.requestAdapter()
      if (adapter) {
        deviceConfig = { device: 'webgpu' }
        console.log('[TopicModeling] WebGPU acceleration enabled')
        return
      }
    } catch (error) {
      console.warn('[TopicModeling] WebGPU not available, falling back to WASM:', error)
    }
  }

  // Fallback to WASM
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
  }
}

// Available models optimized for semantic similarity and topic modeling
export const AVAILABLE_MODELS = [
  'Xenova/bge-small-en-v1.5',
  'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/all-MiniLM-L12-v2',
  'nomic-ai/nomic-embed-text-v1.5',
] as const

export type ModelName = (typeof AVAILABLE_MODELS)[number]
export type ClusteringMethod = 'kmeans' | 'hierarchical'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embeddingPipeline: any | null = null
let currentModel: ModelName | null = null
let isInitializing = false
let initializationPromise: Promise<void> | null = null

export async function initializeModel(
  modelName: ModelName = 'Xenova/bge-small-en-v1.5',
): Promise<void> {
  await detectWebGPU()

  if (embeddingPipeline && currentModel === modelName) {
    return
  }

  if (currentModel && currentModel !== modelName) {
    embeddingPipeline = null
    currentModel = null
  }

  if (isInitializing && initializationPromise) {
    return initializationPromise
  }

  isInitializing = true
  initializationPromise = (async () => {
    try {
      embeddingPipeline = await pipeline(
        'feature-extraction' as PipelineType,
        modelName,
        deviceConfig.device ? { device: deviceConfig.device } : {},
      )
      currentModel = modelName
      console.log(`[TopicModeling] Model loaded: ${modelName} on ${deviceConfig.device || 'cpu'}`)
    } finally {
      isInitializing = false
    }
  })()

  return initializationPromise
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    throw new Error('Model not initialized. Call initializeModel() first.')
  }

  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
    ...deviceConfig,
  })

  const tensor = output as { data: Float32Array }
  return Array.from(tensor.data)
}

export async function generateEmbeddings(
  texts: string[],
  modelName: ModelName,
  onProgress?: (current: number, total: number) => void,
): Promise<number[][]> {
  await initializeModel(modelName)

  const embeddings: number[][] = []
  const total = texts.length

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (!text) continue

    const embedding = await generateEmbedding(text)
    embeddings.push(embedding)

    if (onProgress) {
      onProgress(i + 1, total)
    }
  }

  return embeddings
}

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
interface Cluster {
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
  // Try GPU acceleration first for both methods
  try {
    if (!isWebGPUAvailableForSimilarity()) {
      await initializeWebGPU()
    }

    if (isWebGPUAvailableForSimilarity()) {
      if (method === 'kmeans') {
        console.log('[TopicModeling] Using GPU-accelerated K-means clustering')
        return await kMeansClusteringGPU(embeddings, k, onProgress)
      } else {
        console.log('[TopicModeling] Using GPU-accelerated hierarchical clustering')
        return await hierarchicalClusteringGPU(embeddings, k, onProgress)
      }
    }
  } catch (error) {
    console.warn('[TopicModeling] GPU clustering failed, falling back to CPU:', error)
  }

  // Fallback to CPU
  if (method === 'kmeans') {
    console.log('[TopicModeling] Using CPU K-means clustering')
    return kMeansClustering(embeddings, k, onProgress)
  } else {
    console.log('[TopicModeling] Using CPU hierarchical clustering')
    return hierarchicalClustering(embeddings, k, onProgress)
  }
}

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

  // Initialize centroids randomly
  const centroids: number[][] = []
  const usedIndices = new Set<number>()
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * embeddings.length)
    if (!usedIndices.has(idx) && embeddings[idx]) {
      centroids.push([...embeddings[idx]!])
      usedIndices.add(idx)
    }
  }

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
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0)

  return new Set([...presetWords, ...customWords])
}

export function extractTopKeywords(
  texts: string[],
  topN: number = 10,
  stopWordsSet: Set<string> = new Set(STOPWORDS_STANDARD),
  ngramSize: number = 1,
): string[] {
  // Tokenize and count term frequencies
  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)

  // Generate n-grams from token array
  const generateNgrams = (tokens: string[]): string[] => {
    if (ngramSize === 1) {
      return tokens
    }

    const ngrams: string[] = []
    for (let i = 0; i <= tokens.length - ngramSize; i++) {
      const ngram = tokens.slice(i, i + ngramSize).join(' ')
      ngrams.push(ngram)
    }
    return ngrams
  }

  // Filter function for n-grams - exclude if ANY word is a stop word
  const shouldIncludeNgram = (ngram: string): boolean => {
    const words = ngram.split(' ')
    return !words.some((w) => stopWordsSet.has(w))
  }

  // Term frequency in cluster
  const termFreq = new Map<string, number>()
  // Document frequency (how many docs contain term)
  const docFreq = new Map<string, number>()

  for (const text of texts) {
    const tokens = tokenize(text)
    const ngrams = generateNgrams(tokens).filter(shouldIncludeNgram)
    const uniqueNgrams = new Set(ngrams)

    for (const ngram of ngrams) {
      termFreq.set(ngram, (termFreq.get(ngram) || 0) + 1)
    }

    for (const ngram of uniqueNgrams) {
      docFreq.set(ngram, (docFreq.get(ngram) || 0) + 1)
    }
  }

  // Calculate TF-IDF scores
  const tfidf = new Map<string, number>()
  const numDocs = texts.length

  for (const [term, tf] of termFreq) {
    const df = docFreq.get(term) || 1
    const idf = Math.log(numDocs / df)
    tfidf.set(term, tf * idf)
  }

  // Sort by TF-IDF score and return top N
  const sorted = Array.from(tfidf.entries()).sort((a, b) => b[1] - a[1])

  return sorted.slice(0, topN).map(([term]) => term)
}

export function isModelReady(): boolean {
  return embeddingPipeline !== null
}

export function getCurrentModel(): ModelName | null {
  return currentModel
}
