---
name: graph-layout-rag
description: Query the local graph drawing / layout theory RAG corpus. Topic search returns canonical papers with ranked evidence passages; cite related expands from a known paper through the citation graph. Use for Terraform pipeline layout height, Sugiyama/dot layering, neato stress majorization, ELK/Mermaid/dagre, compound grouping, layer reassignment, graph layout literature, and full-PDF deep reading.
---

# Graph Layout RAG

Local hybrid search over graph drawing and layout literature. Use it before citing layout algorithms or changing Terraform layout behavior based on Sugiyama, dot, ELK, dagre, compound graph, packing, routing, or stress majorization claims.

Use `repo-rag` for project source lookup and `rag-literature-rag` for RAG methodology research.

## First Commands

```bash
# Auto-routing entry point — picks the right backend by query style:
yarn graph-rag:search "how do I keep related nodes close while avoiding overlap"
yarn graph-rag:search "network simplex rank assignment dot" --top 8 --json

# Explicit backends (search dispatches to these):
yarn graph-rag:query "compound graph layout constraints" --top 8 --json          # keyword → 0.6B (on desktop)
yarn graph-rag:query-nl "why do layered drawings minimize edge crossings" --json  # natural-language → 4B (on desktop)
```

Query returns canonical paper rows with ranked evidence snippets. Deep-read the PDF before quoting, proving an algorithm, or making a design decision.

## Architecture (one fact to internalize)

**You query from the Mac; the indexes live on the desktop GPU box.** The Mac is a thin client — both retrieval indexes (the keyword `cuda-qwen0.6b-1024` and the NL `cuda-qwen4b-1024`, each ~41k chunks) are CUDA-built and live on the desktop, queried over SSH. So **the desktop must be powered on + SSH-reachable for any query to work**; it **fails loud** if not (never silently degrades). SSH host/root come from `.env` (`GRAPH_RAG_GPU_SSH`, `GRAPH_RAG_GPU_REMOTE_ROOT`).

## Two query regimes (pick the right one)

A measurement campaign found two retrieval regimes win on different query styles (see [references/campaigns.md](references/campaigns.md)):

- **Keyword / LLM-issued** (short, lexical terms) → `yarn graph-rag:query "<keywords>" --json`. The `cuda-qwen0.6b-1024` sparse-heavy hybrid. Best when you already know the terms (algorithm names, tool names, technique phrases).
- **Human / natural-language** (full questions, sentences) → `yarn graph-rag:query-nl "<question>"`. The `cuda-qwen4b-1024` index (**+0.07–0.09 nDCG@10** on NL queries), dense-leaning `sparse_weight≈0.4`.

`yarn graph-rag:search "<anything>"` auto-classifies and routes (printing the chosen backend to stderr); override with `--mode keyword|nl`. When unsure, just use `search`.

## Corpus & sources (what you're searching)

~**41,083 chunks across ~5,811 canonical documents** of graph-drawing and layout-theory literature (expanded mid-2026 from ~1,700 sources via a venue/book "shadow-fetch" harvest). Mix of:

- **Peer-reviewed papers** — `doi`/`crossref`/`openalex`/`arxiv`/`s2` (the bulk: ~5k docs), plus the **JGAA** journal (`jgaa-*`, ~695 chunks).
- **Graph-drawing books & handbooks** — Springer books (`book-*`, e.g. di Battista et al.) and `handbook-*`.
- **Tool/engine docs** — `graphviz`, `elk`.

**Topic coverage:** Sugiyama/layered (dot, network-simplex ranking, layer assignment, crossing minimization, coordinate assignment/Brandes-Köpf), force/stress (neato, MDS, scalable multilevel), orthogonal routing & edge bundling, compaction & packing, planarity & embeddings, compound/clustered graphs, ports, and the ELK/dagre/Mermaid/dot engines. It is **not** a general-purpose corpus — keep queries in the graph-drawing/layout domain.

It's a **hybrid (lexical + dense) ranker over a lexically-rich corpus**: precise terminology in your query helps a lot. Results are **canonical papers with ranked evidence snippets** — treat snippets as pointers, and deep-read the PDF before quoting or proving an algorithm.

## Agent Workflow

1. Search by topic with `yarn graph-rag:query "<topic>" --top 8 --json`.
2. Shortlist canonical papers by title, score, tags, page, and evidence.
3. Use `canonical_doc_id`, `doc_id`, or `alias_doc_ids` to locate the PDF or citation neighborhood.
4. Read the full source for precise algorithms and page-specific claims.
5. Cite `source_url`, title, page, and relevant evidence in the answer or implementation note.

## Research-tool metadata

Results now carry enrichment fields (OpenAlex / Semantic Scholar / arXiv) when a doc is enriched — use them to **triage, trust, and cite** without leaving the result. Surfaced additively in both `--json` and the human render, and absent (not errored) when a doc isn't enriched:

- **Triage:** `tldr` (one-line summary), `venue`, `genre`, `cited_by_count`, `in_corpus_cited_by_count`, `fwci`.
- **Trust:** `is_retracted` (⚠ marker — never silently cite a retracted paper).
- **Cite / read:** `oa_pdf_url` (guaranteed-readable OA link), `bibtex`. Get a BibTeX entry directly with `yarn graph-rag:cite bibtex <doc_id>` (or `uv run graph-layout-rag cite bibtex <doc_id>`).
- **Navigate (citation graph):**
  - `--sort {relevance|cited-by|in-corpus-cited-by}` on `query` — explicit re-order of the result set by citation count (a research-tool sort, *not* a ranking prior; relevance is the default).
  - `★ seminal` marker / `seminal:true` JSON field — the single most in-corpus-cited result, a natural reading entry point.
  - `uv run graph-layout-rag cite neighbors <doc_id> [--direction both|builds-on|cited-by] [--limit N] [--json]` — walk the in-corpus citation neighborhood: what a paper **builds on** (its references in corpus) and what **built on it** (its citers, sorted by citations). Trace intellectual lineage.

Filter flags on `query` scope the candidate pool: `--venue`, `--arxiv-category`, `--genre`, `--exclude-retracted` (live as of the 2026-06-28 rebuild — both production indexes carry the filter columns). The rank-time `--citation-prior-weight FLOAT` is **default 0.0 (OFF)** and stays off: the eval gate is a bootstrap-CI-confirmed NULL (Δ+0.002 nDCG@10, CI straddles 0) — the citation graph's value is the explicit navigation above, not score blending.

Surfacing/enrichment data lives in `data/citations.sqlite` (`papers_meta`) + `data/manifest.json`; the desktop needs the synced `citations.sqlite` for query-time surfacing.

## Setup And Profiles

Both query profiles — keyword `cuda-qwen0.6b-1024` and NL `cuda-qwen4b-1024` — live on the desktop GPU box under `tools/graph-layout-rag/data/indexes/{profile}/` and are queried over SSH (see Architecture above). NL config tunes via `GRAPH_RAG_NL_PROFILE` / `GRAPH_RAG_NL_SPARSE_WEIGHT`. **The desktop must run the same tool + rag-common code as the Mac** for queries to work; sync with `tools/rag-common/scripts/gpu_sync_to_remote.sh` after code changes. The `gemini-2-structure-v1` index is a secondary/comparison build.

If you change the corpus (harvest/ingest new sources), rebuild the indexes on the desktop before querying — `references/operations.md` covers harvest, ingest, and GPU index builds.

```bash
cd tools/graph-layout-rag
uv sync
cp .env.example .env
uv run graph-layout-rag embed profiles
```

Detailed ingest, harvest, profile, citation graph, GPU sync, local LLM, and campaign notes live in:

- [references/operations.md](references/operations.md)
- [references/campaigns.md](references/campaigns.md)

## Validation

```bash
cd tools/graph-layout-rag && uv run pytest tests/test_chunk_profiles.py tests/test_contextual.py tests/test_corpus_health.py tests/test_query_smoke.py
cd tools/graph-layout-rag && uv run graph-layout-rag --help
```
