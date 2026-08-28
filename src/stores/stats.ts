import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CsvRow } from '@/utils/csvParser'
import { parseCSV } from '@/utils/csvParser'
import { parseXlsx } from '@/utils/xlsxParser'

export interface ValueCount {
  value: string
  count: number
}

export type StatsSort = 'count' | 'label'

export const useStatsStore = defineStore('stats', () => {
  // File data
  const csvHeaders = ref<string[]>([])
  const csvRows = ref<CsvRow[]>([])
  const fileName = ref<string | null>(null)
  const sheetName = ref<string | null>(null)

  // Column selection
  const statColumns = ref<string[]>([])

  // Chart settings
  const splitOnComma = ref(true)
  const sortBy = ref<StatsSort>('count')
  const maxBars = ref<number | null>(null)

  const hasData = computed(() => csvRows.value.length > 0)
  const hasSelection = computed(() => hasData.value && statColumns.value.length > 0)

  // Values a single row contributes, de-duplicated so a tag appearing in several
  // selected columns still counts the row once
  function valuesForRow(row: CsvRow): string[] {
    const values: string[] = []

    for (const column of statColumns.value) {
      const raw = row[column]
      if (!raw) continue

      const parts = splitOnComma.value ? raw.split(',') : [raw]
      for (const part of parts) {
        const value = part.trim()
        if (value.length > 0) values.push(value)
      }
    }

    // Case-insensitive de-duplication, keeping the first casing seen in this row
    const seen = new Set<string>()
    return values.filter((value) => {
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // All counts, sorted by count descending, before the top-N cut
  const allValueCounts = computed<ValueCount[]>(() => {
    if (!hasSelection.value) return []

    // Keyed by lower case so "AI" and "ai" merge; label is the first casing seen
    const counts = new Map<string, ValueCount>()

    for (const row of csvRows.value) {
      for (const value of valuesForRow(row)) {
        const key = value.toLowerCase()
        const entry = counts.get(key)
        if (entry) {
          entry.count++
        } else {
          counts.set(key, { value, count: 1 })
        }
      }
    }

    return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  })

  // The top-N cut always keeps the largest values, the sort setting only decides
  // how the kept ones are laid out
  const valueCounts = computed<ValueCount[]>(() => {
    const kept =
      maxBars.value == null ? allValueCounts.value : allValueCounts.value.slice(0, maxBars.value)

    if (sortBy.value === 'label') {
      return [...kept].sort((a, b) => a.value.localeCompare(b.value))
    }
    return kept
  })

  const maxCount = computed(() =>
    valueCounts.value.reduce((max, item) => Math.max(max, item.count), 0),
  )

  const rowsWithoutValue = computed(() => {
    if (!hasSelection.value) return 0
    return csvRows.value.filter((row) => valuesForRow(row).length === 0).length
  })

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
      statColumns.value = []
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to parse file')
    }
  }

  function setStatColumns(columns: string[]) {
    statColumns.value = columns
  }

  function reset() {
    csvHeaders.value = []
    csvRows.value = []
    fileName.value = null
    sheetName.value = null
    statColumns.value = []
  }

  return {
    // State
    csvHeaders,
    csvRows,
    fileName,
    sheetName,
    statColumns,
    splitOnComma,
    sortBy,
    maxBars,

    // Computed
    hasData,
    hasSelection,
    allValueCounts,
    valueCounts,
    maxCount,
    rowsWithoutValue,

    // Actions
    loadFile,
    setStatColumns,
    reset,
  }
})
