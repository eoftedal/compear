import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch } from 'vue'
import type { CsvRow } from '@/utils/csvParser'
import { parseCSV } from '@/utils/csvParser'
import { parseXlsx } from '@/utils/xlsxParser'
import {
  initializeModel,
  generateEmbeddings,
  getCurrentModel,
  AVAILABLE_MODELS,
  MODEL_LABELS,
  DEFAULT_MODEL,
  type ModelName,
} from '@/utils/embeddings'
import {
  performClustering,
  extractKeywordsForClusters,
  getStopWordsSet,
  type ClusteringMethod,
} from '@/utils/topicModeling'

export interface Topic {
  id: number
  label: string
  keywords: string[]
  documentIndices: number[]
  centroid: number[]
  coherence?: number
}

export const useTopicModelingStore = defineStore('topicModeling', () => {
  // Model state
  const selectedModel = ref<ModelName>(DEFAULT_MODEL)
  const isModelLoading = ref(false)
  const isModelReady = ref(false)
  const modelError = ref<string | null>(null)

  // File data
  const csvHeaders = ref<string[]>([])
  const csvRows = ref<CsvRow[]>([])
  const fileName = ref<string | null>(null)
  const sheetName = ref<string | null>(null)

  // Column selections
  const analysisColumns = ref<string[]>([])
  const displayColumns = ref<string[]>([])

  // Topic modeling settings
  const clusteringMethod = ref<ClusteringMethod>('kmeans')
  const numberOfTopics = ref(5)
  const topKeywords = ref(10)
  const ngramSize = ref(1)
  const stopWordsPreset = ref<'minimal' | 'standard' | 'extensive'>('standard')
  const customStopWords = ref(localStorage.getItem('compear_custom_stopwords') || '')

  // Results
  // shallowRef: deep reactivity would wrap every vector in a proxy, making the
  // O(N²·d) clustering loops run through proxy traps
  const embeddings = shallowRef<number[][]>([])
  const topics = ref<Topic[]>([])
  const isAnalyzing = ref(false)
  const analysisProgress = ref(0)
  const analysisPhase = ref<'embeddings' | 'clustering' | 'keywords' | ''>('')

  // Display settings
  const selectedTopicId = ref<number | null>(null)

  // Computed
  const mergedStopWords = computed(() =>
    getStopWordsSet(stopWordsPreset.value, customStopWords.value),
  )

  const hasData = computed(() => csvRows.value.length > 0)
  const canAnalyze = computed(
    () => hasData.value && analysisColumns.value.length > 0 && isModelReady.value,
  )

  const selectedTopic = computed(() => {
    if (selectedTopicId.value === null) return null
    return topics.value.find((t) => t.id === selectedTopicId.value) || null
  })

  const topicDocuments = computed(() => {
    if (!selectedTopic.value) return []
    return selectedTopic.value.documentIndices.map((idx) => csvRows.value[idx])
  })

  // Initialize model immediately
  async function loadModel() {
    // The embedding model is shared with comparison, so a ready flag on its own
    // isn't enough — the other view may have swapped a different model in since
    if (isModelLoading.value || (isModelReady.value && getCurrentModel() === selectedModel.value)) {
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
    topics.value = []
    selectedTopicId.value = null

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
      analysisColumns.value = []
      displayColumns.value = []
      embeddings.value = []
      topics.value = []
      selectedTopicId.value = null
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to parse file')
    }
  }

  // Set analysis columns
  function setAnalysisColumns(columns: string[]) {
    const changed =
      columns.length !== analysisColumns.value.length ||
      columns.some((col, i) => col !== analysisColumns.value[i])

    analysisColumns.value = columns

    // Embeddings are derived from these columns, so cached ones are now stale
    if (changed) {
      embeddings.value = []
      topics.value = []
      selectedTopicId.value = null
    }

    // Default display columns to analysis columns
    if (displayColumns.value.length === 0) {
      displayColumns.value = [...columns]
    }
  }

  // Set display columns
  function setDisplayColumns(columns: string[]) {
    displayColumns.value = columns
  }

  // Run topic modeling
  async function runTopicModeling() {
    if (!canAnalyze.value) {
      throw new Error('Cannot run analysis: missing data or model not ready')
    }

    isAnalyzing.value = true
    analysisProgress.value = 0

    try {
      // Skip embedding generation if already cached
      if (embeddings.value.length === 0) {
        analysisPhase.value = 'embeddings'

        // Generate text from selected columns for each row
        const texts = csvRows.value.map((row) => {
          return analysisColumns.value.map((col) => row[col] || '').join(' ')
        })

        // Generate embeddings with progress tracking (0-60%)
        embeddings.value = await generateEmbeddings(
          texts,
          selectedModel.value,
          'clustering',
          (current: number, total: number) => {
            analysisProgress.value = Math.round((current / total) * 60)
          },
        )
      }

      // Perform clustering (60-90%)
      analysisPhase.value = 'clustering'
      const clusters = await performClustering(
        embeddings.value,
        numberOfTopics.value,
        clusteringMethod.value,
        (progress: number) => {
          analysisProgress.value = Math.round(60 + progress * 30)
        },
      )

      // Extract keywords (90-100%)
      analysisPhase.value = 'keywords'
      const clusterTexts = clusters.map((cluster) =>
        cluster.documentIndices.map((i) => {
          const row = csvRows.value[i]
          return analysisColumns.value.map((col) => row?.[col] || '').join(' ')
        }),
      )
      const keywordsPerCluster = extractKeywordsForClusters(
        clusterTexts,
        topKeywords.value,
        mergedStopWords.value,
        ngramSize.value,
      )

      topics.value = clusters.map((cluster, idx) => {
        const keywords = keywordsPerCluster[idx] ?? []
        return {
          id: idx,
          label: keywords.length
            ? `Topic ${idx + 1}: ${keywords.slice(0, 3).join(', ')}`
            : `Topic ${idx + 1}`,
          keywords,
          documentIndices: cluster.documentIndices,
          centroid: cluster.centroid,
          coherence: cluster.coherence,
        }
      })

      analysisProgress.value = 100
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Topic modeling failed')
    } finally {
      isAnalyzing.value = false
      analysisProgress.value = 0
      analysisPhase.value = ''
    }
  }

  // Reset all data
  function reset() {
    csvHeaders.value = []
    csvRows.value = []
    fileName.value = null
    sheetName.value = null
    analysisColumns.value = []
    displayColumns.value = []
    embeddings.value = []
    topics.value = []
    selectedTopicId.value = null
  }

  // Watch custom stop words and persist to localStorage
  watch(customStopWords, (newValue) => {
    localStorage.setItem('compear_custom_stopwords', newValue)
  })

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
    analysisColumns,
    displayColumns,
    clusteringMethod,
    numberOfTopics,
    topKeywords,
    ngramSize,
    stopWordsPreset,
    customStopWords,
    embeddings,
    topics,
    isAnalyzing,
    analysisProgress,
    analysisPhase,
    selectedTopicId,

    // Constants
    AVAILABLE_MODELS,
    MODEL_LABELS,

    // Computed
    hasData,
    canAnalyze,
    selectedTopic,
    topicDocuments,
    mergedStopWords,

    // Actions
    loadModel,
    changeModel,
    loadFile,
    setAnalysisColumns,
    setDisplayColumns,
    runTopicModeling,
    reset,
  }
})
