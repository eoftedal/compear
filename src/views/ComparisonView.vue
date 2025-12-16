<script setup lang="ts">
import { useComparisonStore } from '@/stores/comparison'
import CsvUploader from '@/components/CsvUploader.vue'
import ComparisonResults from '@/components/ComparisonResults.vue'

const store = useComparisonStore()
</script>

<template>
  <div class="comparison-view">
    <header class="header">
      <h1>Compear 🍐</h1>
      <p class="subtitle">Compare CSV rows using AI-powered embeddings</p>

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
      <CsvUploader />
      <ComparisonResults />
    </main>
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
  margin-top: 1rem;
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
}
</style>
