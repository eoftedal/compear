import { pipeline, env, type PipelineType } from '@huggingface/transformers'

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
      // Attempt to request adapter to verify WebGPU is available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = await (navigator as any).gpu?.requestAdapter()
      if (adapter) {
        deviceConfig = { device: 'webgpu' }
        console.log('[Embeddings] WebGPU acceleration enabled')
        return
      }
    } catch (error) {
      console.warn('[Embeddings] WebGPU not available, falling back to WASM:', error)
    }
  } else {
    console.log('[Embeddings] WebGPU not supported by browser, using WASM backend')
  }

  // Fallback to WASM
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
  }
}

export const AVAILABLE_MODELS = [
  'Xenova/bge-small-en-v1.5',
  'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/all-MiniLM-L12-v2',
  'nomic-ai/nomic-embed-text-v1.5',
] as const

export type ModelName = (typeof AVAILABLE_MODELS)[number]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embeddingPipeline: any | null = null
let currentModel: ModelName | null = null
let isInitializing = false
let initializationPromise: Promise<void> | null = null

export async function initializeModel(
  modelName: ModelName = 'Xenova/bge-small-en-v1.5',
): Promise<void> {
  // Detect WebGPU first
  await detectWebGPU()

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
      embeddingPipeline = await pipeline(
        'feature-extraction' as PipelineType,
        modelName,
        deviceConfig.device ? { device: deviceConfig.device } : {},
      )
      currentModel = modelName
      console.log(`[Embeddings] Model loaded: ${modelName} on ${deviceConfig.device || 'cpu'}`)
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

  // Qwen3 models use last_token pooling, others use mean pooling
  const poolingStrategy =
    currentModel === 'onnx-community/Qwen3-Embedding-0.6B-ONNX' ? 'last_token' : 'mean'

  const output = await embeddingPipeline(text, {
    pooling: poolingStrategy,
    normalize: true,
    ...deviceConfig,
  })

  // Convert tensor to array - for feature extraction, output is a Tensor
  const tensor = output as { data: Float32Array }
  return Array.from(tensor.data)
}

export async function generateEmbeddings(
  texts: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<number[][]> {
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

export function isModelReady(): boolean {
  return embeddingPipeline !== null
}

export function getCurrentModel(): ModelName | null {
  return currentModel
}
