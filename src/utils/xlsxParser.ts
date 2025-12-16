import * as XLSX from 'xlsx'

export interface XlsxRow {
  [key: string]: string
}

export interface ParsedXlsx {
  headers: string[]
  rows: XlsxRow[]
}

export interface WorkbookInfo {
  sheetNames: string[]
}

/**
 * Read an XLSX file and return basic workbook information
 */
export async function readWorkbook(file: File): Promise<WorkbookInfo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        if (!data) {
          reject(new Error('Failed to read file'))
          return
        }

        const workbook = XLSX.read(data, { type: 'array' })
        resolve({ sheetNames: workbook.SheetNames })
      } catch (error) {
        reject(
          new Error(
            `Failed to read workbook: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ),
        )
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * Parse a specific sheet from an XLSX file into the same format as CSV parser
 */
export async function parseXlsx(file: File, sheetName: string): Promise<ParsedXlsx> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        if (!data) {
          reject(new Error('Failed to read file'))
          return
        }

        const workbook = XLSX.read(data, { type: 'array' })

        // Validate sheet exists
        if (!workbook.SheetNames.includes(sheetName)) {
          reject(new Error(`Sheet "${sheetName}" not found in workbook`))
          return
        }

        const worksheet = workbook.Sheets[sheetName]

        if (!worksheet) {
          reject(new Error(`Sheet "${sheetName}" could not be loaded`))
          return
        }

        // Convert to JSON with header row
        const jsonData = XLSX.utils.sheet_to_json<XlsxRow>(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        })

        // Validate sheet has data
        if (jsonData.length === 0) {
          reject(new Error(`Sheet "${sheetName}" is empty`))
          return
        }

        // First row is headers
        const headerRow = jsonData[0] as unknown as string[]
        const headers = headerRow.map((h, i) => h?.toString().trim() || `Column ${i + 1}`)

        // Remaining rows are data
        const dataRows = jsonData.slice(1) as unknown as string[][]

        // Validate there is at least one data row
        if (dataRows.length === 0) {
          reject(new Error(`Sheet "${sheetName}" has no data rows`))
          return
        }

        // Convert to object format matching CSV parser
        const rows: XlsxRow[] = dataRows.map((row) => {
          const rowObj: XlsxRow = {}
          headers.forEach((header, index) => {
            rowObj[header] = row[index]?.toString().trim() || ''
          })
          return rowObj
        })

        resolve({ headers, rows })
      } catch (error) {
        reject(
          new Error(
            `Failed to parse XLSX: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ),
        )
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * Validate that a sheet has data rows (used for UI validation)
 */
export function validateSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): { valid: boolean; error?: string } {
  if (!workbook.SheetNames.includes(sheetName)) {
    return { valid: false, error: `Sheet "${sheetName}" not found` }
  }

  const worksheet = workbook.Sheets[sheetName]

  if (!worksheet) {
    return { valid: false, error: `Sheet "${sheetName}" could not be loaded` }
  }

  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false })

  if (jsonData.length === 0) {
    return { valid: false, error: `Sheet "${sheetName}" is empty` }
  }

  if (jsonData.length === 1) {
    return { valid: false, error: `Sheet "${sheetName}" has no data rows` }
  }

  return { valid: true }
}
