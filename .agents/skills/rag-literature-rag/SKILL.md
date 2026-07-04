---
name: rag-literature-rag
description: Query the local retrieval-augmented-generation research corpus (~1,360 papers). Topic search returns canonical papers with ranked evidence passages; cite related expands from a known paper through the citation graph. Use before changing this repo's RAG architecture — chunking, hybrid/dense retrieval, reranking, query expansion, RAPTOR/LongRAG/small-to-big, agentic search, or RAG evaluation — and when researching Self-RAG, GraphRAG, HyDE, RRF, or reading full PDFs from the literature index.
---

# RAG Literature RAG

Local hybrid search over retrieval-augmented-generation research papers. Use it before changing this repo's RAG behavior — chunking, hybrid/dense retrieval, reranking, query expansion, evaluation, or agentic search — so decisions cite primary sources (Self-RAG, GraphRAG, HyDE, RRF, RAPTOR, LongRAG) instead of memory.

Use `repo-rag` for project source lookup and `graph-layout-rag` for graph-drawing/layout literature.

## First Commands

Query from the Mac with **`rag lit`** — no SSH, no `cd tools/`. The `rag` CLI (`bin/rag`) wraps the desktop tool; add `--json` for raw output, omit it for a readable summary:

```bash
rag lit "Self-RAG reflection tokens" --tag self-correcting
rag lit "reciprocal rank fusion hybrid retrieval" --category hybrid-retrieval --json
yarn rag-lit:query "small-to-big retrieval" --top 8      # same thing via the yarn alias
rag cite lit <doc_id>                                    # expand from a known paper
rag health                                               # confirm the desktop gateway is up
```

Agents can instead call the **`search`** / **`cite_related`** MCP tools with `corpus="lit"` — same backend. Results are canonical papers with ranked evidence snippets — snippets are usually enough for triage. Full-text read via MCP `read_paper` is **graph corpus only** for now (`rag read lit` not yet wired); use `source_url` from search hits when snippets are insufficient.

## Architecture (one fact to internalize)

**Everything runs on the desktop; the Mac only wraps it.** The corpus, the indexes (under `~/excalidraw-tf-rag/rag-literature-rag/data/indexes/{profile}/` on the desktop), and the query CLI all live on the desktop — nothing is indexed on the Mac. `bin/rag` (and the `search` MCP tool) SSH to the desktop, run `uv run rag-literature-rag query --json`, and query-time embedding routes through the desktop GPU gateway (`RAG_GPU_GATEWAY_URL=https://gpu-gateway.10.0.0.156.sslip.io`, a k3s-served Ray Serve deployment that handles model loading + LRU VRAM eviction). The desktop must be reachable — `rag health` checks it.

## Corpus & sources (what you're searching)

~**1,360 OK-status PDFs** of retrieval-augmented-generation research, harvested from arXiv, S2ORC, OpenAlex, Europe PMC, Crossref, and curated bibliographies. It's a hybrid (lexical + dense) ranker over a terminology-rich corpus, so precise terms — algorithm and method names — sharpen results a lot. It is **not** general-purpose; keep queries in the RAG-methodology domain and use the sibling skills otherwise.

Scope the candidate pool with filters on `query`:

- `--category <slug>` — pipeline category. Valid slugs: `foundations`, `dense-retrieval`, `sparse-retrieval`, `hybrid-retrieval`, `chunking`, `query-expansion`, `reranking`, `self-correcting`, `graphrag`, `agentic`, `memory`, `long-context`, `evaluation`, `training`, `engineering`, `survey`. (`yarn rag-lit:catalog` prints per-category counts.)
- `--tag <substring>` — finer topic tag (e.g. `self-correcting`); substring match.
- `--source <name>`, `--year-min <YYYY>`, `--pdf-only` — provenance / recency / exclude metadata-only docs.

Retrieval variants — **default hybrid (dense + BM25 + RRF) is usually right**; reach for these only deliberately:

- `--small-to-big` — retrieve child chunks, rank aggregated parent passages.
- `--raptor [--raptor-mode hybrid|tree_only_hybrid|collapsed|then_chunks|fused_hybrid]` — RAPTOR tree-summary retrieval (requires a raptor profile index).
- `--expand auto|force` — LLM multi-query / step-back expansion for vague queries.
- `--rerank` / `--no-hybrid` — override fusion. Off by default on purpose: reranking, citation fusion, multi-query, ColBERT, and SPLADE all **lose** in current evals (see [references/evaluation.md](references/evaluation.md)).

## Agent Workflow

1. Search by topic: `rag lit "<topic>" --top 8` (or the `search` MCP tool).
2. Shortlist canonical papers by title, score, category, tags, and evidence.
3. Optionally read more: use `source_url` from the search hit, or the manifest on desktop when snippets are not enough. For graph-drawing papers use sibling skill `rag read graph <doc_id>`.
4. Use `rag cite lit <doc_id>` when citation-neighborhood expansion matters.
5. Cite report links or paper metadata when documenting the decision.

## Setup & Profiles

Production query profile is **`cuda-qwen0.6b-contextual-v1`** (promoted 2026-06-22; held-out nDCG@10 = 0.942 vs 0.630/0.667 dense baseline — see `docs/quality-campaign-2026-06-22.md`). **`cuda-qwen0.6b-longrag-v1`** is the viable backup (held-out nDCG@10 = 0.924). `cuda-qwen0.6b-1024` is the previous plain dense+BM25 default and `gemini-2-structure-v1` a cloud comparison build — both stay queryable for A/B. The active profile is whatever `RAG_EMBED_PROFILE` points at in `.env`; an index must already exist for that profile. Index files live on the desktop; embed calls at query and ingest time route to the desktop gateway (`RAG_GPU_GATEWAY_URL`).

Ingest/harvest/eval are desktop-side maintenance — run them on the desktop (`ssh desktop`, under `~/excalidraw-tf-rag/rag-literature-rag`), not the Mac:

```bash
uv sync
cp .env.example .env
uv run rag-literature-rag embed profiles
```

If you change the corpus or chunk profile, rebuild before querying. Detailed ingest, harvest, eval, synthetic-gold, quality-campaign, and troubleshooting notes live in:

- [references/operations.md](references/operations.md)
- [references/evaluation.md](references/evaluation.md)
- [references/campaigns.md](references/campaigns.md)

## Validation

On the desktop (`ssh desktop`, under `~/excalidraw-tf-rag/rag-literature-rag`):

```bash
uv run pytest tests/test_chunk_profiles.py tests/test_contextual.py tests/test_corpus_health.py tests/test_ingest_run.py tests/test_query_transforms.py
uv run rag-literature-rag --help
```
