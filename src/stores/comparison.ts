import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CsvRow } from '@/utils/csvParser'
import { parseCSV } from '@/utils/csvParser'
import { parseXlsx } from '@/utils/xlsxParser'
import {
  initializeModel,
  generateEmbeddings,
  AVAILABLE_MODELS,
  type ModelName,
} from '@/utils/embeddings'
import { calculatePairwiseSimilarities, type SimilarityPair } from '@/utils/similarity'

export const useComparisonStore = defineStore('comparison', () => {
  // Model state
  const selectedModel = ref<ModelName>('Xenova/all-MiniLM-L6-v2')
  const isModelLoading = ref(false)
  const isModelReady = ref(false)
  const modelError = ref<string | null>(null)

  // File data
  const csvHeaders = ref<string[]>([])
  const csvRows = ref<CsvRow[]>([])
  const fileName = ref<string | null>(null)
  const sheetName = ref<string | null>(null)

  // Column selections
  const comparisonColumns = ref<string[]>([])
  const displayColumns = ref<string[]>([])

  // Embeddings and results
  const embeddings = ref<number[][]>([])
  const similarityResults = ref<SimilarityPair[]>([])
  const isComparing = ref(false)

  // Display settings
  const maxDisplayRows = ref(50)

  // Computed
  const hasData = computed(() => csvRows.value.length > 0)
  const canCompare = computed(
    () => hasData.value && comparisonColumns.value.length > 0 && isModelReady.value,
  )

  const displayedResults = computed(() => {
    return similarityResults.value.slice(0, maxDisplayRows.value)
  })

  // Initialize model immediately
  async function loadModel() {
    if (isModelReady.value || isModelLoading.value) {
      return
    }

    isModelLoading.value = true
    modelError.value = null

    try {
      await initializeModel(selectedModel.value)
      isModelReady.value = true
    } catch (error) {
      modelError.value = error instanceof Error ? error.message : 'Failed to load model'
      console.error('Model loading error:', error)
    } finally {
      isModelLoading.value = false
    }
  }

  // Change model
  async function changeModel(modelName: ModelName) {
    selectedModel.value = modelName
    isModelReady.value = false

    // Clear embeddings and results when model changes
    embeddings.value = []
    similarityResults.value = []

    await loadModel()
  }

  // Load file (CSV or XLSX)
  async function loadFile(file: File, fileType: 'csv' | 'xlsx', selectedSheet?: string) {
    try {
      let parsed

      if (fileType === 'csv') {
        parsed = await parseCSV(file)
        sheetName.value = null
      } else if (fileType === 'xlsx') {
        if (!selectedSheet) {
          throw new Error('Sheet name is required for XLSX files')
        }
        parsed = await parseXlsx(file, selectedSheet)
        sheetName.value = selectedSheet
      } else {
        throw new Error('Unsupported file type')
      }

      csvHeaders.value = parsed.headers
      csvRows.value = parsed.rows
      fileName.value = file.name

      // Reset selections and results
      comparisonColumns.value = []
      displayColumns.value = []
      embeddings.value = []
      similarityResults.value = []
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to parse file')
    }
  }

  // Legacy function for backward compatibility
  async function loadCSV(file: File) {
    return loadFile(file, 'csv')
  }

  // Set comparison columns
  function setComparisonColumns(columns: string[]) {
    comparisonColumns.value = columns
    // Default display columns to comparison columns
    if (displayColumns.value.length === 0) {
      displayColumns.value = [...columns]
    }
  }

  // Set display columns
  function setDisplayColumns(columns: string[]) {
    displayColumns.value = columns
  }

  // Run comparison
  async function runComparison() {
    if (!canCompare.value) {
      throw new Error('Cannot run comparison: missing data or model not ready')
    }

    isComparing.value = true

    try {
      // Generate text from selected columns for each row
      const texts = csvRows.value.map((row) => {
        return comparisonColumns.value.map((col) => row[col] || '').join(' ')
      })

      // Generate embeddings
      embeddings.value = await generateEmbeddings(texts)

      // Calculate pairwise similarities (excluding self-comparison)
      similarityResults.value = calculatePairwiseSimilarities(embeddings.value, true)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Comparison failed')
    } finally {
      isComparing.value = false
    }
  }

  // Reset all data
  function reset() {
    csvHeaders.value = []
    csvRows.value = []
    fileName.value = null
    sheetName.value = null
    comparisonColumns.value = []
    displayColumns.value = []
    embeddings.value = []
    similarityResults.value = []
  }

  // Start loading model on store creation
  loadModel()

  return {
    // State
    selectedModel,
    isModelLoading,
    isModelReady,
    modelError,
    csvHeaders,
    csvRows,
    fileName,
    sheetName,
    comparisonColumns,
    displayColumns,
    embeddings,
    similarityResults,
    isComparing,
    maxDisplayRows,

    // Constants
    AVAILABLE_MODELS,

    // Computed
    hasData,
    canCompare,
    displayedResults,

    // Actions
    loadModel,
    changeModel,
    loadFile,
    loadCSV,
    setComparisonColumns,
    setDisplayColumns,
    runComparison,
    reset,
  }
})
