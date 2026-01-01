<template>
  <div class="topic-modeling-view">
    <h1>Topic Modeling</h1>
    <p class="subtitle">Discover topics and themes in your data using machine learning</p>

    <!-- Model Status -->
    <div class="model-status" :class="{ loading: store.isModelLoading, ready: store.isModelReady }">
      <template v-if="store.isModelLoading">
        <span class="status-icon">⏳</span>
        <span>Loading model...</span>
      </template>
      <template v-else-if="store.isModelReady">
        <span class="status-icon">✓</span>
        <span>Model ready: {{ store.selectedModel }}</span>
      </template>
      <template v-else-if="store.modelError">
        <span class="status-icon">✗</span>
        <span>Error: {{ store.modelError }}</span>
      </template>
    </div>

    <!-- Model Selection -->
    <div class="model-selection">
      <label for="model-select">Embedding Model:</label>
      <select
        id="model-select"
        v-model="selectedModel"
        @change="handleModelChange"
        :disabled="store.isModelLoading || store.isAnalyzing"
      >
        <option v-for="model in store.AVAILABLE_MODELS" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
      <p class="model-info">
        Smaller models (MiniLM-L6) are faster, larger models (MiniLM-L12, BGE) may be more accurate
      </p>
    </div>

    <!-- File Upload -->
    <FileUploaderTopic @file-loaded="handleFileLoaded" @columns-selected="handleColumnsSelected" />

    <!-- Topic Settings -->
    <div v-if="store.hasData" class="topic-settings">
      <h2>Topic Settings</h2>

      <div class="setting-row">
        <label for="num-topics">Number of Topics:</label>
        <input
          id="num-topics"
          type="number"
          v-model.number="store.numberOfTopics"
          min="2"
          max="20"
          :disabled="store.isAnalyzing"
        />
        <span class="setting-hint">How many topics to discover (2-20)</span>
      </div>

      <div class="setting-row">
        <label for="clustering-method">Clustering Method:</label>
        <select
          id="clustering-method"
          v-model="store.clusteringMethod"
          :disabled="store.isAnalyzing"
        >
          <option value="kmeans">K-Means (faster)</option>
          <option value="hierarchical">Hierarchical (more accurate)</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="top-keywords">Keywords per Topic:</label>
        <input
          id="top-keywords"
          type="number"
          v-model.number="store.topKeywords"
          min="5"
          max="20"
          :disabled="store.isAnalyzing"
        />
        <span class="setting-hint">Number of representative keywords (5-20)</span>
      </div>

      <button
        @click="runAnalysis"
        :disabled="!store.canAnalyze || store.isAnalyzing"
        class="analyze-button"
      >
        {{ store.isAnalyzing ? 'Analyzing...' : 'Discover Topics' }}
      </button>

      <!-- Progress Bar -->
      <div v-if="store.isAnalyzing" class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${store.analysisProgress}%` }"></div>
        </div>
        <div class="progress-text">{{ progressText }} ({{ store.analysisProgress }}%)</div>
      </div>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- Results -->
    <TopicResults v-if="store.topics.length > 0" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTopicModelingStore } from '@/stores/topicModeling'
import FileUploaderTopic from '@/components/FileUploaderTopic.vue'
import TopicResults from '@/components/TopicResults.vue'

const store = useTopicModelingStore()
const selectedModel = ref(store.selectedModel)
const error = ref<string | null>(null)

const progressText = computed(() => {
  switch (store.analysisPhase) {
    case 'embeddings':
      return 'Generating embeddings'
    case 'clustering':
      return 'Clustering documents'
    case 'keywords':
      return 'Extracting keywords'
    default:
      return 'Processing'
  }
})

async function handleModelChange() {
  try {
    error.value = null
    await store.changeModel(selectedModel.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to change model'
  }
}

function handleFileLoaded() {
  error.value = null
  store.topics = []
  store.selectedTopicId = null
}

function handleColumnsSelected(columns: string[]) {
  store.setAnalysisColumns(columns)
}

async function runAnalysis() {
  try {
    error.value = null

    // Only run topic modeling without regenerating embeddings
    await store.runTopicModeling()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Analysis failed'
  }
}
</script>

<style scoped>
.topic-modeling-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

h1 {
  margin-bottom: 0.5rem;
}

.subtitle {
  color: #666;
  margin-bottom: 2rem;
}

.model-status {
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f5f5f5;
}

.model-status.loading {
  background: #fff3cd;
  border: 1px solid #ffc107;
}

.model-status.ready {
  background: #d4edda;
  border: 1px solid #28a745;
}

.status-icon {
  font-size: 1.5rem;
}

.model-selection {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.model-selection label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.model-selection select {
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.model-info {
  font-size: 0.875rem;
  color: #666;
  margin: 0;
}

.topic-settings {
  margin-top: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.topic-settings h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.setting-row label {
  min-width: 150px;
  font-weight: 600;
}

.setting-row input,
.setting-row select {
  flex: 0 0 200px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.setting-hint {
  font-size: 0.875rem;
  color: #666;
}

.analyze-button {
  margin-top: 1.5rem;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.analyze-button:hover:not(:disabled) {
  background: #0056b3;
}

.analyze-button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.progress-container {
  margin-top: 1.5rem;
}

.progress-bar {
  width: 100%;
  height: 30px;
  background: #f0f0f0;
  border-radius: 15px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #007bff, #0056b3);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  font-size: 0.875rem;
  color: #666;
}

.error-message {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  color: #721c24;
}
</style>
