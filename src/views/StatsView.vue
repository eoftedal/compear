<template>
  <div class="stats-view">
    <h1>Stats</h1>
    <p class="subtitle">Count how many talks use each value in one or more columns</p>

    <!-- File Upload -->
    <FileUploaderStats @file-loaded="handleFileLoaded" />

    <!-- Chart Settings -->
    <div v-if="store.hasData" class="stats-settings">
      <h2>Chart Settings</h2>

      <div class="setting-row">
        <label class="checkbox-label">
          <input type="checkbox" v-model="store.splitOnComma" />
          <span>Split comma-separated values</span>
        </label>
        <span class="setting-hint">
          Treat "Architecture, AI, Work skills" as three separate values
        </span>
      </div>

      <div class="setting-row">
        <label for="sort-by">Sort by:</label>
        <select id="sort-by" v-model="store.sortBy">
          <option value="count">Count (highest first)</option>
          <option value="label">Name (A-Z)</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="max-bars">Show:</label>
        <select id="max-bars" v-model="maxBars">
          <option value="all">All values</option>
          <option value="10">Top 10</option>
          <option value="25">Top 25</option>
          <option value="50">Top 50</option>
          <option value="100">Top 100</option>
        </select>
        <span class="setting-hint">{{ store.allValueCounts.length }} distinct values found</span>
      </div>
    </div>

    <!-- Chart -->
    <div v-if="store.hasSelection" class="stats-results">
      <h2>{{ chartTitle }}</h2>
      <p class="results-summary">
        {{ store.allValueCounts.length }} distinct values across {{ store.csvRows.length }} rows
        <span v-if="store.rowsWithoutValue > 0">
          &middot; {{ store.rowsWithoutValue }} rows have no value
        </span>
        <span v-if="store.valueCounts.length < store.allValueCounts.length">
          &middot; showing top {{ store.valueCounts.length }}
        </span>
      </p>

      <p v-if="store.allValueCounts.length === 0" class="empty-message">
        The selected columns are empty for every row.
      </p>
      <StatsChart
        v-else
        :items="store.valueCounts"
        :max-count="store.maxCount"
        :total-rows="store.csvRows.length"
      />
    </div>

    <p v-else-if="store.hasData" class="hint-message">
      Select one or more columns above to see the chart.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '@/stores/stats'
import FileUploaderStats from '@/components/FileUploaderStats.vue'
import StatsChart from '@/components/StatsChart.vue'

const store = useStatsStore()

// The select needs a string value, the store holds null for "all"
const maxBars = computed({
  get: () => (store.maxBars == null ? 'all' : String(store.maxBars)),
  set: (value: string) => {
    store.maxBars = value === 'all' ? null : Number(value)
  },
})

const chartTitle = computed(() => store.statColumns.join(' + '))

function handleFileLoaded() {
  // Column selection is reset by the store, nothing else to clear
}
</script>

<style scoped>
.stats-view {
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

.stats-settings {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.stats-settings h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.setting-row:last-child {
  margin-bottom: 0;
}

.setting-row > label {
  min-width: 150px;
  font-weight: 600;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

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

.stats-results {
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.stats-results h2 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.results-summary {
  color: #666;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.empty-message,
.hint-message {
  color: #666;
}

.hint-message {
  padding: 1.5rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
</style>
