# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Compear is a browser-based CSV/XLSX analysis tool built with Vue 3 + TypeScript + Vite + Pinia. All ML runs client-side via `@huggingface/transformers` (transformers.js) — there is no backend. It has three features, each a route with its own Pinia store:

- **Comparison** (`/`, `src/stores/comparison.ts`): finds semantically similar rows via pairwise cosine similarity of embeddings.
- **Topic modeling** (`/topics`, `src/stores/topicModeling.ts`): clusters row embeddings (k-means or hierarchical) and extracts keywords per topic.
- **Stats** (`/stats`, `src/stores/stats.ts`): counts value frequencies across selected columns (comma-separated values are split) and renders a horizontal bar chart. No embeddings or model involved — the counts are plain computeds over `csvRows`.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Type-check (vue-tsc) + production build, run in parallel
npm run type-check   # vue-tsc --build
npm run lint         # ESLint with --fix --cache
npm run format       # Prettier on src/
npm run preview      # Preview production build
```

There is no test suite. Node `^20.19.0 || >=22.12.0` required.

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`. Two consequences that must be preserved:

- `vite.config.ts` sets `base: '/compear/'`.
- The router uses **hash-based history** (`createWebHashHistory`) because GitHub Pages can't serve SPA fallback routes.

## Architecture

### Data flow (comparison and topic modeling)

1. Embedding model starts loading on Pinia store creation, before any file is uploaded. Check `isModelReady` before running comparisons/analysis; switching models clears cached embeddings and results.
2. File upload → parsed (`csvParser.ts` via papaparse, `xlsxParser.ts` via xlsx; XLSX needs a sheet selection first via `readWorkbook()`).
3. User selects columns. **Comparison/analysis columns** (concatenated into the text that gets embedded) are independent from **display columns** (shown in the results table); display columns default to the comparison columns.
4. Embeddings generated → similarity or clustering → results in the store. Pairwise similarity is O(N²) over rows (`i < j` loop, results carry `rowIndexA`, `rowIndexB`, `score`, sorted descending).

### Embedding model handling

`src/utils/embeddings.ts` is the single owner of model loading and embedding for both features (`AVAILABLE_MODELS`, `MODEL_LABELS`, `DEFAULT_MODEL`, `initializeModel`, `generateEmbeddings`, WebGPU detection). `src/utils/topicModeling.ts` holds only clustering and keyword extraction. Two things follow from that:

- **One model is resident at a time**, shared by both stores. Callers therefore pass their own `selectedModel` to every `generateEmbeddings()` call, which re-initializes if the other view swapped the model out; the stores' `loadModel()` compares against `getCurrentModel()` rather than trusting their own `isModelReady` flag.
- **Every embedding call names an `EmbeddingTask`** (`'similarity'` or `'clustering'`). Instruction-tuned models (nomic, Qwen3, EmbeddingGemma) get a per-task prefix from `MODEL_CONFIG`; models trained without instructions get none. Comparison is a *symmetric* task — retrieval prefixes (`search_document:`, `task: search result | query:`) are wrong for it. Free-text search in `ComparisonResults.vue` reuses the corpus's task rather than a query prefix, so the query lands in the same region as the stored vectors.

`MODEL_CONFIG` also picks the runtime per model: `pipeline` (feature-extraction, pooled here) or `encoder` (`AutoModel` exposing `sentence_embedding`). Encoder models carry sentence-transformers dense layers after pooling, so the feature-extraction pipeline would silently skip those layers and yield degraded vectors.

### WebGPU with CPU fallback

- Embedding generation: transformers.js WebGPU backend when `navigator.gpu` yields an adapter, otherwise WASM (single-threaded).
- `src/utils/webgpuSimilarity.ts` holds custom compute shaders for pairwise similarity, k-means, and hierarchical clustering; centroid/cluster updates stay on CPU. Everything falls back to CPU implementations (`src/utils/similarity.ts`, `src/utils/topicModeling.ts`) when WebGPU is unavailable.

### Conventions

- All app state lives in the Pinia stores; components call store functions rather than mutating refs directly (`useComparisonStore()` / `useTopicModelingStore()`).
- The singleton pipeline in the embedding utils prevents duplicate model loads — keep model access going through it.
- `ModelName` is derived from the `AVAILABLE_MODELS` const; use it instead of `string` for model selection.
- CSV rows are `CsvRow` (`Record<string, string>`); embeddings are `number[][]`.
- Errors surface to the UI: file/parse errors go to component-local `error` refs, model errors to `modelError` in the store.
- Stores expose progress state (`comparisonProgress`/`comparisonPhase`, `analysisProgress`/`analysisPhase`) that long-running operations must keep updated.

### Extension points

- **New model**: add to `AVAILABLE_MODELS`, `MODEL_LABELS` and `MODEL_CONFIG` in `embeddings.ts` — the type and UI selectors derive from the constant. Check the model card for the runtime (`sentence_embedding` output → `encoder`), the pooling, and the task prefixes; pin a `dtype` when the default for the device would be an unreasonable download. Verify it actually loads before shipping it — quantized `onnx-community` exports sometimes use ops that need a newer onnxruntime than the installed transformers.js bundles.
- **New file format**: add a parser in `src/utils/` following the csv/xlsx pattern, wire it into the stores' `loadFile()` (comparison, topic modeling and stats), and extend the file input's `accept` attribute in the uploader components. (`loadCSV()` in the comparison store is legacy; use `loadFile()`.)
