#!/usr/bin/env python3
"""Mac-side MCP server for the desktop RAG corpora.

Exposes `search`, `cite_related`, `read_paper`, and `health` as MCP tools so an
agent can query graph-layout-rag and rag-literature-rag natively. Each tool
shells out to the repo's `bin/rag` (which SSHes to the desktop). `bin/rag` is
the single source of truth for transport; this file is a thin wrapper.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP

REPO = Path(__file__).resolve().parents[2]
RAG_BIN = os.environ.get("RAG_BIN", str(REPO / "bin" / "rag"))

mcp = FastMCP("rag")


def _run(args: list[str]) -> dict | list:
    proc = subprocess.run(
        [RAG_BIN, *args, "--json"],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"rag exited {proc.returncode}")
    return json.loads(proc.stdout)


@mcp.tool()
def search(
    corpus: str,
    query: str,
    top: int = 8,
    tag: str | None = None,
    category: str | None = None,
    pdf_only: bool = False,
    extra_flags: list[str] | None = None,
) -> dict:
    """Search a local RAG corpus; returns canonical papers with ranked evidence passages.

    corpus: "graph" = graph drawing / layout theory (Sugiyama, dot, ELK, dagre, neato,
    compound layout, crossing minimization); "lit" = retrieval-augmented-generation
    research (chunking, hybrid/dense retrieval, reranking, Self-RAG, HyDE, RRF, RAPTOR,
    evaluation). Default hybrid (dense + BM25 + RRF) retrieval is usually correct.

    Returns {query, results: [{title, score, doc_id, tags, pipeline_categories,
    section_path, evidence: [{excerpt}], source_url, ...}]}. Snippets are usually
    enough for triage; use read_paper() when you need full page text. Use
    cite_related() to expand from a returned doc_id through the citation graph.
    """
    args = [corpus, query, "--top", str(top)]
    if tag:
        args += ["--tag", tag]
    if category:
        args += ["--category", category]
    if pdf_only:
        args += ["--pdf-only"]
    if extra_flags:
        args += list(extra_flags)
    return _run(args)


@mcp.tool()
def cite_related(
    corpus: str,
    doc_id: str,
    top: int = 15,
    signal: str | None = None,
) -> dict:
    """Expand from a known paper through the citation graph.

    corpus: "graph" or "lit". doc_id: a doc_id from a prior search() result.
    signal: "graph" (citation structure), "embedding" (SciNCL/SPECTER2 cosine), or
    "fused" (both, default). Returns {seed, signal, related: [{doc_id, score,
    co_citation, shared_citations, ...}]}.
    """
    args = ["cite", corpus, doc_id, "--top", str(top)]
    if signal:
        args += ["--signal", signal]
    return _run(args)


@mcp.tool()
def read_paper(
    doc_id: str,
    pages: str | None = None,
    max_chars: int = 50000,
) -> dict:
    """Optional: extract full page text for a graph-layout-rag paper by doc_id.

    Use when search() snippets are not enough — e.g. verifying an algorithm,
    quoting a specific passage, or checking a page-specific claim. Skip for
    simple triage or when evidence excerpts already answer the question.

    doc_id: from a prior search() result (graph corpus only in v1).
    pages: optional 1-indexed page spec, e.g. "1,3-5". Defaults to first 20 pages.
    max_chars: cap on total returned text (default 50000).

    Returns extracted page text when a local PDF exists on the desktop.
    For metadata_only papers, returns url so the agent can fetch externally.
    When has_more is true, pass next_pages to a follow-up read_paper() call.
    last_page_partial means the final page was cut by max_chars — re-read that
    page (or raise max_chars) via next_pages.
    CPU-only on desktop via SSH; no GPU gateway calls.
    """
    args = ["read", "graph", doc_id, "--max-chars", str(max_chars)]
    if pages:
        args += ["--pages", pages]
    return _run(args)


@mcp.tool()
def health() -> dict:
    """Return desktop GPU gateway health: loaded models, GPU memory, dispatcher state.

    Use to confirm the desktop is reachable before a batch of queries.
    """
    return _run(["health"])


if __name__ == "__main__":
    mcp.run()
