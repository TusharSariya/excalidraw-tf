# graph-layout-rag — Production Architecture

_Local-first hybrid RAG over a graph-drawing / layout-theory corpus. Verified against `tools/graph-layout-rag/README.md`, `.env.example`, `query/hybrid.py`, and `query/routing.py`._

**One line:** Qwen3-0.6B CUDA dense + Tantivy BM25, weighted-RRF fused (k=20, sparse-weight 2.0, pool 80), local-first on an RTX 3060 Ti, with a keyword→0.6B / natural-language→4B-over-SSH router and optional HyDE for PDFs. $0 API at query time.

---

## Pipeline at a glance

```
harvest  →  ingest  →  dual index (LanceDB dense + BM25)  →  router  →  weighted-RRF fusion  →  results
```

---

## 1. Corpus & harvest (`harvest/`)

- **~4,501 docs** from: Graphviz.org/theory, the GD Handbook, OpenAlex + DBLP + Semantic Scholar, arXiv (cs.CG / cs.DS), Crossref venues (JGAA, CGTA, TVCG, EuroVis, TCAD…), DROPS GD 2024/25, plus bibliography-chain expansion from seed PDFs.
- Output → `data/manifest.json` + `data/raw/`.
- Paywalled books are kept as `metadata_only` stubs.

## 2. Ingest (`ingest/`)

- Markdown-aware structural-block extraction → **~800-token chunks (1,200 hard max)** with complete-paragraph overlap.
- SHA-256 dedup of identical PDFs.
- Writes **two indexes per profile** under `data/indexes/{profile}/`:
  - **LanceDB** — dense vectors
  - **BM25 (Tantivy)** — sparse lexical

## 3. Embeddings — production profile

- **Prod query profile: `cuda-qwen0.6b-1024`** = Qwen3-Embedding-0.6B @ 1024 dims, CUDA FP16 on the **RTX 3060 Ti**, $0 API. (This is the `.env` default `RAG_EMBED_PROFILE`.)
- **Build path:** build the **`gemini-2-structure-v1`** secondary index once on Mac/Vertex (3072-dim Gemini), then **GPU re-embed** it down into the local 0.6B index via `scripts/gpu_dense_reembed.sh`.

## 4. Retrieval — production default (`query/hybrid.py`, `query/search.py`)

- **Hybrid**: dense (LanceDB) **fused** with BM25 (Tantivy) via **weighted Reciprocal Rank Fusion**.
- Tuned constants (verified in `hybrid.py`):
  - `RRF_K = 20`
  - `DENSE_WEIGHT = 1.0`
  - `SPARSE_WEIGHT = 2.0`
  - fused pool of **≥80 candidates**
- **HyDE** query expansion engages for the PDF track / vague-or-thin queries (`search.py:345`).
- **Reranking: OFF by default** (measured no gain, higher memory).

## 5. Query routing — two regimes (`query/routing.py`)

| Query style | Index | Fusion lean |
| --- | --- | --- |
| **Keyword / LLM-issued** (high lexical overlap) | local **0.6B** (`cuda-qwen0.6b-1024`) | sparse-heavy (`sparse_weight ≈ 2.0`) |
| **Human natural-language** (low overlap) | **4B desktop** (`cuda-qwen4b-1024`), over SSH | dense-leaning (`sparse_weight ≈ 0.4`) |

- `scripts/query_auto.sh` auto-dispatches: errs toward the always-available local keyword path on short inputs, prints the chosen backend, and accepts `--mode` to override.
- A wrong guess only changes _which backend_ runs, never correctness.

---

## Measured performance

De-biased, multi-system-pooled + LLM-judged qrels:

| Config                              | catalog nDCG@10 | pdf nDCG@10 |
| ----------------------------------- | --------------- | ----------- |
| `gemini-2-structure-v1` (secondary) | **0.768**       | 0.715       |
| `cuda-qwen0.6b-1024` (prod local)   | 0.718           | —           |

- Hybrid is the winner on both tracks; BM25-alone is mid-pack; dense converges with it.
- HyDE wins the PDF track.
- The earlier "BM25 wins" verdict was overturned as a pooling-bias artifact.

---

## Key files

- `tools/graph-layout-rag/README.md` — full pipeline + profile table
- `tools/graph-layout-rag/.env.example` — `RAG_EMBED_PROFILE=cuda-qwen0.6b-1024`
- `src/graph_layout_rag/query/hybrid.py` — RRF constants & fusion
- `src/graph_layout_rag/query/routing.py` — keyword vs NL routing
- `src/graph_layout_rag/query/search.py` — hybrid/HyDE dispatch
- `scripts/gpu_dense_reembed.sh` — Mac → GPU re-embed path
- `scripts/query_auto.sh` — auto-routing query entry point
