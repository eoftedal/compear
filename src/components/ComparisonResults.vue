<script setup lang="ts">
import { ref, computed } from 'vue'
import { useComparisonStore } from '@/stores/comparison'

const store = useComparisonStore()
const customRowLimit = ref(50)
const expandedRows = ref<Set<number>>(new Set())

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

const allFields = computed(() => {
  return store.csvHeaders
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

function toggleRow(index: number) {
  if (expandedRows.value.has(index)) {
    expandedRows.value.delete(index)
  } else {
    expandedRows.value.add(index)
  }
}

function isRowExpanded(index: number): boolean {
  return expandedRows.value.has(index)
}
</script>

<template>
  <div class="comparison-results">
    <div v-if="store.isComparing" class="loading-state">
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: store.comparisonProgress + '%' }"></div>
        </div>
        <p class="loading-text">
          <template v-if="store.comparisonPhase === 'embeddings'">
            Generating embeddings... {{ store.comparisonProgress }}%
          </template>
          <template v-else-if="store.comparisonPhase === 'similarity'">
            Calculating similarities... {{ store.comparisonProgress }}%
          </template>
        </p>
      </div>
    </div>

    <div v-else-if="store.similarityResults.length === 0" class="no-results">
      <p>No comparison results yet. Upload a CSV/XLSX and run comparison.</p>
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
            <template v-for="(result, index) in store.displayedResults" :key="index">
              <tr
                :class="['result-row', { expanded: isRowExpanded(index) }]"
                @click="toggleRow(index)"
              >
                <td class="row-number">
                  {{ index + 1 }}
                </td>

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

              <!-- Expanded row details -->
              <tr v-if="isRowExpanded(index)" class="expanded-details">
                <td :colspan="tableHeaders.length + 1">
                  <div class="details-container">
                    <h4>All Fields Comparison</h4>
                    <table class="details-table">
                      <thead>
                        <tr>
                          <th>Field Name</th>
                          <th>Row A</th>
                          <th>Row B</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="field in allFields" :key="field">
                          <td class="field-name">{{ field }}</td>
                          <td class="field-value">
                            {{ store.csvRows[result.rowIndexA]?.[field] || '-' }}
                          </td>
                          <td class="field-value">
                            {{ store.csvRows[result.rowIndexB]?.[field] || '-' }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
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

.progress-container {
  max-width: 500px;
  margin: 0 auto;
}

.progress-bar {
  width: 100%;
  height: 24px;
  background: #f0f0f0;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 1.5rem;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #42b883 0%, #35495e 100%);
  transition: width 0.3s ease;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(66, 184, 131, 0.3);
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

.result-row {
  cursor: pointer;
  transition: background 0.2s;
}

.result-row:hover {
  background: #f9f9f9;
}

.result-row.expanded {
  background: #f0f7ff;
}

.row-number {
  text-align: center;
  font-weight: 600;
  color: #666;
  width: 80px;
}

.expand-icon {
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 0.8rem;
  color: #666;
  transition: transform 0.2s;
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
  color: #c62828;
  background: #ffebee;
}

.score-medium {
  color: #f57c00;
  background: #fff3e0;
}

.score-low {
  color: #1976d2;
  background: #e3f2fd;
}

.expanded-details {
  background: #fafafa;
}

.expanded-details td {
  padding: 0;
}

.details-container {
  padding: 1.5rem;
}

.details-container h4 {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 1rem;
}

.details-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.details-table thead {
  background: #f5f5f5;
}

.details-table th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #e0e0e0;
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #666;
}

.details-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.9rem;
}

.details-table tbody tr:last-child td {
  border-bottom: none;
}

.field-name {
  font-weight: 600;
  color: #444;
  width: 25%;
}

.field-value {
  color: #333;
  word-break: break-word;
}

.details-table tbody tr:hover {
  background: #f9f9f9;
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
