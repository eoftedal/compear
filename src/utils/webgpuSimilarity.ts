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

// K-means clustering GPU compute shaders
const kmeansShaderCode = `
struct Params {
  numPoints: u32,
  numCentroids: u32,
  vectorDim: u32,
}

@group(0) @binding(0) var<storage, read> points: array<f32>;
@group(0) @binding(1) var<storage, read> centroids: array<f32>;
@group(0) @binding(2) var<storage, read_write> assignments: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

fn cosineSimilarity(pointIdx: u32, centroidIdx: u32) -> f32 {
  var dotProduct: f32 = 0.0;
  var normA: f32 = 0.0;
  var normB: f32 = 0.0;

  let pointOffset = pointIdx * params.vectorDim;
  let centroidOffset = centroidIdx * params.vectorDim;

  for (var i: u32 = 0u; i < params.vectorDim; i = i + 1u) {
    let valA = points[pointOffset + i];
    let valB = centroids[centroidOffset + i];
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
  let pointIdx = global_id.x;

  if (pointIdx >= params.numPoints) {
    return;
  }

  // Find nearest centroid
  var maxSim: f32 = -1.0;
  var bestCentroid: u32 = 0u;

  for (var c: u32 = 0u; c < params.numCentroids; c = c + 1u) {
    let sim = cosineSimilarity(pointIdx, c);
    if (sim > maxSim) {
      maxSim = sim;
      bestCentroid = c;
    }
  }

  assignments[pointIdx] = bestCentroid;
}
`

export interface KMeansCluster {
  centroid: number[]
  documentIndices: number[]
  coherence?: number
}

// Hierarchical clustering GPU compute shader
const hierarchicalShaderCode = `
struct Params {
  numClusters: u32,
  vectorDim: u32,
}

@group(0) @binding(0) var<storage, read> centroids: array<f32>;
@group(0) @binding(1) var<storage, read> clusterSizes: array<u32>;
@group(0) @binding(2) var<storage, read_write> similarities: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn cosineSimilarity(centroidIdxA: u32, centroidIdxB: u32) -> f32 {
  var dotProduct: f32 = 0.0;
  var normA: f32 = 0.0;
  var normB: f32 = 0.0;

  let offsetA = centroidIdxA * params.vectorDim;
  let offsetB = centroidIdxB * params.vectorDim;

  for (var i: u32 = 0u; i < params.vectorDim; i = i + 1u) {
    let valA = centroids[offsetA + i];
    let valB = centroids[offsetB + i];
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
  let numClusters = params.numClusters;
  let totalPairs = (numClusters * (numClusters - 1u)) / 2u;
  let pairIdx = global_id.x;

  if (pairIdx >= totalPairs) {
    return;
  }

  // Convert pair index to (i, j) where i < j
  var i: u32 = 0u;
  var j: u32 = 0u;
  var remaining = pairIdx;
  var rowSize = numClusters - 1u;

  for (var row: u32 = 0u; row < numClusters; row = row + 1u) {
    if (remaining < rowSize) {
      i = row;
      j = row + remaining + 1u;
      break;
    }
    remaining -= rowSize;
    rowSize -= 1u;
  }

  // Calculate average linkage similarity
  let sim = cosineSimilarity(i, j);
  similarities[pairIdx] = sim;
}
`

export async function kMeansClusteringGPU(
  embeddings: number[][],
  k: number,
  onProgress?: (progress: number) => void,
): Promise<KMeansCluster[]> {
  if (!gpuDevice) {
    const initialized = await initializeWebGPU()
    if (!initialized) {
      throw new Error('WebGPU not available for clustering')
    }
  }

  if (!gpuDevice) {
    throw new Error('GPU device not initialized')
  }

  const numPoints = embeddings.length
  const vectorDim = embeddings[0]?.length || 0
  const maxIterations = 100

  if (numPoints === 0 || vectorDim === 0) {
    return []
  }

  // Initialize centroids randomly (on CPU)
  const centroids: number[][] = []
  const usedIndices = new Set<number>()
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * numPoints)
    if (!usedIndices.has(idx) && embeddings[idx]) {
      centroids.push([...embeddings[idx]!])
      usedIndices.add(idx)
    }
  }

  // Flatten data
  const flatPoints = new Float32Array(numPoints * vectorDim)
  for (let i = 0; i < numPoints; i++) {
    flatPoints.set(embeddings[i]!, i * vectorDim)
  }

  // Create buffers
  const pointsBuffer = gpuDevice.createBuffer({
    size: flatPoints.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const centroidsBuffer = gpuDevice.createBuffer({
    size: k * vectorDim * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const assignmentsBuffer = gpuDevice.createBuffer({
    size: numPoints * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  const paramsBuffer = gpuDevice.createBuffer({
    size: 12, // 3 x u32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const stagingBuffer = gpuDevice.createBuffer({
    size: assignmentsBuffer.size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

  // Write initial data
  gpuDevice.queue.writeBuffer(pointsBuffer, 0, flatPoints)
  gpuDevice.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([numPoints, k, vectorDim]))

  // Create shader module and pipeline
  const shaderModule = gpuDevice.createShaderModule({
    code: kmeansShaderCode,
  })

  const pipeline = gpuDevice.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  })

  let assignments = new Uint32Array(numPoints)
  let converged = false
  let iteration = 0

  while (!converged && iteration < maxIterations) {
    // Update centroids buffer with current centroids
    const flatCentroids = new Float32Array(k * vectorDim)
    for (let i = 0; i < k; i++) {
      flatCentroids.set(centroids[i]!, i * vectorDim)
    }
    gpuDevice.queue.writeBuffer(centroidsBuffer, 0, flatCentroids)

    // Create bind group
    const bindGroup = gpuDevice.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pointsBuffer } },
        { binding: 1, resource: { buffer: centroidsBuffer } },
        { binding: 2, resource: { buffer: assignmentsBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    })

    // Execute compute shader for assignment
    const commandEncoder = gpuDevice.createCommandEncoder()
    const passEncoder = commandEncoder.beginComputePass()
    passEncoder.setPipeline(pipeline)
    passEncoder.setBindGroup(0, bindGroup)

    const workgroupsX = Math.ceil(numPoints / 64)
    passEncoder.dispatchWorkgroups(workgroupsX)
    passEncoder.end()

    // Copy results to staging buffer
    commandEncoder.copyBufferToBuffer(
      assignmentsBuffer,
      0,
      stagingBuffer,
      0,
      assignmentsBuffer.size,
    )
    gpuDevice.queue.submit([commandEncoder.finish()])

    // Read assignments
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const newAssignments = new Uint32Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Check convergence
    converged = newAssignments.every((a, i) => a === assignments[i])
    assignments = newAssignments

    // Update centroids on CPU
    for (let c = 0; c < k; c++) {
      const clusterPoints: number[][] = []
      for (let i = 0; i < numPoints; i++) {
        if (assignments[i] === c) {
          clusterPoints.push(embeddings[i]!)
        }
      }

      if (clusterPoints.length > 0) {
        const newCentroid = new Array(vectorDim).fill(0)

        for (const point of clusterPoints) {
          for (let d = 0; d < vectorDim; d++) {
            newCentroid[d] += point[d]
          }
        }

        for (let d = 0; d < vectorDim; d++) {
          newCentroid[d] /= clusterPoints.length
        }

        // Normalize centroid
        const norm = Math.sqrt(newCentroid.reduce((sum, val) => sum + val * val, 0))
        for (let d = 0; d < vectorDim; d++) {
          newCentroid[d] /= norm || 1
        }

        centroids[c] = newCentroid
      }
    }

    iteration++
    if (onProgress) {
      onProgress(iteration / maxIterations)
    }
  }

  // Build final clusters with coherence scores
  const clusters: KMeansCluster[] = []

  // Helper function for cosine similarity
  const cosineSimilarity = (a: number[], b: number[]): number => {
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

  for (let c = 0; c < k; c++) {
    const documentIndices: number[] = []
    for (let i = 0; i < numPoints; i++) {
      if (assignments[i] === c) {
        documentIndices.push(i)
      }
    }

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

  // Cleanup
  pointsBuffer.destroy()
  centroidsBuffer.destroy()
  assignmentsBuffer.destroy()
  paramsBuffer.destroy()
  stagingBuffer.destroy()

  // Sort by cluster size (descending)
  clusters.sort((a, b) => b.documentIndices.length - a.documentIndices.length)

  return clusters
}

export async function hierarchicalClusteringGPU(
  embeddings: number[][],
  k: number,
  onProgress?: (progress: number) => void,
): Promise<KMeansCluster[]> {
  if (!gpuDevice) {
    const initialized = await initializeWebGPU()
    if (!initialized) {
      throw new Error('WebGPU not available for clustering')
    }
  }

  if (!gpuDevice) {
    throw new Error('GPU device not initialized')
  }

  const n = embeddings.length
  const vectorDim = embeddings[0]?.length || 0

  if (n === 0 || vectorDim === 0) {
    return []
  }

  // Helper function for cosine similarity
  const cosineSimilarity = (a: number[], b: number[]): number => {
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

  // Start with each point as its own cluster
  interface ClusterData {
    documentIndices: number[]
    centroid: number[]
  }

  const clusters: ClusterData[] = embeddings.map((emb, i) => ({
    documentIndices: [i],
    centroid: [...emb],
  }))

  // Create shader module and pipeline
  const shaderModule = gpuDevice.createShaderModule({
    code: hierarchicalShaderCode,
  })

  const pipeline = gpuDevice.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  })

  while (clusters.length > k) {
    const numClusters = clusters.length
    const totalPairs = (numClusters * (numClusters - 1)) / 2

    // Prepare centroid data
    const flatCentroids = new Float32Array(numClusters * vectorDim)
    const clusterSizes = new Uint32Array(numClusters)

    for (let i = 0; i < numClusters; i++) {
      flatCentroids.set(clusters[i]!.centroid, i * vectorDim)
      clusterSizes[i] = clusters[i]!.documentIndices.length
    }

    // Create buffers
    const centroidsBuffer = gpuDevice.createBuffer({
      size: flatCentroids.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    const clusterSizesBuffer = gpuDevice.createBuffer({
      size: clusterSizes.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    const similaritiesBuffer = gpuDevice.createBuffer({
      size: totalPairs * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })

    const paramsBuffer = gpuDevice.createBuffer({
      size: 8, // 2 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const stagingBuffer = gpuDevice.createBuffer({
      size: similaritiesBuffer.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    // Write data
    gpuDevice.queue.writeBuffer(centroidsBuffer, 0, flatCentroids)
    gpuDevice.queue.writeBuffer(clusterSizesBuffer, 0, clusterSizes)
    gpuDevice.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([numClusters, vectorDim]))

    // Create bind group
    const bindGroup = gpuDevice.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: centroidsBuffer } },
        { binding: 1, resource: { buffer: clusterSizesBuffer } },
        { binding: 2, resource: { buffer: similaritiesBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
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

    // Copy results
    commandEncoder.copyBufferToBuffer(
      similaritiesBuffer,
      0,
      stagingBuffer,
      0,
      similaritiesBuffer.size,
    )
    gpuDevice.queue.submit([commandEncoder.finish()])

    // Read similarities
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const similarities = new Float32Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Cleanup buffers
    centroidsBuffer.destroy()
    clusterSizesBuffer.destroy()
    similaritiesBuffer.destroy()
    paramsBuffer.destroy()
    stagingBuffer.destroy()

    // Find the pair with maximum similarity
    let maxSim = -Infinity
    let mergeI = 0
    let mergeJ = 1

    let pairIdx = 0
    for (let i = 0; i < numClusters; i++) {
      for (let j = i + 1; j < numClusters; j++) {
        const sim = similarities[pairIdx]!
        if (sim > maxSim) {
          maxSim = sim
          mergeI = i
          mergeJ = j
        }
        pairIdx++
      }
    }

    // Merge clusters
    const clusterI = clusters[mergeI]!
    const clusterJ = clusters[mergeJ]!

    // Merge document indices
    const mergedDocs = [...clusterI.documentIndices, ...clusterJ.documentIndices]

    // Compute new centroid (average of all points in merged cluster)
    const newCentroid = new Array(vectorDim).fill(0)
    for (const idx of mergedDocs) {
      const emb = embeddings[idx]
      if (emb) {
        for (let d = 0; d < vectorDim; d++) {
          newCentroid[d] += emb[d]
        }
      }
    }

    for (let d = 0; d < vectorDim; d++) {
      newCentroid[d] /= mergedDocs.length
    }

    // Normalize
    const norm = Math.sqrt(newCentroid.reduce((sum, val) => sum + val * val, 0))
    for (let d = 0; d < vectorDim; d++) {
      newCentroid[d] /= norm || 1
    }

    // Update clusters array
    clusters[mergeI] = {
      documentIndices: mergedDocs,
      centroid: newCentroid,
    }
    clusters.splice(mergeJ, 1)

    if (onProgress) {
      onProgress((n - clusters.length) / (n - k))
    }
  }

  // Build final result with coherence
  const result: KMeansCluster[] = clusters.map((cluster) => {
    // Calculate coherence
    let coherence = 0
    if (cluster.documentIndices.length > 0) {
      coherence =
        cluster.documentIndices.reduce((sum, idx) => {
          const emb = embeddings[idx]
          return sum + (emb ? cosineSimilarity(emb, cluster.centroid) : 0)
        }, 0) / cluster.documentIndices.length
    }

    return {
      centroid: cluster.centroid,
      documentIndices: cluster.documentIndices,
      coherence,
    }
  })

  // Sort by cluster size (descending)
  result.sort((a, b) => b.documentIndices.length - a.documentIndices.length)

  return result
}
