<script setup lang="ts">
import { ref, computed } from 'vue'
import { useComparisonStore } from '@/stores/comparison'

const store = useComparisonStore()
const customRowLimit = ref(50)

const tableHeaders = computed(() => {
  if (store.displayColumns.length === 0) {
    return []
  }
  const headers = ['Similarity']
  for (const col of store.displayColumns) {
    headers.push(`Row A: ${col}`)
    headers.push(`Row B: ${col}`)
  }
  return headers
})

function updateRowLimit() {
  const value = Number(customRowLimit.value)
  if (value > 0) {
    store.maxDisplayRows = value
  }
}

function formatScore(score: number): string {
  return (score * 100).toFixed(2) + '%'
}

function getScoreClass(score: number): string {
  if (score >= 0.9) return 'score-high'
  if (score >= 0.7) return 'score-medium'
  return 'score-low'
}
</script>

<template>
  <div class="comparison-results">
    <div v-if="store.isComparing" class="loading-state">
      <div class="loading-spinner"></div>
      <p class="loading-text">Generating embeddings and calculating similarities...</p>
    </div>

    <div v-else-if="store.similarityResults.length === 0" class="no-results">
      <p>No comparison results yet. Upload a CSV and run comparison.</p>
    </div>

    <div v-else class="results-container">
      <div class="results-header">
        <h2>Comparison Results</h2>
        <div class="controls">
          <label class="row-limit-control">
            Show top
            <input
              v-model="customRowLimit"
              type="number"
              min="1"
              :max="store.similarityResults.length"
              @change="updateRowLimit"
              class="row-limit-input"
            />
            rows (of {{ store.similarityResults.length }} total pairs)
          </label>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th class="row-number">#</th>
              <th v-for="header in tableHeaders" :key="header">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(result, index) in store.displayedResults" :key="index">
              <td class="row-number">{{ index + 1 }}</td>

              <!-- Similarity score -->
              <td :class="['score-cell', getScoreClass(result.score)]">
                {{ formatScore(result.score) }}
              </td>

              <!-- Columns pairwise -->
              <template v-for="col in store.displayColumns" :key="col">
                <td class="data-cell">
                  {{ store.csvRows[result.rowIndexA]?.[col] || '-' }}
                </td>
                <td class="data-cell">
                  {{ store.csvRows[result.rowIndexB]?.[col] || '-' }}
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comparison-results {
  padding: 2rem;
  max-width: 100%;
  margin: 0 auto;
}

.no-results {
  text-align: center;
  padding: 3rem;
  color: #666;
  font-size: 1.1rem;
}

.loading-state {
  text-align: center;
  padding: 4rem 2rem;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f0f0f0;
  border-top-color: #42b883;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1.5rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  color: #666;
  font-size: 1.1rem;
  font-weight: 500;
}

.results-container {
  width: 100%;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.results-header h2 {
  font-size: 1.5rem;
  margin: 0;
}

.controls {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.row-limit-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #666;
}

.row-limit-input {
  width: 80px;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.results-table thead {
  background: #f5f5f5;
  position: sticky;
  top: 0;
  z-index: 10;
}

.results-table th {
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #e0e0e0;
  white-space: nowrap;
}

.results-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f0f0f0;
}

.results-table tbody tr:hover {
  background: #f9f9f9;
}

.row-number {
  text-align: center;
  font-weight: 600;
  color: #666;
  width: 60px;
}

.data-cell {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score-cell {
  font-weight: 600;
  text-align: center;
  width: 100px;
}

.score-high {
  color: #2e7d32;
  background: #e8f5e9;
}

.score-medium {
  color: #f57c00;
  background: #fff3e0;
}

.score-low {
  color: #1976d2;
  background: #e3f2fd;
}

@media (max-width: 768px) {
  .comparison-results {
    padding: 1rem;
  }

  .results-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .results-table {
    font-size: 0.8rem;
  }

  .results-table th,
  .results-table td {
    padding: 0.5rem;
  }

  .data-cell {
    max-width: 150px;
  }
}
</style>
