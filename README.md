# Compear

Compear is a browser-based CSV/XLSX comparison tool that finds semantically similar rows using in-browser embeddings. All processing runs client-side — no backend required.

**Key features**

- Upload CSV or XLSX (multi-sheet supported).
- Select one or more columns to use as the comparison text (embeddings are generated from the concatenated column values).
- Choose which columns are shown in the results table (display columns can be different from comparison columns).
- Pairwise semantic similarity (N²) with cosine scores; results sorted by similarity and paginated (default 50 rows).
- Switch between several preconfigured embedding models; model loading and inference happen in-browser via transformers-style pipelines.

**Quick start (development)**

- Install & run dev server:

```bash
npm install
npm run dev
```

- Build for production:

```bash
npm run build
npm run preview
```

Other useful scripts: `npm run lint`, `npm run format`, `npm run type-check`.

**How it works (short)**

- A Pinia store manages application state, model loading, uploaded files, selected columns, embeddings and similarity results.
- On store creation the selected model is initialized; model readiness gate prevents comparisons until the model is ready.
- Text for each CSV/XLSX row is created by concatenating the selected comparison columns; embeddings are generated and normalized; pairwise cosine similarities are computed and returned as result pairs.

**Architecture & important files**

- Model + embedding utilities: [src/utils/embeddings.ts](src/utils/embeddings.ts#L1)
- Pairwise similarity logic: [src/utils/similarity.ts](src/utils/similarity.ts#L1)
- CSV parser: [src/utils/csvParser.ts](src/utils/csvParser.ts#L1)
- XLSX parser: [src/utils/xlsxParser.ts](src/utils/xlsxParser.ts#L1)
- Central state: [src/stores/comparison.ts](src/stores/comparison.ts#L1)
- File upload / column selection UI: [src/components/FileUploader.vue](src/components/FileUploader.vue#L1)
- Results UI: [src/components/ComparisonResults.vue](src/components/ComparisonResults.vue#L1)

**Available embedding models**
The project ships with several model names configured (see `AVAILABLE_MODELS` in [src/utils/embeddings.ts](src/utils/embeddings.ts#L1)) including:

- `Xenova/bge-small-en-v1.5`
- `onnx-community/Qwen3-Embedding-0.6B-ONNX`
- `Xenova/all-MiniLM-L6-v2`
- `Xenova/all-MiniLM-L12-v2`
- `nomic-ai/nomic-embed-text-v1.5`

Model loading occurs in-browser and may use WebGPU when available (the embedding util attempts to detect and enable WebGPU; otherwise it falls back to a WASM/CPU backend). Large models can take time and memory — choose a smaller model for faster, lighter usage.

**Notes & developer tips**

- Model initialization runs automatically when the store is created; switching models clears cached embeddings and results.
- Embeddings generation reports progress (store exposes `comparisonProgress` and `comparisonPhase`).
- The pairwise similarity step is O(N²) — for large files this can be slow or memory intensive; consider limiting input size or sampling rows.

**Contributing**

- Add models by updating `AVAILABLE_MODELS` in [src/utils/embeddings.ts](src/utils/embeddings.ts#L1).
- Add new file formats by adding parsers under `src/utils/` and updating the file load flow in the store.

**License**
See the project root for license information.
