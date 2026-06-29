/**
 * Lane-partition guard for the sharded CI test split (see .github/workflows/ci.yml).
 *
 * The fast lane runs `VITEST_FAST=1` (exclude = configDefaults.exclude +
 * SLOW_TEST_PATTERNS) and the slow lane runs `VITEST_SLOW_ONLY=1` (include =
 * SLOW_TEST_PATTERNS). If those two file sets ever stop partitioning the full
 * suite, a test file silently runs in NEITHER lane — green CI that no longer
 * executes it. This guard walks the real test tree and asserts:
 *
 *   FAST ∪ SLOW == FULL      (no file dropped from both lanes)
 *   FAST ∩ SLOW == ∅         (no file double-run)
 *   every SLOW_TEST_PATTERN matches ≥1 real file   (no dead / stale pattern)
 *
 * Dependency-free (Node fs only) so it can't trip knip/depcheck, and fast enough
 * to live in the fast lane itself. Every SLOW_TEST_PATTERN is a leading-globstar
 * suffix glob with no mid-path wildcard, so a path-suffix match is faithful to
 * vitest's picomatch resolution for these patterns.
 */
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { SLOW_TEST_PATTERNS } from "./slowTestPatterns";

// Repo root: this file is packages/excalidraw/test-fixtures/, three dirs deep.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const TEST_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".vitest-reports",
]);

/** Recursively collect every test file under `dir`, as repo-relative POSIX paths. */
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(join(dir, entry.name), relPath));
    } else if (TEST_RE.test(entry.name)) {
      out.push(relPath);
    }
  }
  return out;
}

// Scan the roots vitest discovers tests under in this monorepo.
const ROOTS = ["packages", "excalidraw-app", "examples"].filter((r) =>
  existsSync(join(REPO_ROOT, r)),
);
const FULL = ROOTS.flatMap((r) => walk(join(REPO_ROOT, r), r));

// Strip the leading globstar ("<globstar>/x" -> "x") and match a path ending in
// "/x" (or exactly "x"). Faithful for suffix-only globs (no mid-path wildcard).
const suffixOf = (pattern: string) => pattern.replace(/^\*\*\//, "");
const matches = (file: string, pattern: string) => {
  const suffix = suffixOf(pattern);
  return file === suffix || file.endsWith(`/${suffix}`);
};
const isSlow = (file: string) =>
  SLOW_TEST_PATTERNS.some((pattern) => matches(file, pattern));

const SLOW = FULL.filter(isSlow);
const FAST = FULL.filter((f) => !isSlow(f));

describe("slow/fast test-lane partition (CI shard guard)", () => {
  it("discovers a non-trivial full suite (sanity)", () => {
    expect(FULL.length).toBeGreaterThan(100);
  });

  it("FAST ∪ SLOW == FULL and FAST ∩ SLOW == ∅ (every file runs in exactly one lane)", () => {
    expect(FAST.length + SLOW.length).toBe(FULL.length);
    const slowSet = new Set(SLOW);
    expect(FAST.filter((f) => slowSet.has(f))).toEqual([]);
  });

  it("every SLOW_TEST_PATTERN matches at least one real file (no dead pattern)", () => {
    const dead = SLOW_TEST_PATTERNS.filter(
      (pattern) => !FULL.some((f) => matches(f, pattern)),
    );
    expect(
      dead,
      `SLOW_TEST_PATTERNS matching no file (stale/typo'd — the file would silently fall back to the fast lane):\n${dead.join(
        "\n",
      )}`,
    ).toEqual([]);
  });
});
