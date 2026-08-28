// Deterministic PRNG (mulberry32) so clustering runs are reproducible:
// the same data and settings always produce the same topics.
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// k-means++ seeding: each new centroid is picked with probability proportional
// to its squared distance from the nearest already-chosen centroid. Plain
// random seeding regularly places two centroids in the same natural group and
// locks k-means into that local optimum — with a deterministic PRNG it would
// stay locked in on every run. Embeddings are normalized, so cosine distance
// reduces to 1 - dot product.
export function kMeansPlusPlusInit(
  embeddings: number[][],
  k: number,
  random: () => number,
): number[][] {
  const n = embeddings.length
  const centroids: number[][] = []

  const dot = (a: number[], b: number[]): number => {
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] || 0) * (b[i] || 0)
    }
    return sum
  }

  const first = Math.floor(random() * n)
  centroids.push([...embeddings[first]!])

  // Squared distance from each point to its nearest chosen centroid
  const minDistSq = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const d = 1 - dot(embeddings[i]!, centroids[0]!)
    minDistSq[i] = d * d
  }

  while (centroids.length < k) {
    let total = 0
    for (let i = 0; i < n; i++) {
      total += minDistSq[i]!
    }

    let idx = n - 1
    if (total > 0) {
      let target = random() * total
      for (let i = 0; i < n; i++) {
        target -= minDistSq[i]!
        if (target <= 0) {
          idx = i
          break
        }
      }
    } else {
      // All points coincide with a centroid; any pick is as good as another
      idx = Math.floor(random() * n)
    }

    const centroid = [...embeddings[idx]!]
    centroids.push(centroid)

    for (let i = 0; i < n; i++) {
      const d = 1 - dot(embeddings[i]!, centroid)
      const dSq = d * d
      if (dSq < minDistSq[i]!) {
        minDistSq[i] = dSq
      }
    }
  }

  return centroids
}
