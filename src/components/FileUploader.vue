<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useComparisonStore } from '@/stores/comparison'
import { readWorkbook } from '@/utils/xlsxParser'

const store = useComparisonStore()
const fileInput = ref<HTMLInputElement | null>(null)
const error = ref<string | null>(null)
const currentFile = ref<File | null>(null)
const availableSheets = ref<string[]>([])
const selectedSheet = ref<string>('')
const sheetError = ref<string | null>(null)

// Watch for sheet selection changes and reload data
watch(selectedSheet, async (newSheet, oldSheet) => {
  if (newSheet && newSheet !== oldSheet && currentFile.value) {
    sheetError.value = null
    try {
      const fileType = getFileType(currentFile.value)
      if (fileType === 'xlsx') {
        await store.loadFile(currentFile.value, fileType, newSheet)
      }
    } catch (err) {
      sheetError.value = err instanceof Error ? err.message : 'Failed to load sheet'
    }
  }
})

function getFileType(file: File): 'csv' | 'xlsx' {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.xlsx')) return 'xlsx'
  throw new Error('Unsupported file type')
}

async function handleFileSelect(event: Event) {
  error.value = null
  sheetError.value = null
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (!file) {
    return
  }

  const name = file.name.toLowerCase()
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
    error.value = 'Please select a CSV or XLSX file'
    return
  }

  currentFile.value = file
  const fileType = getFileType(file)

  try {
    if (fileType === 'xlsx') {
      // Read workbook to get sheet names
      const workbookInfo = await readWorkbook(file)
      availableSheets.value = workbookInfo.sheetNames
      selectedSheet.value = workbookInfo.sheetNames[0] || ''

      // Load the first sheet by default
      if (selectedSheet.value) {
        await store.loadFile(file, fileType, selectedSheet.value)
      }
    } else {
      // CSV file - no sheet selection needed
      availableSheets.value = []
      selectedSheet.value = ''
      await store.loadFile(file, fileType)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load file'
    currentFile.value = null
    availableSheets.value = []
    selectedSheet.value = ''
  }
}

function toggleComparisonColumn(column: string) {
  const index = store.comparisonColumns.indexOf(column)
  if (index > -1) {
    store.setComparisonColumns(store.comparisonColumns.filter((c) => c !== column))
  } else {
    store.setComparisonColumns([...store.comparisonColumns, column])
  }
}

function toggleDisplayColumn(column: string) {
  const index = store.displayColumns.indexOf(column)
  if (index > -1) {
    store.setDisplayColumns(store.displayColumns.filter((c) => c !== column))
  } else {
    store.setDisplayColumns([...store.displayColumns, column])
  }
}

async function handleCompare() {
  error.value = null
  store.isComparing = true
  try {
    // Allow UI to update before starting heavy computation
    await nextTick()
    await store.runComparison()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Comparison failed'
  }
}
</script>

<template>
  <div class="csv-uploader">
    <div class="upload-section">
      <h2>Load File</h2>
      <p class="subtitle">Everything is done in your browser. Nothing is uploaded to a backend.</p>
      <input
        ref="fileInput"
        type="file"
        accept=".csv,.xlsx"
        @change="handleFileSelect"
        class="file-input"
      />
      <p v-if="store.fileName" class="file-name">Loaded: {{ store.fileName }}</p>
      <p v-if="store.hasData" class="data-info">
        {{ store.csvRows.length }} rows, {{ store.csvHeaders.length }} columns
      </p>
    </div>

    <!-- Sheet selector for XLSX files -->
    <div v-if="availableSheets.length > 0" class="sheet-selection">
      <label for="sheet-select" class="sheet-label">Select Sheet:</label>
      <select id="sheet-select" v-model="selectedSheet" class="sheet-select">
        <option v-for="sheet in availableSheets" :key="sheet" :value="sheet">
          {{ sheet }}
        </option>
      </select>
      <p v-if="sheetError" class="sheet-error">{{ sheetError }}</p>
    </div>

    <div v-if="store.hasData" class="column-selection">
      <div class="selection-group">
        <h3>Columns for Comparison</h3>
        <p class="help-text">Select which columns to use for similarity comparison</p>
        <div class="column-list">
          <label v-for="header in store.csvHeaders" :key="header" class="column-checkbox">
            <input
              type="checkbox"
              :checked="store.comparisonColumns.includes(header)"
              @change="toggleComparisonColumn(header)"
            />
            <span>{{ header }}</span>
          </label>
        </div>
      </div>

      <div class="selection-group">
        <h3>Columns to Display</h3>
        <p class="help-text">Select which columns to show in results table</p>
        <div class="column-list">
          <label v-for="header in store.csvHeaders" :key="header" class="column-checkbox">
            <input
              type="checkbox"
              :checked="store.displayColumns.includes(header)"
              @change="toggleDisplayColumn(header)"
            />
            <span>{{ header }}</span>
          </label>
        </div>
      </div>
    </div>

    <div v-if="store.hasData" class="action-section">
      <button
        @click="handleCompare"
        :disabled="!store.canCompare || store.isComparing"
        class="compare-button"
      >
        <div v-if="store.isComparing" class="button-content">
          <div class="button-spinner"></div>
          <span>Comparing...</span>
        </div>
        <span v-else-if="!store.isModelReady">Waiting for model...</span>
        <span v-else-if="store.comparisonColumns.length === 0">Select comparison columns</span>
        <span v-else>Compare Rows</span>
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.csv-uploader {
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
}

.upload-section {
  margin-bottom: 2rem;
}

.upload-section h2 {
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

.file-input {
  display: block;
  margin-bottom: 1rem;
  padding: 0.5rem;
  width: 100%;
  border: 2px solid #ccc;
  border-radius: 4px;
}

.file-name {
  color: #42b883;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.data-info {
  color: #666;
  font-size: 0.9rem;
}

.sheet-selection {
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f5f5f5;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.sheet-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #333;
}

.sheet-select {
  width: 100%;
  padding: 0.5rem;
  font-size: 1rem;
  border: 2px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.sheet-select:focus {
  outline: none;
  border-color: #42b883;
}

.sheet-error {
  color: #d32f2f;
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.column-selection {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  margin-bottom: 2rem;
}

.selection-group h3 {
  margin-bottom: 0.5rem;
  font-size: 1.2rem;
}

.subtitle {
  margin: 0em 0em 0.5em 0em;
}

.help-text {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 1rem;
}

.column-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 300px;
  overflow-y: auto;
  padding: 1rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #f9f9f9;
}

.column-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.column-checkbox input {
  cursor: pointer;
}

.column-checkbox:hover {
  background: #f0f0f0;
}

.action-section {
  margin-bottom: 2rem;
}

.compare-button {
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: white;
  background: #42b883;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.3s;
  width: 100%;
}

.compare-button:hover:not(:disabled) {
  background: #369970;
}

.compare-button:disabled {
  background: #bbb;
  color: #666;
  cursor: not-allowed;
  opacity: 0.6;
}

.button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.button-spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error {
  color: #d32f2f;
  margin-top: 1rem;
  padding: 0.75rem;
  background: #ffebee;
  border-radius: 4px;
  border-left: 4px solid #d32f2f;
}

@media (max-width: 768px) {
  .column-selection {
    grid-template-columns: 1fr;
  }
}
</style>
