<template>
  <div class="topic-results">
    <h2>Discovered Topics</h2>
    <p class="results-summary">
      Found {{ store.topics.length }} topics from {{ store.csvRows.length }} documents
    </p>

    <div class="topics-container">
      <!-- Topic Cards -->
      <div class="topics-list">
        <div
          v-for="topic in store.topics"
          :key="topic.id"
          class="topic-card"
          :class="{ active: store.selectedTopicId === topic.id }"
          @click="selectTopic(topic.id)"
        >
          <div class="topic-header">
            <h3>{{ topic.label }}</h3>
            <span class="doc-count">{{ topic.documentIndices.length }} docs</span>
          </div>

          <div v-if="topic.coherence" class="coherence-score">
            <span class="label">Coherence:</span>
            <div class="score-bar">
              <div class="score-fill" :style="{ width: `${topic.coherence * 100}%` }"></div>
            </div>
            <span class="score-value">{{ (topic.coherence * 100).toFixed(1) }}%</span>
          </div>

          <div class="keywords">
            <span
              v-for="(keyword, idx) in topic.keywords"
              :key="idx"
              class="keyword"
              :style="{ fontSize: `${1 - idx * 0.05}rem` }"
            >
              {{ keyword }}
            </span>
          </div>
        </div>
      </div>

      <!-- Document Details -->
      <div v-if="store.selectedTopic" class="topic-details">
        <h3>{{ store.selectedTopic.label }} - Documents</h3>
        <p class="detail-subtitle">
          {{ store.selectedTopic.documentIndices.length }} documents in this topic
        </p>

        <div class="documents-list">
          <div
            v-for="(doc, idx) in displayedDocuments"
            :key="store.selectedTopic.documentIndices[idx]"
            class="document-card"
          >
            <div class="document-header">
              <span class="doc-number"
                >#{{ (store.selectedTopic.documentIndices[idx] ?? 0) + 1 }}</span
              >
              <button @click="toggleDocument(idx)" class="expand-btn">
                {{ expandedDocs.has(idx) ? '−' : '+' }}
              </button>
            </div>

            <div class="document-content">
              <!-- Analysis columns (highlighted) -->
              <div
                v-for="col in store.analysisColumns"
                :key="`${idx}-${col}`"
                class="field analysis-field"
              >
                <strong>{{ col }}:</strong>
                {{ doc?.[col] || 'N/A' }}
              </div>

              <!-- Other display columns (expanded) -->
              <div v-if="expandedDocs.has(idx)" class="expanded-fields">
                <div v-for="col in otherDisplayColumns" :key="`${idx}-${col}`" class="field">
                  <strong>{{ col }}:</strong>
                  {{ doc?.[col] || 'N/A' }}
                </div>
              </div>
            </div>
          </div>

          <!-- Load More Button -->
          <button v-if="hasMoreDocuments" @click="loadMoreDocuments" class="load-more-btn">
            Load More ({{ remainingDocuments }} remaining)
          </button>
        </div>
      </div>

      <!-- Placeholder when no topic selected -->
      <div v-else class="topic-placeholder">
        <p>👈 Select a topic to view its documents</p>
      </div>
    </div>

    <!-- Export Options -->
    <div class="export-section">
      <h3>Export Results</h3>
      <div class="export-buttons">
        <button @click="exportTopicsJson" class="export-btn">📄 Export Topics (JSON)</button>
        <button @click="exportTopicsCsv" class="export-btn">📊 Export Topics (CSV)</button>
        <button @click="exportDocumentAssignments" class="export-btn">
          📋 Export Document Assignments
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTopicModelingStore, type Topic } from '@/stores/topicModeling'

const store = useTopicModelingStore()
const expandedDocs = ref(new Set<number>())
const documentsToShow = ref(10)

const otherDisplayColumns = computed(() => {
  return store.displayColumns.filter((col: string) => !store.analysisColumns.includes(col))
})

const displayedDocuments = computed(() => {
  return store.topicDocuments.slice(0, documentsToShow.value)
})

const hasMoreDocuments = computed(() => {
  return store.topicDocuments.length > documentsToShow.value
})

const remainingDocuments = computed(() => {
  return store.topicDocuments.length - documentsToShow.value
})

function selectTopic(topicId: number) {
  store.selectedTopicId = topicId
  expandedDocs.value.clear()
  documentsToShow.value = 10
}

function toggleDocument(idx: number) {
  if (expandedDocs.value.has(idx)) {
    expandedDocs.value.delete(idx)
  } else {
    expandedDocs.value.add(idx)
  }
}

function loadMoreDocuments() {
  documentsToShow.value += 10
}

function exportTopicsJson() {
  const data = {
    model: store.selectedModel,
    clusteringMethod: store.clusteringMethod,
    numberOfTopics: store.numberOfTopics,
    topics: store.topics.map((t: Topic) => ({
      id: t.id,
      label: t.label,
      keywords: t.keywords,
      documentCount: t.documentIndices.length,
      coherence: t.coherence,
    })),
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `topics-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportTopicsCsv() {
  const rows = [['Topic ID', 'Topic Label', 'Document Count', 'Coherence', 'Keywords'].join(',')]

  for (const topic of store.topics) {
    rows.push(
      [
        topic.id,
        `"${topic.label}"`,
        topic.documentIndices.length,
        topic.coherence?.toFixed(3) || '',
        `"${topic.keywords.join(', ')}"`,
      ].join(','),
    )
  }

  const csv = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `topics-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportDocumentAssignments() {
  const rows = [['Document Index', 'Topic ID', 'Topic Label', ...store.displayColumns].join(',')]

  for (const topic of store.topics) {
    for (const docIdx of topic.documentIndices) {
      const doc = store.csvRows[docIdx]
      const row = [
        docIdx,
        topic.id,
        `"${topic.label}"`,
        ...store.displayColumns.map((col: string) => `"${doc?.[col] || ''}"`),
      ]
      rows.push(row.join(','))
    }
  }

  const csv = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `document-assignments-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.topic-results {
  margin-top: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.topic-results h2 {
  margin-top: 0;
}

.results-summary {
  color: #666;
  margin-bottom: 1.5rem;
}

.topics-container {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.topics-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 600px;
  overflow-y: auto;
}

.topic-card {
  padding: 1rem;
  background: #f8f9fa;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.topic-card:hover {
  background: #e9ecef;
  border-color: #dee2e6;
}

.topic-card.active {
  background: #e7f3ff;
  border-color: #007bff;
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.topic-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.doc-count {
  background: #007bff;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.875rem;
}

.coherence-score {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}

.score-bar {
  flex: 1;
  height: 8px;
  background: #e9ecef;
  border-radius: 4px;
  overflow: hidden;
}

.score-fill {
  height: 100%;
  background: linear-gradient(90deg, #28a745, #20c997);
}

.score-value {
  font-weight: 600;
  min-width: 45px;
  text-align: right;
}

.keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.keyword {
  background: white;
  padding: 0.25rem 0.75rem;
  border-radius: 16px;
  font-weight: 500;
  color: #007bff;
}

.topic-details {
  max-height: 600px;
  overflow-y: auto;
}

.detail-subtitle {
  color: #666;
  margin-bottom: 1rem;
}

.documents-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.document-card {
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #dee2e6;
}

.document-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.doc-number {
  font-weight: 600;
  color: #007bff;
}

.expand-btn {
  background: #007bff;
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-btn:hover {
  background: #0056b3;
}

.document-content .field {
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
}

.analysis-field {
  background: #fff;
  padding: 0.5rem;
  border-radius: 4px;
  border-left: 3px solid #007bff;
}

.expanded-fields {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #dee2e6;
}

.topic-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 600px;
  font-size: 1.2rem;
  color: #999;
}

.load-more-btn {
  width: 100%;
  padding: 0.75rem;
  background: #f8f9fa;
  border: 2px dashed #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  color: #007bff;
  font-weight: 600;
}

.load-more-btn:hover {
  background: #e9ecef;
  border-color: #007bff;
}

.export-section {
  margin-top: 2rem;
  padding-top: 2rem;
  border-top: 2px solid #dee2e6;
}

.export-section h3 {
  margin-top: 0;
  margin-bottom: 1rem;
}

.export-buttons {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.export-btn {
  padding: 0.75rem 1.5rem;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

.export-btn:hover {
  background: #218838;
}

@media (max-width: 768px) {
  .topics-container {
    grid-template-columns: 1fr;
  }

  .topics-list {
    max-height: 400px;
  }
}
</style>
