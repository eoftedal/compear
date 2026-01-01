# Compear - AI Assistant Instructions

## Project Overview

Browser-based CSV/XLSX comparison tool using semantic similarity. Upload files, select columns, and find similar rows using ML embeddings (transformers.js) running entirely in-browser—no backend.

## Architecture

### Data Flow

1. **Model loading**: Starts immediately when app loads (Pinia store creation) - see [src/stores/comparison.ts](../src/stores/comparison.ts#L151)
2. **File upload**: User uploads CSV/XLSX → parsed → stored in Pinia
3. **Column selection**: User picks comparison columns (for embeddings) + display columns (for results table)
4. **Comparison**: Selected column values → concatenated text → embeddings → pairwise cosine similarity (N²) → sorted results

### Key Components

- **Pinia Store** ([src/stores/comparison.ts](../src/stores/comparison.ts)): Central state for model, data, embeddings, and results
- **Embeddings** ([src/utils/embeddings.ts](../src/utils/embeddings.ts)): Xenova/transformers.js pipeline with model switching support
- **WebGPU Acceleration** ([src/utils/webgpuSimilarity.ts](../src/utils/webgpuSimilarity.ts)): GPU-accelerated similarity calculations and K-means clustering
- **File Parsers**: CSV via papaparse, XLSX via xlsx library with multi-sheet support
- **Components**: FileUploader handles upload/column selection, ComparisonResults displays similarity pairs

## Critical Patterns

### Model Management

- Model loads **on store creation** before user uploads files (see `loadModel()` in store)
- Always check `isModelReady` before running comparisons
- Multiple models supported via `AVAILABLE_MODELS` constant - switching clears cache
- Singleton pipeline instance in embeddings.ts prevents duplicate loads

### File Handling

- `loadFile(file, fileType, selectedSheet?)` supports both CSV and XLSX
- XLSX requires sheet selection - `readWorkbook()` extracts sheet names first
- Legacy `loadCSV()` exists for backward compatibility but use `loadFile()`

### Comparison Column vs Display Column Pattern

- **Comparison columns**: Generate embeddings (concatenated text from these columns)
- **Display columns**: Show in results table (independent selection)
- Display columns default to comparison columns but can differ
- See [src/components/FileUploader.vue](../src/components/FileUploader.vue#L73) for toggle logic

### Pairwise Similarity

- Calculates similarity for all row pairs (excluding self-comparison via `i < j` loop)
- Results include `rowIndexA`, `rowIndexB`, `score`
- Sorted descending by score in store
- Default display limit: 50 rows (configurable)

## Development Commands

```bash
npm run dev          # Dev server with HMR
npm run build        # Type-check + production build
npm run preview      # Preview production build
npm run lint         # ESLint with auto-fix
npm run format       # Prettier format
npm run type-check   # Vue TSC type checking
```

## Important Conventions

### State Management

- All app state lives in Pinia store - no prop drilling
- Use `useComparisonStore()` in components
- Mutations happen via store functions, not direct refs

### Type Safety

- CSV rows typed as `CsvRow` (Record<string, string>)
- Always use `ModelName` type for model selection
- Embeddings are `number[][]` (array of vectors)

### Error Handling

- File operations catch and display errors in component `error` refs
- Model loading errors stored in `modelError` state
- Always await async store functions and wrap in try/catch

### UI Patterns

- Loading states: `isModelLoading`, `isComparing` for spinner display
- Expandable rows in results table (click to show all fields)
- Sheet selector appears only for XLSX files

## External Dependencies

- **@xenova/transformers**: ML models run in-browser via WASM/WebGPU
- **papaparse**: CSV parsing with header detection
- **xlsx**: Excel file reading with multi-sheet support
- **WebGPU**: GPU acceleration for embeddings, similarity calculations, and clustering (automatic fallback to CPU)
- Vite config sets `base: '/compear/'` for GitHub Pages deployment

## GPU Acceleration

### WebGPU Support

The app automatically detects and uses WebGPU when available:

- **Embedding generation**: Accelerated via transformers.js WebGPU backend
- **Similarity calculations**: Custom compute shaders for pairwise comparisons
- **K-means clustering**: GPU-accelerated centroid assignment and similarity calculations
- **Fallback**: Automatically falls back to CPU (WASM) if WebGPU unavailable

### WebGPU Implementation

- [src/utils/webgpuSimilarity.ts](../src/utils/webgpuSimilarity.ts) contains compute shaders
- **K-means clustering**: GPU offloads point-to-centroid similarity (N × k calculations per iteration)
- **Hierarchical clustering**: GPU computes all pairwise cluster similarities per iteration
- Centroid/cluster updates remain on CPU for simplicity
- Topic modeling store automatically uses GPU clustering when available for both methods

## Common Tasks

### Adding a New Model

1. Add to `AVAILABLE_MODELS` in [src/utils/embeddings.ts](../src/utils/embeddings.ts#L6)
2. Update ModelName type automatically derives from constant
3. Model selector in UI updates from store's `AVAILABLE_MODELS` export

### Changing Similarity Algorithm

- Edit `cosineSimilarity()` in [src/utils/similarity.ts](../src/utils/similarity.ts#L1)
- Embeddings from transformers.js are pre-normalized (pooling + normalize options)
- Results must include `rowIndexA`, `rowIndexB`, `score` for UI compatibility

### Adding File Format Support

- Create parser in `src/utils/` following `csvParser.ts` / `xlsxParser.ts` pattern
- Update `loadFile()` to accept new file type
- Add accept attribute to file input in FileUploader component
