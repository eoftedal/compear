import Papa from 'papaparse'

export interface CsvRow {
  [key: string]: string
}

export interface ParsedCsv {
  headers: string[]
  rows: CsvRow[]
}

export async function parseCSV(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parsing failed: ${results.errors[0]?.message || 'Unknown error'}`))
          return
        }

        const headers = results.meta.fields || []
        const rows = results.data as CsvRow[]

        resolve({ headers, rows })
      },
      error: (error) => {
        reject(new Error(`CSV parsing failed: ${error.message}`))
      },
    })
  })
}
