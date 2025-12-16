## Plan: CSV Comparison Tool with Embeddings

Build a browser-based CSV comparison tool using Vue 3 that loads CSV files, generates embeddings with transformers.js, computes cosine similarity scores, and displays ranked comparison results in a configurable table. Model loading starts immediately on app load while users can upload and prepare CSVs.

### Steps

1. **Install dependencies**: Add `@xenova/transformers` and `papaparse` (+ `@types/papaparse`) via npm, then configure [vite.config.ts](vite.config.ts) to optimize for WASM/model loading if needed.

2. **Create utility modules**: Build [src/utils/csvParser.ts](src/utils/csvParser.ts) for CSV parsing with papaparse, [src/utils/embeddings.ts](src/utils/embeddings.ts) for Xenova/all-MiniLM-L6-v2 model initialization and embedding generation, and [src/utils/similarity.ts](src/utils/similarity.ts) for cosine similarity calculations.

3. **Set up Pinia store**: Create [src/stores/comparison.ts](src/stores/comparison.ts) to manage model loading state (initialized immediately on store creation), CSV data, selected comparison columns, selected display columns (defaulting to comparison columns), embeddings cache, pairwise similarity results excluding self-comparisons, and display settings (row limit defaulting to 50).

4. **Build UI components**: Create `CsvUploader` component with file upload, comparison column selection, and display column selection controls (enabled during model loading), `ComparisonResults` component displaying similarity table with independently selected Row A and Row B fields side-by-side plus similarity score, and wrap them in [src/views/ComparisonView.vue](src/views/ComparisonView.vue) with model loading indicator.

5. **Wire up routing**: Update [src/router/index.ts](src/router/index.ts) to add the comparison view as home route and update [src/App.vue](src/App.vue) to include `<RouterView>` for navigation.

6. **Implement comparison flow**: Initialize model in store on app load, allow immediate CSV upload and column selection, compute embeddings for selected comparison columns when model is ready, calculate all pairwise similarities (N² comparisons) filtering out where rowIndexA equals rowIndexB, store results as pairs with row indices and score, sort descending by similarity, display top 50 pairs showing independently selected display columns from both Row A and Row B.
