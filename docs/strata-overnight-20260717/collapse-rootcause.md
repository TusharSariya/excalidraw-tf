# Edge-collapse root-cause — PRIORITY-1 VERDICT: PRE-EXISTING

**Date:** 2026-07-17 · Investigator run (opus) · Read-only on tracked source; all repro under `scratchpad/overnight-20260717/repro/`.

## TL;DR (decisive)

**The edge-collapse is PRE-EXISTING at base `62950e0f1` — NOT introduced by tonight's memos.**

At the base commit (before ALL 24 branch commits, including B1 `58d5b35f2`, B3 `1908ac268`/`9a58db716`), the audit config produces the **byte-identical collapsed geometry** `7981:306293:9348619ddd17a3d7`, 6/6 deterministically. The SAME collapsed hash reproduces at branch tip `2e9252dda`, 22/22. Because the COLLAPSED (short-points) output is byte-identical at base and tip, tonight's changes cannot have introduced it — if they had, base would emit the healthy (long-points) scene. `introducingCommit: null`.

The memos are further exonerated structurally: 8 sequential in-process invocations with the B3 module-level caches WARM (never reset by `clearTerraformImportPrepCache`) are all byte-identical — no cross-invocation cache poisoning. B1's memo is descent-scoped (fresh per call); B3's `parseStackAddress` now returns a fresh object per call (`9a58db716`).

## Reproduction rate (this machine)

Config = arm `control-audit-minus-deband` from `logs/wa-A2-armeval.json` (**deband OFF**), preset `staging-extended-localstack-v2`, direct `layoutTerraformFromSources` (same seam the arm-eval + real worker path use).

| harness | commit | invocations | healthy | collapsed |
| --- | --- | --- | --- | --- |
| portable N=6 in-process | base 62950e0f1 | 6 | 0 | 6 |
| multiInvoke N=8 in-process (warm B3 caches) | tip 2e9252dda | 8 | 0 | 8 |
| 8 separate single-shot processes | tip | 8 | 0 | 8 |
| 6 CONCURRENT layouts in one process (Promise.all) | tip | 6 | 0 | 6 |

**28/28 collapsed on this machine right now**, at BOTH base and tip, fast (~9s) AND slow (~54s under contention). The healthy branch (`7981:1484529:c89d7b99e080d5d8`) is **not reproducible here** — it was only ever produced historically by `artifacts/p0-discrim-result.json` under heavy overnight multi-agent load (that artifact holds BOTH hashes from the SAME config, proving the flip is real but environment/load-gated, not commit-gated). Prior investigator (`deband-hash-anomaly.md`, tip `b4218d8bf`, BEFORE the memos) was likewise stuck 8/8 collapsed; the `wfix-P0.md` author's machine was stuck on healthy. Confirms: a per-process branch decided by an environment/timing factor, currently pegged to collapsed on this machine.

## What the two branches actually differ by (measured)

`strataGeometryHash = count:canonicalLength:fnv`. Healthy `7981:1484529` vs collapsed `7981:306293`: **identical non-deleted element count (7981), identical positions** (same crossings 138 / pierce 53 / width / height per arm-eval). The entire 1,178,236-char delta is in the **`points` arrays of linear elements** (only arrow/line carry points; the canonical line is `type|x|y|w|h|angle|pts`).

In the collapsed dump (`repro/out/cc-job0-collapsed.txt`, 306,293 B): 3707 `line` (icon strokes, all ≤202-char point strings), 51 `arrow` (2-pt arrowheads, 45 chars), 1889 text / 932 rect / 838 ellipse / 564 frame (no points). Total point-chars ≈ 100k. The 161 declared `.tfd` dataflow edges are ALL soft-deleted (`declaredDeleted:161`) → excluded from the hash entirely.

Key structural fact: `canonicalStrataGeometryString` (terraformStrataGeometryHash.ts:100) **skips `isDeleted`**, and the headless finalize soft-deletes every edge layer (`TERRAFORM_IMPORT_EDGE_LAYER_PINS` all-false → `reconcileTerraformVisibility` sets `isDeleted:true` on all edges, terraformVisibility.ts:1276-1291). So on BOTH branches the declared edges are deleted. The healthy +1.18M chars therefore land on the **non-deleted** linear elements gaining long routed polylines (`wfix-P0.md` LIVE-measured the healthy scene at 145 spanning routed connectors vs the collapsed 51), while element count/positions are unchanged. The collapse = **point-materialization is skipped on a downstream branch**, which also makes those runs ~20s faster (no 1.18M-char routes to build).

## Where the points are dropped (stage)

Downstream of strata PLACEMENT (positions are identical between branches; the strata engine is proven `Date.now`/`Math.random`-free — terraformPipelineStrataFinalize.test.ts:700). The drop is in the **scene finalize / edge-point materialization** phase: `convertPipelineSkeletonToElements` (terraformPipelineLayoutFinalize.ts:95-112) → `repairTerraformEdgeBindings` (terraformVisibility.ts:1002; skips `isDeleted`, :1038) → orbit-bound routing → `reconcileTerraformVisibility`. This matches `wfix-P0.md`'s "once-per-process branch in orbit-route materialisation" lead. `pointsDroppedAtStage: finalize/edge-point-materialization (convertPipelineSkeletonToElements → repairTerraformEdgeBindings orbit route), downstream of placement`.

## Mechanism — RULED OUT vs best hypothesis (UNRESOLVED at file:line)

Could not catch a live flip on this machine (28/28 collapsed), so the exact decision site is not proven. Strongly narrowed:

RULED OUT: (1) tonight's memos (base byte-identical); (2) `Math.random`/seed leak (hash is id-independent and stable across 28 runs incl. fresh ids each run); (3) cross-invocation module-cache poisoning (8 warm-cache in-process invocations identical); (4) internal async race within one layout (6 concurrent in-process layouts identical); (5) wall-clock deadline (a 54s base run and a 9s tip run both collapsed; p0-discrim had a 35.6s collapsed AND a 17.8s healthy — timing does not separate).

BEST HYPOTHESIS: a **per-process, environment/module-load-order-sensitive branch** in the finalize/orbit-route materialization that only flips under system-wide load (why p0-discrim caught both but no isolated run does). Two concrete candidates worth instrumenting: (a) an SDEC-34-class import-cycle module-level const frozen `NaN`/`undefined` at eval time depending on first-touch import order, hitting a `Number.isFinite(...)` guard in the connector-point path (the geometry-hash header and project memory both flag this exact hazard class); (b) the icon-library loader ordering hazard (terraformAwsIcons.ts:58 sets `libraryItems` BEFORE building `nameToIndexLower` at :60-70, with `await` points before the guard at :49) — a partial-population read under concurrency — though icons are present in both branches so this is lower-probability. `mechanism: UNRESOLVED — environment/load-gated per-process branch in finalize orbit-route point-materialisation; not strata-engine, not memos, not Math.random, not intra-call async race; candidate = import-cycle NaN-freeze hitting a Number.isFinite guard on the connector polyline (SDEC-34 class).`

## Fix / recommendation

Do NOT revert the memos (exonerated). The correct SHIPPED mitigation is already in place: the `detectEdgeCollapse` guard (terraformEdgeCollapse.ts) fires on the collapsed scene and both the arm-eval probe and proof-API seam now fail loudly instead of scoring it as valid. Next step to CLOSE root cause: add per-declared-edge instrumentation in `repairTerraformEdgeBindings` / the orbit-route materialization logging whether each edge received a multi-point route, plus a tripwire on any `Number.isFinite` guard in the connector-point path, then run the arm-eval probe across many separate processes UNDER LOAD until a flip is caught and bisect the guard. `fix: keep detectEdgeCollapse guard (already shipped); root-cause still open — instrument orbit-route materialisation + Number.isFinite connector guards and catch a flip under load. No revert (memos byte-identical at base).`

## Artifacts

- `repro/portableProbe.mjs` — self-contained canonical-hash + span measure (runs at any commit).
- `repro/portable.test.ts` / `multiInvoke.test.ts` / `concurrent.test.ts` — in-process / separate / concurrent harnesses.
- `repro/out/{tip-noband-multi,base-noband,sep/*,cc}.log` — the 28-run evidence.
- `wt-base/` worktree at 62950e0f1 (+ untracked `vitest.repro.config.mts` widening fs.allow for the symlinked node_modules — the documented sibling-worktree canvas-mock gotcha). **CLEANED after run.**
