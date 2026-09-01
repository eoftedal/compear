<script setup lang="ts">
import { ref, computed, watch, shallowRef } from 'vue'
import { useComparisonStore } from '@/stores/comparison'
import { generateEmbedding } from '@/utils/embeddings'
import { cosineSimilarity } from '@/utils/similarity'

const store = useComparisonStore()
const customRowLimit = ref(50)
const expandedRows = ref<Set<number>>(new Set())
const searchInput = ref('')
const searchText = ref('')
const isFiltering = ref(false)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Semantic search state
const semanticSearchInput = ref('')
interface SemanticSearchResult {
  rowIndex: number
  score: number
}
const semanticSearchResults = shallowRef<SemanticSearchResult[]>([]) // Sorted rows by similarity
const isSemanticSearching = ref(false)
const semanticSearchLimit = ref(50)
const expandedSemanticRows = ref<Set<number>>(new Set())

// Similar talks state
const similarTalksMap = ref<Map<number, SemanticSearchResult[]>>(new Map())
const similarTalksLimit = ref(10)

function findSimilarTalks(rowIndex: number) {
  if (store.embeddings.length === 0) return
  const targetEmbedding = store.embeddings[rowIndex]
  if (!targetEmbedding) return

  const results: SemanticSearchResult[] = []
  for (let i = 0; i < store.embeddings.length; i++) {
    if (i === rowIndex) continue
    const score = cosineSimilarity(targetEmbedding, store.embeddings[i]!)
    results.push({ rowIndex: i, score })
  }
  results.sort((a, b) => b.score - a.score)

  const newMap = new Map(similarTalksMap.value)
  newMap.set(rowIndex, results)
  similarTalksMap.value = newMap
}

function getSimilarTalks(rowIndex: number): SemanticSearchResult[] {
  return (similarTalksMap.value.get(rowIndex) ?? []).slice(0, similarTalksLimit.value)
}

function hasSimilarTalks(rowIndex: number): boolean {
  return similarTalksMap.value.has(rowIndex)
}

// "Most similar" browser: every row, paginated, expanding to its closest neighbours.
// Shares similarTalksMap with the pair-table feature above, so a row already expanded
// there costs nothing to open here.
const MOST_SIMILAR_COUNT = 10
const mostSimilarPage = ref(1)
const mostSimilarPageSize = ref(25)
const expandedMostSimilarRows = ref<Set<number>>(new Set())
const mostSimilarSearchInput = ref('')
const mostSimilarSearchText = ref('')
let mostSimilarDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Debounced like the comparison-results filter, so typing doesn't re-page on every key
watch(mostSimilarSearchInput, (newValue) => {
  if (mostSimilarDebounceTimer) {
    clearTimeout(mostSimilarDebounceTimer)
  }
  mostSimilarDebounceTimer = setTimeout(() => {
    mostSimilarSearchText.value = newValue
    // A narrower list can be shorter than the page the user is currently on
    mostSimilarPage.value = 1
  }, 300)
})

// Carries the row's index in csvRows, since that is what the embeddings are keyed by,
// and it has to survive filtering — neighbours are looked up by original index
const mostSimilarRows = computed(() => {
  const rows = store.csvRows.map((row, rowIndex) => ({ row, rowIndex }))
  const search = mostSimilarSearchText.value.trim().toLowerCase()

  if (!search) {
    return rows
  }

  return rows.filter(({ row }) =>
    store.displayColumns.some((col) => (row[col] || '').toLowerCase().includes(search)),
  )
})

const mostSimilarTotalPages = computed(() =>
  Math.max(1, Math.ceil(mostSimilarRows.value.length / mostSimilarPageSize.value)),
)

const pagedRows = computed(() => {
  const start = (mostSimilarPage.value - 1) * mostSimilarPageSize.value
  return mostSimilarRows.value.slice(start, start + mostSimilarPageSize.value)
})

function toggleMostSimilarRow(rowIndex: number) {
  if (expandedMostSimilarRows.value.has(rowIndex)) {
    expandedMostSimilarRows.value.delete(rowIndex)
    return
  }
  // Scored on demand: one pass over the embeddings, not the full pair list
  if (!similarTalksMap.value.has(rowIndex)) {
    findSimilarTalks(rowIndex)
  }
  expandedMostSimilarRows.value.add(rowIndex)
}

function isMostSimilarExpanded(rowIndex: number): boolean {
  return expandedMostSimilarRows.value.has(rowIndex)
}

function getMostSimilar(rowIndex: number): SemanticSearchResult[] {
  return (similarTalksMap.value.get(rowIndex) ?? []).slice(0, MOST_SIMILAR_COUNT)
}

function goToPage(page: number) {
  mostSimilarPage.value = Math.min(Math.max(1, page), mostSimilarTotalPages.value)
}

watch(mostSimilarPageSize, () => {
  mostSimilarPage.value = 1
})

// A fresh comparison invalidates the cached neighbour lists — they were scored against
// the previous embeddings, which a model or column change will have replaced
watch(
  () => store.similarityResults,
  () => {
    mostSimilarPage.value = 1
    expandedMostSimilarRows.value = new Set()
    similarTalksMap.value = new Map()
  },
)

async function performSemanticSearch() {
  const query = semanticSearchInput.value.trim()

  if (!query) {
    semanticSearchResults.value = []
    return
  }

  if (!store.isModelReady || store.embeddings.length === 0) {
    return
  }

  isSemanticSearching.value = true

  try {
    // Generate embedding for the search query
    // Same task as the corpus: a retrieval-query prefix would put the query in a
    // different region than the stored row vectors
    const queryEmbedding = await generateEmbedding(query, store.selectedModel, 'similarity')

    // Calculate similarity for all rows
    const results: SemanticSearchResult[] = []
    for (let i = 0; i < store.embeddings.length; i++) {
      const score = cosineSimilarity(queryEmbedding, store.embeddings[i]!)
      results.push({ rowIndex: i, score })
    }

    // Sort by similarity descending
    results.sort((a, b) => b.score - a.score)

    semanticSearchResults.value = results
    expandedSemanticRows.value.clear()
  } catch (error) {
    console.error('Semantic search failed:', error)
  } finally {
    isSemanticSearching.value = false
  }
}

function clearSemanticSearch() {
  semanticSearchInput.value = ''
  semanticSearchResults.value = []
  expandedSemanticRows.value.clear()
}

const displayedSemanticResults = computed(() => {
  return semanticSearchResults.value.slice(0, semanticSearchLimit.value)
})

function toggleSemanticRow(index: number) {
  if (expandedSemanticRows.value.has(index)) {
    expandedSemanticRows.value.delete(index)
  } else {
    expandedSemanticRows.value.add(index)
  }
}

function isSemanticRowExpanded(index: number): boolean {
  return expandedSemanticRows.value.has(index)
}

// Debounce search input to avoid blocking UI
watch(searchInput, (newValue) => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
  }
  isFiltering.value = true
  searchDebounceTimer = setTimeout(() => {
    searchText.value = newValue
    isFiltering.value = false
  }, 300)
})

const tableHeaders = computed(() => {
  if (store.displayColumns.length === 0) {
    return []
  }
  const headers = ['Similarity']
  for (const col of store.displayColumns) {
    headers.push(`A: ${col}`)
    headers.push(`B: ${col}`)
  }
  return headers
})

// Use shallowRef to avoid deep reactivity on large arrays
const cachedFilteredResults = shallowRef(store.similarityResults)

// Watch for changes and update cached results (avoids side effects in computed)
watch(
  [searchText, () => store.displayColumns, () => store.similarityResults],
  ([currentSearchText, displayColumns, results]) => {
    const trimmedSearch = currentSearchText.trim()

    if (!trimmedSearch) {
      cachedFilteredResults.value = results
      return
    }

    const search = trimmedSearch.toLowerCase()
    cachedFilteredResults.value = results.filter((result) => {
      // Check if any display column contains the search text
      for (const col of displayColumns) {
        const valueA = store.csvRows[result.rowIndexA]?.[col] || ''
        const valueB = store.csvRows[result.rowIndexB]?.[col] || ''
        if (valueA.toLowerCase().includes(search) || valueB.toLowerCase().includes(search)) {
          return true
        }
      }
      return false
    })
  },
  { immediate: true },
)

const filteredResults = computed(() => cachedFilteredResults.value)

const displayedResults = computed(() => {
  return filteredResults.value.slice(0, store.maxDisplayRows)
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
        <div class="section-heading">
          <h2>Comparison Results</h2>
          <p class="section-description">Every pair of rows, ranked by similarity</p>
        </div>
        <div class="controls">
          <label class="search-control">
            <input
              v-model="searchInput"
              type="text"
              placeholder="Filter by text..."
              class="search-input"
            />
          </label>
          <label class="row-limit-control">
            Show top
            <input
              v-model="customRowLimit"
              type="number"
              min="1"
              :max="filteredResults.length"
              @change="updateRowLimit"
              class="row-limit-input"
            />
            rows (of {{ filteredResults.length }} filtered /
            {{ store.similarityResults.length }} total pairs)
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
            <template v-for="(result, index) in displayedResults" :key="index">
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

      <!-- Most Similar Section -->
      <div class="most-similar-section">
        <div class="most-similar-header">
          <div class="section-heading">
            <h2>Most Similar</h2>
            <p class="section-description">
              Click a row to see the {{ MOST_SIMILAR_COUNT }} most semantically similar rows
            </p>
          </div>
          <div class="most-similar-controls">
            <label class="search-control most-similar-search">
              <input
                v-model="mostSimilarSearchInput"
                type="text"
                placeholder="Filter by text..."
                class="search-input"
              />
            </label>
            <label class="row-limit-control">
              Rows per page
              <select v-model.number="mostSimilarPageSize" class="page-size-select">
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="mostSimilarRows.length === 0" class="semantic-hint">
          <p>No rows match that filter.</p>
        </div>

        <div v-else class="table-wrapper">
          <table class="results-table most-similar-table">
            <thead>
              <tr>
                <th class="row-number">#</th>
                <th v-for="col in store.displayColumns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="entry in pagedRows" :key="entry.rowIndex">
                <tr
                  :class="['result-row', { expanded: isMostSimilarExpanded(entry.rowIndex) }]"
                  @click="toggleMostSimilarRow(entry.rowIndex)"
                >
                  <td class="row-number">{{ entry.rowIndex + 1 }}</td>
                  <td v-for="col in store.displayColumns" :key="col" class="data-cell">
                    {{ entry.row?.[col] || '-' }}
                  </td>
                </tr>

                <tr v-if="isMostSimilarExpanded(entry.rowIndex)" class="expanded-details">
                  <td :colspan="store.displayColumns.length + 1">
                    <div class="details-container">
                      <h4>{{ MOST_SIMILAR_COUNT }} most similar rows</h4>
                      <table class="details-table similar-results-table">
                        <thead>
                          <tr>
                            <th class="score-header">Similarity</th>
                            <th v-for="col in store.displayColumns" :key="col">{{ col }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="similar in getMostSimilar(entry.rowIndex)"
                            :key="similar.rowIndex"
                          >
                            <td :class="['score-cell', getScoreClass(similar.score)]">
                              {{ formatScore(similar.score) }}
                            </td>
                            <td v-for="col in store.displayColumns" :key="col" class="field-value">
                              {{ store.csvRows[similar.rowIndex]?.[col] || '-' }}
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

        <div class="pagination">
          <button class="page-btn" :disabled="mostSimilarPage === 1" @click="goToPage(1)">
            « First
          </button>
          <button
            class="page-btn"
            :disabled="mostSimilarPage === 1"
            @click="goToPage(mostSimilarPage - 1)"
          >
            ‹ Prev
          </button>
          <span class="page-indicator">
            Page {{ mostSimilarPage }} of {{ mostSimilarTotalPages }} ({{
              mostSimilarRows.length
            }}
            of {{ store.csvRows.length }} rows)
          </span>
          <button
            class="page-btn"
            :disabled="mostSimilarPage >= mostSimilarTotalPages"
            @click="goToPage(mostSimilarPage + 1)"
          >
            Next ›
          </button>
          <button
            class="page-btn"
            :disabled="mostSimilarPage >= mostSimilarTotalPages"
            @click="goToPage(mostSimilarTotalPages)"
          >
            Last »
          </button>
        </div>
      </div>

      <!-- Semantic Search Section -->
      <div class="semantic-search-section">
        <div class="semantic-header">
          <div class="section-heading">
            <h2>Semantic Search</h2>
            <p class="section-description">Find rows by meaning, not keywords</p>
          </div>
          <div class="semantic-controls">
            <div class="semantic-input-wrapper">
              <input
                v-model="semanticSearchInput"
                type="text"
                placeholder="Search by meaning (press Enter)..."
                class="semantic-search-input"
                :disabled="
                  isSemanticSearching || !store.isModelReady || store.embeddings.length === 0
                "
                @keydown.enter="performSemanticSearch"
              />
              <button
                v-if="semanticSearchResults.length > 0"
                class="clear-semantic-btn"
                @click="clearSemanticSearch"
                title="Clear semantic search"
              >
                ×
              </button>
              <span v-if="isSemanticSearching" class="semantic-loading">⏳</span>
            </div>
            <label v-if="semanticSearchResults.length > 0" class="semantic-limit-control">
              Show top
              <input
                v-model="semanticSearchLimit"
                type="number"
                min="1"
                :max="semanticSearchResults.length"
                class="semantic-limit-input"
              />
              of {{ semanticSearchResults.length }} rows
            </label>
          </div>
        </div>

        <div v-if="store.embeddings.length === 0" class="semantic-hint">
          <p>Run comparison first to enable semantic search.</p>
        </div>

        <div
          v-else-if="semanticSearchResults.length === 0 && !isSemanticSearching"
          class="semantic-hint"
        >
          <p>Enter a query and press Enter to find similar rows.</p>
        </div>

        <div v-else-if="semanticSearchResults.length > 0" class="table-wrapper">
          <table class="results-table semantic-results-table">
            <thead>
              <tr>
                <th class="row-number">#</th>
                <th class="score-header">Similarity</th>
                <th v-for="col in store.displayColumns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(result, index) in displayedSemanticResults" :key="index">
                <tr
                  :class="['result-row', { expanded: isSemanticRowExpanded(index) }]"
                  @click="toggleSemanticRow(index)"
                >
                  <td class="row-number">{{ index + 1 }}</td>
                  <td :class="['score-cell', getScoreClass(result.score)]">
                    {{ formatScore(result.score) }}
                  </td>
                  <td v-for="col in store.displayColumns" :key="col" class="data-cell">
                    {{ store.csvRows[result.rowIndex]?.[col] || '-' }}
                  </td>
                </tr>

                <!-- Expanded row details -->
                <tr v-if="isSemanticRowExpanded(index)" class="expanded-details">
                  <td :colspan="store.displayColumns.length + 2">
                    <div class="details-container">
                      <div class="similar-talks-controls" @click.stop>
                        <button class="find-similar-btn" @click="findSimilarTalks(result.rowIndex)">
                          Find similar talks
                        </button>
                        <label
                          v-if="hasSimilarTalks(result.rowIndex)"
                          class="similar-limit-control"
                        >
                          Show top
                          <input
                            v-model.number="similarTalksLimit"
                            type="number"
                            min="1"
                            :max="store.embeddings.length - 1"
                            class="similar-limit-input"
                          />
                          talks
                        </label>
                      </div>

                      <div
                        v-if="hasSimilarTalks(result.rowIndex)"
                        class="similar-talks-results"
                        @click.stop
                      >
                        <table class="details-table similar-results-table">
                          <thead>
                            <tr>
                              <th class="score-header">Similarity</th>
                              <th v-for="col in store.displayColumns" :key="col">{{ col }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="similar in getSimilarTalks(result.rowIndex)"
                              :key="similar.rowIndex"
                            >
                              <td :class="['score-cell', getScoreClass(similar.score)]">
                                {{ formatScore(similar.score) }}
                              </td>
                              <td
                                v-for="col in store.displayColumns"
                                :key="col"
                                class="field-value"
                              >
                                {{ store.csvRows[similar.rowIndex]?.[col] || '-' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <h4>All Fields</h4>
                      <table class="details-table">
                        <thead>
                          <tr>
                            <th>Field Name</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="field in allFields" :key="field">
                            <td class="field-name">{{ field }}</td>
                            <td class="field-value">
                              {{ store.csvRows[result.rowIndex]?.[field] || '-' }}
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

.section-heading {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-description {
  margin: 0;
  font-size: 0.9rem;
  color: #666;
}

.controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.search-control {
  flex: 1;
  min-width: 200px;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.95rem;
  border: 2px solid #ddd;
  border-radius: 6px;
  transition: border-color 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #42b883;
}

.search-input::placeholder {
  color: #999;
}

/* Most Similar Section */
.most-similar-section {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 2px solid #e0e0e0;
}

.most-similar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.most-similar-header h2 {
  font-size: 1.5rem;
  margin: 0;
  color: #00695c;
}

.most-similar-controls {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.most-similar-search {
  min-width: 240px;
}

.most-similar-search .search-input:focus {
  border-color: #00695c;
}

.page-size-select {
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
  background: white;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.page-btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.9rem;
  background: #00695c;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: #004d40;
}

.page-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.page-indicator {
  font-size: 0.9rem;
  color: #555;
  padding: 0 0.75rem;
}

/* Semantic Search Section */
.semantic-search-section {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 2px solid #e0e0e0;
}

.semantic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.semantic-header h2 {
  font-size: 1.5rem;
  margin: 0;
  color: #7b1fa2;
}

.semantic-controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.semantic-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 300px;
}

.semantic-search-input {
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 0.75rem;
  font-size: 0.95rem;
  border: 2px solid #9c27b0;
  border-radius: 6px;
  transition: border-color 0.2s;
  background: #faf5ff;
}

.semantic-search-input:focus {
  outline: none;
  border-color: #7b1fa2;
}

.semantic-search-input::placeholder {
  color: #9c27b0;
  opacity: 0.6;
}

.semantic-search-input:disabled {
  background: #f5f5f5;
  border-color: #ccc;
  cursor: not-allowed;
}

.clear-semantic-btn {
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #9c27b0;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.clear-semantic-btn:hover {
  color: #7b1fa2;
}

.semantic-loading {
  position: absolute;
  right: 0.5rem;
  font-size: 0.9rem;
}

.semantic-limit-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #666;
}

.semantic-limit-input {
  width: 80px;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

.semantic-hint {
  text-align: center;
  padding: 2rem;
  color: #666;
  font-style: italic;
}

.similar-talks-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.find-similar-btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.9rem;
  background: #7b1fa2;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.2s;
}

.find-similar-btn:hover {
  background: #6a1899;
}

.similar-limit-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #555;
}

.similar-limit-input {
  width: 70px;
  padding: 0.3rem 0.4rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

.similar-talks-results {
  margin-bottom: 1.5rem;
}

.similar-results-table .score-header {
  width: 120px;
}

.semantic-results-table .score-header {
  width: 120px;
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
  white-space: pre-wrap;
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
