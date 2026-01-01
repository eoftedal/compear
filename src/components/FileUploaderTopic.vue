<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTopicModelingStore } from '@/stores/topicModeling'
import { readWorkbook } from '@/utils/xlsxParser'

const store = useTopicModelingStore()
const fileInput = ref<HTMLInputElement | null>(null)
const error = ref<string | null>(null)
const currentFile = ref<File | null>(null)
const availableSheets = ref<string[]>([])
const selectedSheet = ref<string>('')
const sheetError = ref<string | null>(null)

const emit = defineEmits<{
  (e: 'file-loaded'): void
  (e: 'columns-selected', columns: string[]): void
}>()

// Watch for sheet selection changes and reload data
watch(selectedSheet, async (newSheet, oldSheet) => {
  if (newSheet && newSheet !== oldSheet && currentFile.value) {
    sheetError.value = null
    try {
      const fileType = getFileType(currentFile.value)
      if (fileType === 'xlsx') {
        await store.loadFile(currentFile.value, fileType, newSheet)
        emit('file-loaded')
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
        emit('file-loaded')
      }
    } else {
      // CSV file - no sheet selection needed
      availableSheets.value = []
      selectedSheet.value = ''
      await store.loadFile(file, fileType)
      emit('file-loaded')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load file'
    currentFile.value = null
    availableSheets.value = []
    selectedSheet.value = ''
  }
}

function toggleAnalysisColumn(column: string) {
  const index = store.analysisColumns.indexOf(column)
  if (index > -1) {
    store.setAnalysisColumns(store.analysisColumns.filter((c: string) => c !== column))
  } else {
    store.setAnalysisColumns([...store.analysisColumns, column])
  }
  emit('columns-selected', store.analysisColumns)
}

function toggleDisplayColumn(column: string) {
  const index = store.displayColumns.indexOf(column)
  if (index > -1) {
    store.setDisplayColumns(store.displayColumns.filter((c: string) => c !== column))
  } else {
    store.setDisplayColumns([...store.displayColumns, column])
  }
}
</script>

<template>
  <div class="file-uploader-topic">
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
      <p v-if="error" class="error">{{ error }}</p>
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
        <h3>Columns for Analysis</h3>
        <p class="help-text">Select which columns contain the text to analyze for topics</p>
        <div class="column-list">
          <label v-for="header in store.csvHeaders" :key="header" class="column-checkbox">
            <input
              type="checkbox"
              :checked="store.analysisColumns.includes(header)"
              @change="toggleAnalysisColumn(header)"
            />
            <span>{{ header }}</span>
          </label>
        </div>
      </div>

      <div class="selection-group">
        <h3>Columns to Display</h3>
        <p class="help-text">Select which columns to show in results</p>
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
  </div>
</template>

<style scoped>
.file-uploader-topic {
  margin-bottom: 2rem;
}

.upload-section {
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
}

.upload-section h2 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: #666;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.file-input {
  display: block;
  padding: 0.75rem;
  border: 2px dashed #ccc;
  border-radius: 4px;
  width: 100%;
  cursor: pointer;
  transition: border-color 0.2s;
}

.file-input:hover {
  border-color: #007bff;
}

.file-name {
  margin-top: 0.5rem;
  font-weight: 600;
  color: #007bff;
}

.data-info {
  color: #666;
  font-size: 0.875rem;
}

.error {
  color: #dc3545;
  margin-top: 0.5rem;
}

.sheet-selection {
  padding: 1rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
}

.sheet-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.sheet-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.sheet-error {
  color: #dc3545;
  margin-top: 0.5rem;
  margin-bottom: 0;
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

@media (max-width: 768px) {
  .column-selection {
    grid-template-columns: 1fr;
  }
}
</style>
