import { pipeline, env, type PipelineType } from '@xenova/transformers'

// Configure to use local models (cached in browser)
env.allowLocalModels = false

// Enable WebGPU if available, with fallback to WASM
env.backends.onnx.wasm.numThreads = 1
if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
  try {
    // @ts-expect-error - WebGPU types may not be fully defined
    env.backends.onnx.webgpu = { device: 'gpu' }
    console.log('[Embeddings] WebGPU acceleration enabled')
  } catch (error) {
    console.warn('[Embeddings] WebGPU not available, falling back to WASM:', error)
  }
} else {
  console.log('[Embeddings] WebGPU not supported by browser, using WASM backend')
}

export const AVAILABLE_MODELS = [
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/all-MiniLM-L12-v2',
  'Xenova/bge-small-en-v1.5',
  'nomic-ai/nomic-embed-text-v1.5',
] as const

export type ModelName = (typeof AVAILABLE_MODELS)[number]

let embeddingPipeline: Awaited<ReturnType<typeof pipeline>> | null = null
let currentModel: ModelName | null = null
let isInitializing = false
let initializationPromise: Promise<void> | null = null

export async function initializeModel(
  modelName: ModelName = 'Xenova/all-MiniLM-L6-v2',
): Promise<void> {
  // If same model is already loaded, return
  if (embeddingPipeline && currentModel === modelName) {
    return
  }

  // If different model is requested, reset
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
      embeddingPipeline = await pipeline('feature-extraction' as PipelineType, modelName)
      currentModel = modelName
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

  // @ts-expect-error - Transformers.js type definitions have complex union types that cause issues
  const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true })

  // Convert tensor to array - for feature extraction, output is a Tensor
  const tensor = output as { data: Float32Array }
  return Array.from(tensor.data)
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []

  for (const text of texts) {
    const embedding = await generateEmbedding(text)
    embeddings.push(embedding)
  }

  return embeddings
}

export function isModelReady(): boolean {
  return embeddingPipeline !== null
}

export function getCurrentModel(): ModelName | null {
  return currentModel
}
