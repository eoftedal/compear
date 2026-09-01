import {
  AutoModel,
  AutoTokenizer,
  pipeline,
  env,
  type PipelineType,
} from '@huggingface/transformers'

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

// Order drives the <select>; the recommended model leads
export const AVAILABLE_MODELS = [
  'onnx-community/embeddinggemma-300m-ONNX',
  'Xenova/bge-small-en-v1.5',
  'onnx-community/harrier-oss-v1-270m-ONNX',
  'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/all-MiniLM-L12-v2',
  'nomic-ai/nomic-embed-text-v1.5',
] as const

export type ModelName = (typeof AVAILABLE_MODELS)[number]

export const DEFAULT_MODEL: ModelName = 'Xenova/bge-small-en-v1.5'

// Repo ids are unreadable in a <select>; the size hints are only quoted for the
// models whose dtype is pinned below, since otherwise the download depends on
// the dtype transformers.js picks for the device.
export const MODEL_LABELS: Record<ModelName, string> = {
  'onnx-community/embeddinggemma-300m-ONNX': 'EmbeddingGemma-300m — 768d, multilingual (~310 MB)',
  'Xenova/bge-small-en-v1.5': 'bge-small-en-v1.5 — 384d, English',
  'onnx-community/harrier-oss-v1-270m-ONNX': 'Harrier-270m — 640d, multilingual (~345 MB)',
  'onnx-community/Qwen3-Embedding-0.6B-ONNX': 'Qwen3-Embedding-0.6B — 1024d, multilingual',
  'Xenova/all-MiniLM-L6-v2': 'all-MiniLM-L6-v2 — 384d, English',
  'Xenova/all-MiniLM-L12-v2': 'all-MiniLM-L12-v2 — 384d, English',
  'nomic-ai/nomic-embed-text-v1.5': 'nomic-embed-text-v1.5 — 768d, English',
}

/**
 * What the embeddings will be used for. Instruction-tuned models place the same
 * text differently depending on the prefix they are given, so callers have to say
 * which job they are doing:
 *
 * - `similarity` — comparison scores every row against every other row, which is a
 *   symmetric task. It is *not* retrieval, so retrieval prefixes are wrong here.
 * - `clustering` — topic modeling groups rows and pulls out shared themes.
 *
 * Free-text search over an already-embedded corpus deliberately reuses the task the
 * corpus was embedded with rather than a retrieval-query prefix: a query prefix puts
 * the query in a different region than the stored vectors and the scores stop meaning
 * anything.
 */
export type EmbeddingTask = 'similarity' | 'clustering'

type TaskPrefixes = Record<EmbeddingTask, string>

const NO_PREFIX: TaskPrefixes = { similarity: '', clustering: '' }

type ModelConfig = {
  /**
   * `pipeline` — feature-extraction, pooled and normalized here.
   * `encoder` — AutoModel exposing a finished `sentence_embedding`. These models carry
   * sentence-transformers dense layers after pooling, so running them through the
   * feature-extraction pipeline would pool the raw hidden states and skip those layers.
   */
  runtime: 'pipeline' | 'encoder'
  /** Only meaningful for the pipeline runtime; the encoder runtime pools inside the graph. */
  pooling?: 'mean' | 'last_token'
  /** Left unset to keep the transformers.js default for the device. */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4'
  prefixes: TaskPrefixes
}

const MODEL_CONFIG: Record<ModelName, ModelConfig> = {
  // BGE and MiniLM were trained without instructions. BGE does document a retrieval
  // instruction, but it is query-side only and degrades symmetric scoring, which is
  // all this app does — so both tasks stay bare.
  'Xenova/bge-small-en-v1.5': { runtime: 'pipeline', pooling: 'mean', prefixes: NO_PREFIX },
  'Xenova/all-MiniLM-L6-v2': { runtime: 'pipeline', pooling: 'mean', prefixes: NO_PREFIX },
  'Xenova/all-MiniLM-L12-v2': { runtime: 'pipeline', pooling: 'mean', prefixes: NO_PREFIX },

  // nomic's `clustering:` prefix covers grouping, topic discovery and semantic
  // deduplication — which is both of our tasks. `search_document:` is for a corpus
  // that will be queried, and it is the wrong space for row-to-row scoring.
  'nomic-ai/nomic-embed-text-v1.5': {
    runtime: 'pipeline',
    pooling: 'mean',
    prefixes: { similarity: 'clustering: ', clustering: 'clustering: ' },
  },

  // Qwen3 is instruction-aware and uses last-token pooling. The instruction normally
  // goes on the query side of a retrieval pair; for a symmetric task the same one goes
  // on every row.
  'onnx-community/Qwen3-Embedding-0.6B-ONNX': {
    runtime: 'pipeline',
    pooling: 'last_token',
    prefixes: {
      similarity: 'Instruct: Retrieve semantically similar text\nQuery:',
      clustering: 'Instruct: Identify the topic or theme of the given text\nQuery:',
    },
  },

  // EmbeddingGemma degrades noticeably without its prefixes. fp32 weights are 1.2 GB
  // and the model does not support fp16, so q8 is the practical browser dtype.
  'onnx-community/embeddinggemma-300m-ONNX': {
    runtime: 'encoder',
    dtype: 'q8',
    prefixes: {
      similarity: 'task: sentence similarity | query: ',
      clustering: 'task: clustering | query: ',
    },
  },

  // Harrier is decoder-only with last-token pooling inside the graph, and its card is
  // explicit that omitting the instruction costs accuracy. fp32 weights are 1.1 GB, so
  // q8 again. Its quantized exports need onnxruntime >= the one transformers.js 4.x
  // bundles; on 3.x they failed with "Unrecognized attribute: bits for operator
  // GatherBlockQuantized".
  'onnx-community/harrier-oss-v1-270m-ONNX': {
    runtime: 'encoder',
    dtype: 'q8',
    prefixes: {
      similarity: 'Instruct: Retrieve semantically similar text\nQuery: ',
      clustering: 'Instruct: Identify the topic or theme of the given text\nQuery: ',
    },
  },
}

interface LoadedModel {
  name: ModelName
  encode(texts: string[]): Promise<number[][]>
}

let loadedModel: LoadedModel | null = null
let loadingModel: ModelName | null = null
let loadingPromise: Promise<void> | null = null
let loadToken = 0

// Split a [count, dim] tensor into rows, optionally re-normalizing to unit length so
// cosine similarity and the clustering centroid maths get what they expect.
function toRows(
  data: Float32Array,
  count: number,
  normalize: boolean,
  dims?: number[],
): number[][] {
  const dim = dims?.[dims.length - 1] ?? data.length / count
  const rows: number[][] = []

  for (let i = 0; i < count; i++) {
    const row = Array.from(data.subarray(i * dim, (i + 1) * dim))

    if (normalize) {
      let norm = 0
      for (const value of row) {
        norm += value * value
      }
      norm = Math.sqrt(norm)
      if (norm > 0) {
        for (let d = 0; d < row.length; d++) {
          row[d]! /= norm
        }
      }
    }

    rows.push(row)
  }

  return rows
}

async function createModel(modelName: ModelName): Promise<LoadedModel> {
  const config = MODEL_CONFIG[modelName]
  const options = {
    ...(deviceConfig.device ? { device: deviceConfig.device } : {}),
    ...(config.dtype ? { dtype: config.dtype } : {}),
  }

  if (config.runtime === 'encoder') {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelName),
      AutoModel.from_pretrained(modelName, options),
    ])

    return {
      name: modelName,
      async encode(texts: string[]) {
        const inputs = await tokenizer(texts, { padding: true, truncation: true })
        const output = (await model(inputs)) as {
          sentence_embedding: { data: Float32Array; dims: number[] }
        }
        const tensor = output.sentence_embedding
        return toRows(tensor.data, texts.length, true, tensor.dims)
      },
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractor: any = await pipeline('feature-extraction' as PipelineType, modelName, options)

  return {
    name: modelName,
    async encode(texts: string[]) {
      const output = await extractor(texts, { pooling: config.pooling, normalize: true })
      const tensor = output as { data: Float32Array }
      return toRows(tensor.data, texts.length, false)
    },
  }
}

/**
 * Loads `modelName` and makes it the resident model. One model is resident at a time —
 * comparison and topic modeling share it, so callers pass their own model name to every
 * embedding call rather than assuming the one they loaded is still the current one.
 */
export async function initializeModel(modelName: ModelName = DEFAULT_MODEL): Promise<void> {
  await detectWebGPU()

  if (loadedModel?.name === modelName) {
    return
  }

  // A load for this same model is already running — join it instead of downloading
  // the weights twice, which both stores would otherwise do on creation
  if (loadingPromise && loadingModel === modelName) {
    return loadingPromise
  }

  // Switching supersedes any load still in flight, so a slow download can't land after
  // the user has already picked something else
  const token = ++loadToken
  loadedModel = null
  loadingModel = modelName

  loadingPromise = (async () => {
    try {
      const model = await createModel(modelName)
      if (token !== loadToken) return

      loadedModel = model
      console.log(`[Embeddings] Model loaded: ${modelName} on ${deviceConfig.device || 'wasm'}`)
    } finally {
      if (token === loadToken) {
        loadingModel = null
        loadingPromise = null
      }
    }
  })()

  return loadingPromise
}

/**
 * Cell values routinely span several lines, and the line endings that arrive depend on
 * which machine exported the file rather than on what the row says. Two rows with the
 * same text must embed identically whether they came from Excel on Windows or a CSV
 * written on macOS, so CRLF is folded to LF and the ends are trimmed. Interior newlines
 * are left alone — those are real structure, and every model handles them well.
 *
 * This matters most for Qwen3: it pools the last token, and unnormalized line endings
 * moved identical text from ~1.0 down to 0.95 against itself. The encoder models are
 * far less sensitive, but nothing here hurts them.
 */
function normalizeForEmbedding(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

const EMBEDDING_BATCH_SIZE = 32

export async function generateEmbeddings(
  texts: string[],
  modelName: ModelName,
  task: EmbeddingTask,
  onProgress?: (current: number, total: number) => void,
): Promise<number[][]> {
  await initializeModel(modelName)

  const model = loadedModel
  if (!model) {
    throw new Error('Model not initialized. Call initializeModel() first.')
  }

  const prefix = MODEL_CONFIG[modelName].prefixes[task]
  const embeddings: number[][] = []
  const total = texts.length

  for (let start = 0; start < total; start += EMBEDDING_BATCH_SIZE) {
    // Empty texts still get a placeholder embedding so embeddings[i] always
    // corresponds to row i — similarity pairs and cluster documentIndices map
    // back to rows by index
    const batch = texts
      .slice(start, start + EMBEDDING_BATCH_SIZE)
      .map((text) => prefix + (normalizeForEmbedding(text) || ' '))

    embeddings.push(...(await model.encode(batch)))

    if (onProgress) {
      onProgress(Math.min(start + batch.length, total), total)
    }
  }

  return embeddings
}

export async function generateEmbedding(
  text: string,
  modelName: ModelName,
  task: EmbeddingTask,
): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], modelName, task)
  return embedding!
}

export function isModelReady(): boolean {
  return loadedModel !== null
}

export function getCurrentModel(): ModelName | null {
  return loadedModel?.name ?? null
}
