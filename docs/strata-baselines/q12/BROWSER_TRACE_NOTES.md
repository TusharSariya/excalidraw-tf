# W12 browser felt-cost trace — numeric notes (2026-07-13)

REPORT-only appendix material for [`../../strata-view-w12-heldout-scale.md`](../../strata-view-w12-heldout-scale.md) (Appendix A). One chrome-devtools-mcp performance trace of the real dev app; **not** a registered cell, **not** frozen, dev-build numbers only.

## Session

- Dev server: `yarn start` (vite 5.0.12, `excalidraw-app`, `http://localhost:3002`).
- URL: `/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&strataSweeps=4&strataCoordRefine=1` — P1, strata view, **full detail** (`compact=0`), K=4 + A7 (the I2 full-detail arm's option shape).
- Protocol: first navigation ran the import once (warm-up: vite transform cache + preset DB fetch warm), then `performance_start_trace(reload)` re-ran the auto-import with the trace recording; stopped after the import settled. Raw trace kept in the session scratchpad (`w12trace/trace.json.gz`, ~8.1 MB, not committed).
- CPU/network throttling: none (1×).

## Headline numbers (all relative to the traced navigation start)

| Measure | Value |
| --- | --- |
| TTFB / LCP / CLS | 21 ms / 887 ms / 0.00 |
| Felt import completion (last import-related main-thread task ends) | ≈ t+15.1 s |
| Dominant blocking long task | **13,412 ms**, starts t+1.23 s (main thread frozen ≈ t+1.2 → t+14.6 s) |
| Post-layout apply/render tasks | 227 ms @ t+14.66 s + 154 ms @ t+14.96 s |
| Main-thread busy total (whole 76.5 s trace incl. idle wait) | 16,150 ms over 114,980 tasks |
| Worker threads | **none** — no DedicatedWorker activity; layout ran on the renderer main thread (`runSequential` path through `layoutTerraformViaWorkers`) |

Main-thread event-category buckets (whole trace): scripting 14,273 ms · paint 246 ms · compositing/render 36 ms · DOM layout 36 ms · parseHTML 1 ms. The felt cost is essentially all JS compute, not paint/render.

## Sampled CPU attribution (main-thread profile, leaf frames, ms)

| Leaf frame | ms |
| --- | --- |
| `resolveTerraformPlanNodeKey` (terraformPlanParsing.tsx) | 2,487 |
| RegExp `\[[^\]]+\]` (address index stripping) | 2,374 |
| `terraformModulePrefixForAddress` (terraformTopologyIamLinks.ts) | 2,064 |
| `parseStackAddress` (terraformStackAddress.ts) | 1,874 |
| `collectKnownStackIdsFromNodes` (terraformStackAddress.ts) | 1,057 |
| `stripTerraformAddressIndexes` (terraformPlanParsing.tsx) | 983 |
| Topology link resolvers (IAM/SG/API-GW/S3 families combined) | ≈ 1,500 |
| dagre/graphlib DOT peg parse | ≈ 420 |
| Garbage collector | 281 |
| Strata geometry solvers (e.g. `terraformPipelineStrataFinalize`) | ≈ 26 (negligible) |

Address/key-resolution family ≈ 8.8 s (~65% of busy time). These leaves are invoked from both plan parsing and skeleton element building (`skeleton.resourceRects` — the known build bottleneck), so this is felt-cost attribution by _function_, not by _stage_.

## Cross-check vs the in-process timing split (battery WP3, I2_full on P1)

vitest wall-clock 15,596 ms = outer prep+merge+parse 2,491 + `layout.pipeline` 13,101 (skeleton-dominated) + remainder ≈ 4. The browser shows the same shape: ≈ 13.4 s of continuous main-thread compute plus ≈ 1.7 s surrounding work, ending ≈ t+15.1 s.

## Caveats

- Dev build (vite unminified, React dev mode) + DevTools tracing overhead — attribution shape is the evidence, not the absolute milliseconds.
- Single trace, warm reload; the persisted previous scene renders immediately from localStorage, so the user sees a _stale_ canvas while the main thread is frozen ~13.4 s (no input response) until the re-imported scene applies.
- One preset (P1), one arm shape (I2 full); no strata-vs-v2 browser A/B was traced.
