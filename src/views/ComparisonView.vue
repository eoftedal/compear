<script setup lang="ts">
import { ref } from 'vue'
import { useComparisonStore } from '@/stores/comparison'
import FileUploader from '@/components/FileUploader.vue'
import ComparisonResults from '@/components/ComparisonResults.vue'

const store = useComparisonStore()
const downloadPairCount = ref(50)

function downloadCSV() {
  if (store.similarityResults.length === 0) return

  const pairsToInclude = Math.min(downloadPairCount.value, store.similarityResults.length)
  const results = store.similarityResults.slice(0, pairsToInclude)

  // Build CSV headers
  const headers = ['Pair #', 'Similarity Score']
  for (const col of store.displayColumns) {
    headers.push(`A: ${col}`)
    headers.push(`B: ${col}`)
  }

  // Build CSV rows
  const csvRows = [headers]
  results.forEach((result, index) => {
    const row = [(index + 1).toString(), (result.score * 100).toFixed(2) + '%']

    for (const col of store.displayColumns) {
      row.push(store.csvRows[result.rowIndexA]?.[col] || '')
      row.push(store.csvRows[result.rowIndexB]?.[col] || '')
    }

    csvRows.push(row)
  })

  // Convert to CSV string (handle quotes and commas)
  const csvContent = csvRows
    .map((row) =>
      row
        .map((cell) => {
          const cellStr = cell.toString()
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`
          }
          return cellStr
        })
        .join(','),
    )
    .join('\n')

  // Create download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `comparison-results-${new Date().toISOString().split('T')[0]}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="comparison-view">
    <header class="header">
      <p class="subtitle">Compare CSV/XLSX rows using AI-powered embeddings.</p>

      <div class="model-controls">
        <label class="model-selector">
          <span class="label-text">Embedding Model:</span>
          <select
            v-model="store.selectedModel"
            @change="store.changeModel(store.selectedModel)"
            :disabled="store.isModelLoading"
            class="model-select"
          >
            <option v-for="model in store.AVAILABLE_MODELS" :key="model" :value="model">
              {{ model.replace('Xenova/', '') }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="store.isModelLoading" class="model-status loading">
        <div class="spinner"></div>
        <span>Loading {{ store.selectedModel.replace('Xenova/', '') }}...</span>
      </div>
      <div v-else-if="store.isModelReady" class="model-status ready">
        <span class="status-icon">✓</span>
        <span>{{ store.selectedModel.replace('Xenova/', '') }} ready</span>
      </div>
      <div v-else-if="store.modelError" class="model-status error">
        <span class="status-icon">✗</span>
        <span>{{ store.modelError }}</span>
      </div>
    </header>

    <main class="main-content">
      <FileUploader />
      <ComparisonResults />
    </main>

    <div v-if="store.similarityResults.length > 0" class="download-section">
      <h3>Download Results</h3>
      <div class="download-controls">
        <label class="pair-count-control">
          Number of pairs to include:
          <input
            v-model="downloadPairCount"
            type="number"
            min="1"
            :max="store.similarityResults.length"
            class="pair-count-input"
          />
          <span class="max-pairs">/ {{ store.similarityResults.length }} total</span>
        </label>
        <button @click="downloadCSV" class="download-button">
          <span class="download-icon">⬇</span>
          Download as CSV
        </button>
      </div>
      <p class="download-info">
        CSV will include the similarity score and
        {{ store.displayColumns.length > 0 ? store.displayColumns.join(', ') : 'all' }} column(s)
        from "Columns to display".
      </p>
    </div>
  </div>
</template>

<style scoped>
.comparison-view {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding-bottom: 2rem;
}

.header {
  background: white;
  padding: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
  text-align: center;
}

.header h1 {
  margin: 0 0 0.5rem 0;
  font-size: 2.5rem;
  color: #2c3e50;
}

.subtitle {
  margin: 0 0 1rem 0;
  font-size: 1.1rem;
  color: #666;
}

.model-controls {
  margin: 1rem 0;
}

.model-selector {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.95rem;
}

.label-text {
  font-weight: 500;
  color: #555;
}

.model-select {
  padding: 0.5rem 1rem;
  font-size: 0.95rem;
  border: 2px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s;
  min-width: 200px;
}

.model-select:hover:not(:disabled) {
  border-color: #42b883;
}

.model-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 24px;
  font-size: 0.9rem;
  font-weight: 500;
}

.model-status.loading {
  background: #fff3e0;
  color: #f57c00;
}

.model-status.ready {
  background: #e8f5e9;
  color: #2e7d32;
}

.model-status.error {
  background: #ffebee;
  color: #d32f2f;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-icon {
  font-weight: bold;
  font-size: 1.2rem;
}

.main-content {
  max-width: 1400px;
  margin: 0 auto;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.download-section {
  max-width: 1400px;
  margin: 2rem auto;
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.download-section h3 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.download-controls {
  display: flex;
  align-items: center;
  gap: 2rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.pair-count-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.95rem;
  color: #555;
}

.pair-count-input {
  padding: 0.5rem 0.75rem;
  font-size: 0.95rem;
  border: 2px solid #ddd;
  border-radius: 6px;
  width: 100px;
  transition: border-color 0.2s;
}

.pair-count-input:focus {
  outline: none;
  border-color: #42b883;
}

.max-pairs {
  color: #888;
  font-size: 0.9rem;
}

.download-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: white;
  background: #42b883;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.3s;
}

.download-button:hover {
  background: #369970;
}

.download-icon {
  font-size: 1.2rem;
}

.download-info {
  margin: 0;
  font-size: 0.9rem;
  color: #666;
  font-style: italic;
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 1.8rem;
  }

  .subtitle {
    font-size: 1rem;
  }

  .main-content {
    border-radius: 0;
  }

  .download-section {
    border-radius: 0;
    margin: 1rem 0;
  }

  .download-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .pair-count-control {
    flex-direction: column;
    align-items: flex-start;
  }

  .download-button {
    justify-content: center;
  }
}
</style>
