#!/usr/bin/env python3
"""Run on the desktop via SSH stdin: resolve doc_id, extract PDF page text.

Env:
  DOC_ID      manifest doc id (required)
  PAGES       optional page spec: "1,3-5" (1-indexed)
  MAX_CHARS   max total text chars (default 50000)
  DEFAULT_PAGE_CAP  when PAGES unset, max pages to read (default 20)
  TOOL        package name (default graph-layout-rag)
  RAG_UV      uv binary (default ~/.local/bin/uv)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

TOOL = os.environ.get("TOOL", "graph-layout-rag")
RAG_UV = os.environ.get("RAG_UV", os.path.expanduser("~/.local/bin/uv"))
DOC_ID = os.environ.get("DOC_ID", "").strip()
PAGES_SPEC = os.environ.get("PAGES", "").strip()
MAX_CHARS = int(os.environ.get("MAX_CHARS", "50000"))
DEFAULT_PAGE_CAP = int(os.environ.get("DEFAULT_PAGE_CAP", "20"))


def die(msg: str, code: int = 1) -> None:
    print(json.dumps({"error": msg, "doc_id": DOC_ID or None}), file=sys.stderr)
    sys.exit(code)


def parse_pages(spec: str, total_pages: int, default_cap: int) -> set[int]:
    if not spec:
        return set(range(1, min(total_pages, default_cap) + 1))
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
            out.update(range(start, end + 1))
        else:
            out.add(int(part))
    return {p for p in out if 1 <= p <= total_pages}


def catalog_lookup(doc_id: str) -> dict | None:
    proc = subprocess.run(
        [RAG_UV, "run", "--no-sync", TOOL, "catalog", "--doc-id", doc_id, "--status", "all", "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        die(proc.stderr.strip() or f"catalog failed for {doc_id!r}")
    data = json.loads(proc.stdout)
    entries = data.get("entries") if isinstance(data, dict) else data
    if isinstance(entries, list) and entries:
        return entries[0]
    return None


def manifest_url(doc_id: str) -> str | None:
    manifest_path = Path("data/manifest.json")
    if not manifest_path.is_file():
        return None
    try:
        items = json.loads(manifest_path.read_text()).get("items", [])
    except (json.JSONDecodeError, OSError):
        return None
    for item in items:
        if item.get("id") == doc_id or item.get("doc_id") == doc_id:
            return item.get("url") or (item.get("sourceUrls") or [None])[0]
    return None


def metadata_only_response(entry: dict) -> dict:
    doc_id = entry.get("doc_id") or DOC_ID
    url = manifest_url(doc_id)
    return {
        "doc_id": doc_id,
        "title": entry.get("title"),
        "status": entry.get("status", "metadata_only"),
        "has_pdf": False,
        "url": url,
        "message": "No local PDF. Use url with WebFetch, or harvest on desktop.",
    }


def format_page_spec(page_nums: list[int]) -> str:
    nums = sorted(set(page_nums))
    if not nums:
        return ""
    parts: list[str] = []
    start = end = nums[0]
    for n in nums[1:]:
        if n == end + 1:
            end = n
        else:
            parts.append(str(start) if start == end else f"{start}-{end}")
            start = end = n
    parts.append(str(start) if start == end else f"{start}-{end}")
    return ",".join(parts)


def continuation_hints(
    *,
    pages_spec: str,
    total: int,
    wanted: set[int],
    pages_out: list[dict],
    truncated: bool,
    last_page_partial: bool,
) -> tuple[bool, str | None, bool]:
    """Return (has_more, next_pages, last_page_partial)."""
    if not pages_out:
        return False, None, last_page_partial

    last_delivered = pages_out[-1]["page"]
    has_more = False
    next_pages: str | None = None

    if truncated:
        has_more = True
        if last_page_partial:
            remaining = sorted(p for p in wanted if p >= last_delivered)
        else:
            remaining = sorted(p for p in wanted if p > last_delivered)
        if remaining:
            next_pages = format_page_spec(remaining)
    elif not pages_spec and total > max(wanted):
        has_more = True
        next_pages = format_page_spec(list(range(max(wanted) + 1, total + 1)))

    return has_more, next_pages, last_page_partial


def extract_pdf(local_path: str, pages_spec: str) -> dict:
    from graph_layout_rag.pdf_text import extract_pages_from_path

    path = Path(local_path)
    if not path.is_file():
        return {
            "doc_id": DOC_ID,
            "status": "missing_file",
            "has_pdf": False,
            "local_path": local_path,
            "message": f"Catalog lists PDF but file missing: {local_path}",
        }

    result = extract_pages_from_path(path)
    if not result.ok:
        return {
            "doc_id": DOC_ID,
            "status": "extract_failed",
            "has_pdf": True,
            "local_path": local_path,
            "open_error": result.open_error,
            "message": result.open_error or "PDF extraction failed",
        }

    total = len(result.pages)
    wanted = parse_pages(pages_spec, total, DEFAULT_PAGE_CAP)
    selected = [(p, t) for p, t in result.pages if p in wanted]

    truncated = False
    last_page_partial = False
    pages_out: list[dict] = []
    used = 0
    for page_no, text in selected:
        if used >= MAX_CHARS:
            truncated = True
            break
        room = MAX_CHARS - used
        if len(text) > room:
            text = text[:room]
            truncated = True
            last_page_partial = True
        pages_out.append({"page": page_no, "text": text})
        used += len(text)
        if truncated:
            break

    has_more, next_pages, last_page_partial = continuation_hints(
        pages_spec=pages_spec,
        total=total,
        wanted=wanted,
        pages_out=pages_out,
        truncated=truncated,
        last_page_partial=last_page_partial,
    )

    out = {
        "doc_id": DOC_ID,
        "title": None,
        "status": "ok",
        "has_pdf": True,
        "local_path": local_path,
        "total_pages": total,
        "pages_read": len(pages_out),
        "truncated": truncated,
        "has_more": has_more,
        "pages": pages_out,
    }
    if has_more and next_pages:
        out["next_pages"] = next_pages
    if last_page_partial:
        out["last_page_partial"] = True
    return out


def main() -> None:
    if not DOC_ID:
        die("DOC_ID required")

    entry = catalog_lookup(DOC_ID)
    if entry is None:
        die(f"no catalog entry for doc_id: {DOC_ID}")

    if not entry.get("has_pdf") or not entry.get("local_path"):
        out = metadata_only_response(entry)
    else:
        out = extract_pdf(entry["local_path"], PAGES_SPEC)
        out["title"] = entry.get("title")
        out["doc_id"] = entry.get("doc_id") or DOC_ID

    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
