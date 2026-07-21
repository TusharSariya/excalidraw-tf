# Perf loop 2026-07-21 — import + canvas (strata /demo)

Plan: autonomous alternating loop (import ↔ canvas) on the pinned strata URL; desktop = gating numbers, laptop-dell-studio = low-power profile, Mac = orchestrator/fallback. Harnesses: `scripts/terraform/benchmark-import-time.mjs`, `scripts/terraform/benchmark-canvas-stress.mjs` (seeded workload registry; ≥1 new stress workload added per iteration). Keep rule: import median improves > noise (max(5%, spread)); canvas: no workload p95 regresses > noise and ≥1 improves >5%; no matrix config regresses; laptop regression ⇒ INCONCLUSIVE. Full revert otherwise. Never `test:update` to mask goldens.

Pinned URL path: `/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&ancillary=1&privateApiRegional=1&strataSweeps=4&strataCoordRefine=1&strataRankSep=1&strataPackedScoring=0&strataBandDepth=root&strataDeBand=vpc&strataSift=1&strataBlockClamp=1&strataTranspose=1&lodEnabled=1&lodPreset=balanced&minimap=0&layers=declared`

## Phase 0 — harness build (2026-07-21)

- Import harness `benchmark-import-time.mjs` + dev-only profiler window hook (`TerraformDemoAutoImport.tsx`, `global.d.ts`). Felt-time = "Loading preset" appearance → status-overlay unmount; profiler spans ranked by inclusive ms (selfMs broken for nested spans). Stress modes: `--reimport`, `--cpu-throttle`, `--interact-during-import`, `--matrix`. Typecheck + golden tests green. Mac smoke: feltMs 9.3s (warm Vite).
- Canvas harness `benchmark-canvas-stress.mjs`: 15 seeded workloads (zoom-cycle, zoom-lod-thrash, zoom-extremes, pan-4way, viewport-thrash, hover-sweep, click-storm, marquee, select-all-drag, nudge-storm, draw-shapes, text, edit-churn, multi-stress, soak), rAF p50/p95/p99, dropped %, longtasks, regen/replaceAll deltas, heap delta; `--dpr/--viewport` super-res; `--matrix`. Mac smoke (7051 elements): click-storm p95 233ms, 41 longtasks, 12.7k regens per 40 clicks — first hotspot signal. pan-4way fully cache-served (p95 16.8ms).
- OPEN validation: import-end discrepancy — 0a overlay-unmount 9.3s vs 0b element-stability wait ~75s on the same Mac server; reconcile against `[terraform:*]` console markers before trusting baselines.

## Experiments

(entries follow: `## E<NN> [import|canvas] <title> — <date>` with Hypothesis / Change / Baseline / After / Verdict / Tests / Commit)
