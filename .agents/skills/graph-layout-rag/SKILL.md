---
name: graph-layout-rag
description: Query the local graph drawing / layout theory RAG corpus. Topic search returns canonical papers with ranked evidence passages; cite related expands from a known paper through the citation graph; read_paper optionally extracts full PDF page text. Use for Terraform pipeline layout height, Sugiyama/dot layering, neato stress majorization, ELK/Mermaid/dagre, compound grouping, layer reassignment, and graph layout literature.
---

# Graph Layout RAG

Local hybrid search over graph drawing and layout literature. Use it before citing layout algorithms or changing Terraform layout behavior based on Sugiyama, dot, ELK, dagre, compound graph, packing, routing, or stress majorization claims.

Use `repo-rag` for project source lookup and `rag-literature-rag` for RAG methodology research.

## First Commands

Query from the Mac with **`rag graph`** — no SSH, no `cd tools/`. `bin/rag` wraps the desktop tool; add `--json` for raw output, omit it for a readable summary:

```bash
rag graph "compound graph layout constraints" --top 8
rag graph "network simplex rank assignment dot" --json
yarn graph-rag:query "VPSC separation constraints" --tag constraints      # same thing via the yarn alias
rag cite graph <doc_id>                                                    # optional: citation graph
rag read graph <doc_id> [--pages 1,3-5] [--max-chars 50000] [--json]       # optional: full PDF text
rag health                                                                 # confirm the desktop gateway is up
```

Agents can instead call the **`search`** / **`cite_related`** / **`read_paper`** MCP tools with `corpus="graph"` — same backend. Results are canonical paper rows with ranked evidence snippets — snippets are usually enough for triage; use `rag read` / `read_paper()` when you need full page text.

## Architecture (one fact to internalize)

**Everything runs on the desktop; the Mac only wraps it.** The corpus, the indexes, and the query CLI all live on the desktop at `~/gpu-gateway-temp/graph-layout-rag` (the desktop was rebuilt on Ubuntu 26; the old `~/excalidraw-tf-rag` checkout and the k3s GPU gateway are gone). `bin/rag` (and the `search` MCP tool) SSH to the desktop and run `uv run graph-layout-rag query --json`; query-time embedding loads the model in-process on the desktop (you'll see `Loading weights…` on cold start — slower first query, then fine). The desktop must be reachable — `rag health` checks the tool dirs + uv over SSH. Because the whole query runs on the desktop, the keyword vs natural-language split below is just a choice of `--embed-profile`, not of where it runs.

### When the desktop layout moves again (overrides)

`bin/rag` respects env overrides so you don't have to edit anything:

- `RAG_SSH_HOST` — ssh alias for the desktop (default `desktop`).
- `RAG_REMOTE_ROOT` — dir holding the tool packages (default `$HOME/gpu-gateway-temp`).
- `RAG_REMOTE_UV` — uv binary on the desktop (default `$HOME/.local/bin/uv`).
- `RAG_GATEWAY_URL` — optional gateway URL for a secondary `rag health` curl (default unset — no gateway exists; set it only if a gateway is stood up again, e.g. `http://10.0.0.156:8765`).

Note the two *separate* gateway knobs: `RAG_GATEWAY_URL` is only for the optional `rag health` curl from the Mac, while query-time embedding would use `RAG_GPU_GATEWAY_URL` from the **desktop tool's `.env`**. `bin/rag` does **not** forward `RAG_GPU_GATEWAY_URL` to the remote shell. With no `.env`/gateway (current state), `rag graph` returns correct results via the in-process embedder. Defaults verified working 2026-07-12:

```bash
rag health
rag graph "sugiyama layer assignment" --top 5
```

## Two query regimes (pick the right one)

A measurement campaign found two retrieval regimes win on different query styles (see [references/campaigns.md](references/campaigns.md)). Both run on the desktop via `rag graph`; the regime is just which `--embed-profile` you pass:

- **Keyword / LLM-issued** (short, lexical terms) → `rag graph "<keywords>"` — default `cuda-qwen0.6b-1024`, sparse-heavy hybrid. Best when you already know the terms (algorithm names, tool names, technique phrases).
- **Human / natural-language** (full questions, sentences) → `rag graph "<question>" --embed-profile cuda-qwen4b-1024 --sparse-weight 0.4` — the 4B index (**+0.07–0.09 nDCG@10** on NL queries). Requires the 4B index to be built on the desktop.

## Corpus & sources (what you're searching)

~**41,083 chunks across ~5,811 canonical documents** of graph-drawing and layout-theory literature (expanded mid-2026 from ~1,700 sources via a venue/book "shadow-fetch" harvest). Mix of:

- **Peer-reviewed papers** — `doi`/`crossref`/`openalex`/`arxiv`/`s2` (the bulk: ~5k docs), plus the **JGAA** journal (`jgaa-*`, ~695 chunks).
- **Graph-drawing books & handbooks** — Springer books (`book-*`, e.g. di Battista et al.) and `handbook-*`.
- **Tool/engine docs** — `graphviz`, `elk`.

**Topic coverage:** Sugiyama/layered (dot, network-simplex ranking, layer assignment, crossing minimization, coordinate assignment/Brandes-Köpf), force/stress (neato, MDS, scalable multilevel), orthogonal routing & edge bundling, compaction & packing, planarity & embeddings, compound/clustered graphs, ports, and the ELK/dagre/Mermaid/dot engines. It is **not** a general-purpose corpus — keep queries in the graph-drawing/layout domain.

It's a **hybrid (lexical + dense) ranker over a lexically-rich corpus**: precise terminology in your query helps a lot. Results are **canonical papers with ranked evidence snippets** — snippets are usually enough for triage; use `rag read graph <doc_id>` when you need full page text.

## read_paper (optional deep-read)

`rag read graph <doc_id>` (or MCP `read_paper`) SSHes to the desktop and extracts page text from the local PDF via PyMuPDF — **CPU-only, no GPU gateway calls**.

- Returns `{status: ok, pages: [{page, text}, ...]}` when a local PDF exists (~2,800 docs).
- Returns `{status: metadata_only, url, ...}` when no local PDF — use `source_url` / `oa_pdf_url` from the search hit, or harvest on desktop.
- `--pages 1,3-5` for specific pages; default first 20 pages; `--max-chars` caps total text.
- When `has_more: true`, call again with `pages` set to `next_pages`. `last_page_partial: true` means the last page was cut by `max_chars`.

## Agent Workflow

1. Search by topic with `rag graph "<topic>" --top 8` (or the `search` MCP tool) — default starting point.
2. Shortlist canonical papers by title, score, tags, page, and evidence.
3. `rag cite graph <doc_id>` — optional, when citation neighborhood matters.
4. `rag read graph <doc_id> [--pages N]` or MCP `read_paper()` — optional, when snippets are insufficient.
5. Cite `source_url`, title, page, and relevant evidence in the answer or implementation note.

## Research-tool metadata

Results now carry enrichment fields (OpenAlex / Semantic Scholar / arXiv) when a doc is enriched — use them to **triage, trust, and cite** without leaving the result. Surfaced additively in both `--json` and the human render, and absent (not errored) when a doc isn't enriched:

- **Triage:** `tldr` (one-line summary), `venue`, `genre`, `cited_by_count`, `in_corpus_cited_by_count`, `fwci`.
- **Trust:** `is_retracted` (⚠ marker — never silently cite a retracted paper).
- **Cite / read:** `oa_pdf_url` (guaranteed-readable OA link), `bibtex`. `rag cite graph <doc_id>` wraps *related*; for a BibTeX entry or neighborhood walk run on the desktop: `uv run graph-layout-rag cite bibtex <doc_id>`.
- **Navigate (citation graph):**
  - `--sort {relevance|cited-by|in-corpus-cited-by}` on `query` — explicit re-order of the result set by citation count (a research-tool sort, _not_ a ranking prior; relevance is the default).
  - `★ seminal` marker / `seminal:true` JSON field — the single most in-corpus-cited result, a natural reading entry point.
  - `uv run graph-layout-rag cite neighbors <doc_id> [--direction both|builds-on|cited-by] [--limit N] [--json]` — walk the in-corpus citation neighborhood: what a paper **builds on** (its references in corpus) and what **built on it** (its citers, sorted by citations). Trace intellectual lineage.

Filter flags on `query` scope the candidate pool: `--venue`, `--arxiv-category`, `--genre`, `--exclude-retracted` (live as of the 2026-06-28 rebuild — both production indexes carry the filter columns). The rank-time `--citation-prior-weight FLOAT` is **default 0.0 (OFF)** and stays off: the eval gate is a bootstrap-CI-confirmed NULL (Δ+0.002 nDCG@10, CI straddles 0) — the citation graph's value is the explicit navigation above, not score blending.

Surfacing/enrichment data lives in `data/citations.sqlite` (`papers_meta`) + `data/manifest.json`; the desktop needs the synced `citations.sqlite` for query-time surfacing.

## Setup And Profiles

Both query profiles — keyword `cuda-qwen0.6b-1024` and NL `cuda-qwen4b-1024` — live on the desktop under `~/excalidraw-tf-rag/graph-layout-rag/data/indexes/{profile}/`. Embedding routes through the desktop GPU gateway (`RAG_GPU_GATEWAY_URL=https://gpu-gateway.10.0.0.156.sslip.io` in `.env`). The active profile is whatever `RAG_EMBED_PROFILE` points at; switch to `cuda-qwen0.6b-1024` for production. `gemini-2-structure-v1` is a secondary/comparison build.

If you change the corpus (harvest/ingest new sources), rebuild the indexes on the desktop before querying — `references/operations.md` covers harvest, ingest, and GPU index builds. Setup/ingest run on the desktop (`ssh desktop`, under `~/excalidraw-tf-rag/graph-layout-rag`):

```bash
uv sync
cp .env.example .env
uv run graph-layout-rag embed profiles
```

Detailed ingest, harvest, profile, citation graph, GPU sync, local LLM, and campaign notes live in:

- [references/operations.md](references/operations.md)
- [references/campaigns.md](references/campaigns.md)

## Validation

On the desktop (`ssh desktop`, under `~/excalidraw-tf-rag/graph-layout-rag`):

```bash
uv run pytest tests/test_chunk_profiles.py tests/test_contextual.py tests/test_corpus_health.py tests/test_query_smoke.py
uv run graph-layout-rag --help
```
