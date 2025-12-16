import type { SimilarityPair } from './similarity'

let gpuDevice: GPUDevice | null = null
let isWebGPUAvailable = false

export async function initializeWebGPU(): Promise<boolean> {
  if (gpuDevice) return true

  if (!navigator.gpu) {
    console.log('[WebGPU Similarity] WebGPU not supported')
    return false
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      console.log('[WebGPU Similarity] No WebGPU adapter found')
      return false
    }

    gpuDevice = await adapter.requestDevice()
    isWebGPUAvailable = true
    console.log('[WebGPU Similarity] WebGPU initialized for similarity calculations')
    return true
  } catch (error) {
    console.warn('[WebGPU Similarity] Failed to initialize:', error)
    return false
  }
}

const computeShaderCode = `
struct Params {
  numVectors: u32,
  vectorDim: u32,
  totalPairs: u32,
}

@group(0) @binding(0) var<storage, read> embeddings: array<f32>;
@group(0) @binding(1) var<storage, read_write> results: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

fn cosineSimilarity(indexA: u32, indexB: u32) -> f32 {
  var dotProduct: f32 = 0.0;
  var normA: f32 = 0.0;
  var normB: f32 = 0.0;
  
  let offsetA = indexA * params.vectorDim;
  let offsetB = indexB * params.vectorDim;
  
  for (var i: u32 = 0u; i < params.vectorDim; i = i + 1u) {
    let valA = embeddings[offsetA + i];
    let valB = embeddings[offsetB + i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  
  let denominator = sqrt(normA) * sqrt(normB);
  if (denominator == 0.0) {
    return 0.0;
  }
  
  return dotProduct / denominator;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let pairIndex = global_id.x;
  
  if (pairIndex >= params.totalPairs) {
    return;
  }
  
  // Convert pair index to (i, j) indices where i < j
  var i: u32 = 0u;
  var j: u32 = 0u;
  var remaining = pairIndex;
  var rowSize = params.numVectors - 1u;
  
  for (var row: u32 = 0u; row < params.numVectors; row = row + 1u) {
    if (remaining < rowSize) {
      i = row;
      j = row + remaining + 1u;
      break;
    }
    remaining -= rowSize;
    rowSize -= 1u;
  }
  
  let similarity = cosineSimilarity(i, j);
  
  // Store: [rowIndexA, rowIndexB, score] for each pair
  let resultOffset = pairIndex * 3u;
  results[resultOffset] = f32(i);
  results[resultOffset + 1u] = f32(j);
  results[resultOffset + 2u] = similarity;
}
`

export async function calculateSimilaritiesOnGPU(
  embeddings: number[][],
  onProgress?: (current: number, total: number) => void,
): Promise<SimilarityPair[]> {
  if (!gpuDevice) {
    const initialized = await initializeWebGPU()
    if (!initialized) {
      throw new Error('WebGPU not available')
    }
  }

  if (!gpuDevice) {
    throw new Error('GPU device not initialized')
  }

  const numVectors = embeddings.length
  const vectorDim = embeddings[0]?.length || 0
  const totalPairs = (numVectors * (numVectors - 1)) / 2

  if (numVectors === 0 || vectorDim === 0) {
    return []
  }

  // Flatten embeddings into a single array
  const flatEmbeddings = new Float32Array(numVectors * vectorDim)
  for (let i = 0; i < numVectors; i++) {
    flatEmbeddings.set(embeddings[i]!, i * vectorDim)
  }

  // Create buffers
  const embeddingsBuffer = gpuDevice.createBuffer({
    size: flatEmbeddings.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const resultsBuffer = gpuDevice.createBuffer({
    size: totalPairs * 3 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  const paramsBuffer = gpuDevice.createBuffer({
    size: 12, // 3 x u32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const stagingBuffer = gpuDevice.createBuffer({
    size: resultsBuffer.size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

  // Write data
  gpuDevice.queue.writeBuffer(embeddingsBuffer, 0, flatEmbeddings)
  gpuDevice.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([numVectors, vectorDim, totalPairs]))

  // Create shader module and pipeline
  const shaderModule = gpuDevice.createShaderModule({
    code: computeShaderCode,
  })

  const pipeline = gpuDevice.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  })

  const bindGroup = gpuDevice.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: embeddingsBuffer } },
      { binding: 1, resource: { buffer: resultsBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  })

  // Execute compute shader
  const commandEncoder = gpuDevice.createCommandEncoder()
  const passEncoder = commandEncoder.beginComputePass()
  passEncoder.setPipeline(pipeline)
  passEncoder.setBindGroup(0, bindGroup)

  const workgroupsX = Math.ceil(totalPairs / 64)
  passEncoder.dispatchWorkgroups(workgroupsX)
  passEncoder.end()

  // Copy results to staging buffer
  commandEncoder.copyBufferToBuffer(resultsBuffer, 0, stagingBuffer, 0, resultsBuffer.size)

  gpuDevice.queue.submit([commandEncoder.finish()])

  // Report progress during GPU execution
  if (onProgress) {
    onProgress(totalPairs, totalPairs)
  }

  // Read results
  await stagingBuffer.mapAsync(GPUMapMode.READ)
  const resultData = new Float32Array(stagingBuffer.getMappedRange())

  const results: SimilarityPair[] = []
  for (let i = 0; i < totalPairs; i++) {
    const offset = i * 3
    results.push({
      rowIndexA: Math.round(resultData[offset]!),
      rowIndexB: Math.round(resultData[offset + 1]!),
      score: resultData[offset + 2]!,
    })
  }

  stagingBuffer.unmap()

  // Cleanup
  embeddingsBuffer.destroy()
  resultsBuffer.destroy()
  paramsBuffer.destroy()
  stagingBuffer.destroy()

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score)
}

export function isWebGPUAvailableForSimilarity(): boolean {
  return isWebGPUAvailable && gpuDevice !== null
}
