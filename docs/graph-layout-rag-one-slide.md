# graph-layout-rag — Production Architecture

**Local-first hybrid RAG over a graph-drawing corpus · $0 API at query time**

```
HARVEST ──▶ INGEST ──▶ DUAL INDEX ──▶ ROUTER ──▶ WEIGHTED-RRF FUSION ──▶ RESULTS
~4,501 docs  ~800-tok   LanceDB (dense)  keyword│NL   k=20 · dense 1.0 · sparse 2.0
             chunks     + BM25 (Tantivy)            pool ≥80 · HyDE on PDFs
```

|  |  |
| --- | --- |
| **Corpus** | Graphviz · GD Handbook · OpenAlex/DBLP/S2 · arXiv · Crossref venues — ~4,501 docs |
| **Embeddings** | Qwen3-0.6B @ 1024d, CUDA FP16 on RTX 3060 Ti (built via Gemini-3072 → GPU re-embed) |
| **Retrieval** | Dense + BM25, weighted RRF (`k=20`, dense 1.0 / **sparse 2.0**, pool 80); rerank off |
| **Router** | Keyword/LLM → local **0.6B** (sparse-heavy) · Natural-language → **4B** over SSH (dense-leaning) |
| **Quality** | nDCG@10: **0.768** catalog / **0.715** pdf — hybrid wins both tracks |
