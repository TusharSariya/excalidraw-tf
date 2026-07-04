# RAG Literature RAG Operations

## Ingest

Resume interrupted ingest with no `--force`:

```bash
cd tools/rag-literature-rag
uv run rag-literature-rag ingest -v
```

Use `--force --rebuild` only for first build or after changing embed model, dimensions, backend, or chunk profile.

GPU reembed:

```bash
RAG_GPU_TOOL=tools/rag-literature-rag tools/rag-literature-rag/scripts/gpu_dense_reembed.sh
```

Do not query or benchmark during ingest on a 24 GB Mac.

## Harvest

```bash
uv run rag-literature-rag harvest --deep-harvest --target-pdfs 1000 --workers 32 --resume -v
uv run rag-literature-rag harvest verify
uv run rag-literature-rag harvest enrich
```

Useful flags:

| Flag                 | Purpose                                 |
| -------------------- | --------------------------------------- |
| `--deep-harvest`     | Caps tuned for about 1k PDF core corpus |
| `--target-pdfs 1000` | Stop once enough OK PDFs are present    |
| `--resume`           | Skip early seed stages                  |
| `--pipeline-harvest` | OpenAlex core topics only               |

## Embedding Profiles

Common profiles:

| Profile | Use when |
| --- | --- |
| `cuda-qwen0.6b-contextual-v1` | **Production query profile** (promoted 2026-06-22; held-out nDCG@10 = 0.942) |
| `cuda-qwen0.6b-longrag-v1` | Backup production arm (held-out nDCG@10 = 0.924); larger-unit LongRAG-style chunks |
| `cuda-qwen0.6b-1024` | Previous default (plain dense+BM25, no context line); kept for A/B |
| `gemini-2-structure-v1` | Secondary cloud comparison build |
| `openai-large` | Fast cloud one-time ingest |
| `mlx-qwen4b` | Free Apple Silicon ingest |
| `cuda-qwen0.6b-section-v1` | Section metadata A/B |
| `cuda-qwen0.6b-small2big-v1` | Small-to-big A/B |
| `cuda-qwen0.6b-small2big-dual-v1` | Parent evidence for small-to-big |
| `cuda-qwen0.6b-512-v1` / `cuda-qwen0.6b-768-v1` | Reduced-dimension smoke profiles |
| `cuda-qwen4b-1024` / `cuda-qwen4b-2560` | Qwen3-4B CUDA probes |

Extraction and embedding caches are local-only. The page cache is keyed by PDF SHA, extraction backend, and options; chunk profile changes reuse page extraction and redo chunking/embedding.

## Query

Default retrieval is hybrid: dense + BM25 + reciprocal-rank fusion. Do not add `--rerank` by default.

```bash
uv run rag-literature-rag query "reciprocal rank fusion hybrid retrieval" --category hybrid-retrieval --json
```

Valid category slugs: `foundations`, `dense-retrieval`, `sparse-retrieval`, `hybrid-retrieval`, `chunking`, `query-expansion`, `reranking`, `self-correcting`, `graphrag`, `agentic`, `memory`, `long-context`, `evaluation`, `training`, `engineering`, `survey`. Run `uv run rag-literature-rag catalog` for live per-category counts.

## Paths

- Manifest: `tools/rag-literature-rag/data/manifest.json`
- Indexes: `tools/rag-literature-rag/data/indexes/{profile}/`
- Eval findings: `tools/rag-literature-rag/docs/eval-findings.md`
- RAG docs index: `docs/rag/README.md`
