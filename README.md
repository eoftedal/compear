# CSV compare

Features:

1. User loads a CSV
2. User selects columns to use for comparison
3. An embedding + cosine similarity is used in browser to create a similarity score
4. The similarity score is shown as a table below (the user can select which columns to show in the table from each row ,and the number of rows (default: 50 )) and they are presented in sorted order (most similar first)

Model: Xenova/all-MiniLM-L6-v2

Library: transformers.js
