<script setup lang="ts">
import type { ValueCount } from '@/stores/stats'

const props = defineProps<{
  items: ValueCount[]
  maxCount: number
  totalRows: number
}>()

function barWidth(count: number): string {
  if (props.maxCount <= 0) return '0%'
  return `${(count / props.maxCount) * 100}%`
}

// Keep the number inside the bar only while there is room for it, otherwise it
// is rendered just after the bar
function fitsInside(count: number): boolean {
  if (props.maxCount <= 0) return false
  const percent = (count / props.maxCount) * 100
  return percent >= 6 + String(count).length * 3
}

function percentOfRows(count: number): string {
  if (props.totalRows <= 0) return '0%'
  return `${((count / props.totalRows) * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="stats-chart">
    <div v-for="item in items" :key="item.value" class="chart-row">
      <div class="chart-label" :title="item.value">{{ item.value }}</div>
      <div
        class="chart-track"
        :title="`${item.value}: ${item.count} (${percentOfRows(item.count)})`"
      >
        <div class="chart-bar" :style="{ width: barWidth(item.count) }">
          <span v-if="fitsInside(item.count)" class="chart-value inside">{{ item.count }}</span>
        </div>
        <span v-if="!fitsInside(item.count)" class="chart-value outside">{{ item.count }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-chart {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.chart-row {
  display: grid;
  grid-template-columns: minmax(0, 220px) 1fr;
  align-items: center;
  gap: 0.75rem;
}

.chart-label {
  text-align: right;
  font-size: 0.9rem;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-track {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 26px;
}

.chart-bar {
  height: 22px;
  min-width: 2px;
  border-radius: 3px;
  background: linear-gradient(90deg, #007bff, #0056b3);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transition: width 0.3s ease;
}

.chart-value {
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chart-value.inside {
  color: white;
  padding-right: 0.5rem;
}

.chart-value.outside {
  color: #495057;
}

@media (max-width: 768px) {
  .chart-row {
    grid-template-columns: minmax(0, 120px) 1fr;
  }
}
</style>
