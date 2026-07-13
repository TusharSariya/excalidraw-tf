# Strata view — W14 browser felt-cost milestone (address/key-index extension + pipeline worker offload)

**Date:** 2026-07-13 · **Status:** REPORT-only perf milestone; NOT a battery — no gate, no threshold, no `gateRegister.json` entry, no frozen row added or changed. Scene output must remain **byte-identical** across every arm in this milestone (index-only and index+worker alike). Frozen machinery is untouched: spec v3.1 §12/§13 (seed 20260704, PRNG, N_min/void floors), `gateRegister.json`, and the V32 baselines. Branch `strata-v3.2-w5-w10b`. Everything in §1–§4 below is committed **before any WP1–4 code lands or any measurement exists** (pre-registration, same discipline as W12/W13); WP1–4 append results into §5 only, never edit §1–§4.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery (pre-registration first; results appended after WP1-4 land) |
| Status | Current — record committed before code/measurement |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-67 (W13) → W14 plan |
| Sisters | [`strata-view-w12-heldout-scale.md`](./strata-view-w12-heldout-scale.md) (Appendix A — the frozen browser felt-cost baseline this milestone measures against), [`strata-view-w13-hop-sweep.md`](./strata-view-w13-hop-sweep.md) |
| Next (agent) | WP1 index-scope extension; WP2 pipelineFull worker job; WP3 differential/parity verification; WP4 re-trace + results + interpretation appended here, never edited into §1-§4 |

## 1. Context & evidence baseline

The frozen baseline is [`strata-view-w12-heldout-scale.md`](./strata-view-w12-heldout-scale.md) **Appendix A — browser felt-cost trace (WP4, best-effort; REPORT-only)** (lines 224-236 of that document, one chrome-devtools-mcp performance trace of the real dev app, 2026-07-13, `yarn start` on `localhost:3002`, URL `/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&strataSweeps=4&strataCoordRefine=1` — P1, strata view, full detail, K=4 + A7). Quoted verbatim as the **FROZEN BASELINE** this milestone measures deltas against:

- **Felt wall-clock:** initial shell LCP 887 ms (CLS 0.00), then the import runs as **one blocking main-thread long task of 13,412 ms** starting t+1.23 s, followed by two apply/render tasks (227 ms @ t+14.66 s, 154 ms @ t+14.96 s) — the imported scene settles ≈ **t+15.1 s**. During the long task the page is frozen (the previous scene renders from localStorage, so the user stares at a stale, unresponsive canvas).
- **Main-thread attribution (event buckets, whole trace):** scripting 14,273 ms · paint 246 ms · compositing/render 36 ms · DOM layout 36 ms — the felt cost is JS compute, not render/paint.
- **Sampled CPU attribution (leaf frames), ≈65% of busy time on address/key resolution:** `resolveTerraformPlanNodeKey` 2,487 ms, index-stripping RegExp 2,374 ms, `terraformModulePrefixForAddress` 2,064 ms, `parseStackAddress` 1,874 ms, `collectKnownStackIdsFromNodes` 1,057 ms, `stripTerraformAddressIndexes` 983 ms (≈ 8.8 s total); topology link resolvers (IAM/SG/API-GW/S3) ≈ 1.5 s; DOT peg parse ≈ 0.4 s; **strata geometry solvers ≈ 26 ms (negligible)**.
- **Seam observation:** **no DedicatedWorker thread activity** — layout ran on the renderer main thread (`runSequential` inside `layoutTerraformViaWorkers`), the same in-process path the W12 battery's timing split measured. Cross-checked against W12 WP3's I2_full P1 timing split (wall 15,596 ms = outer 2,491 + `layout.pipeline` 13,101 + remainder ≈ 4): shape matches the browser's 13.4 s task + ≈ 1.7 s surrounding work.
- **W12 WP3 timing-split corroboration** (same document, "Timing split" table): `skeleton.resourceRects` dominates `layout.pipeline` (P1 F_v2: 14,486 of 14,798 ms) — **element building, not geometry solving, is the scale cost**, consistent with the browser trace.

**Caveats carried forward from W12 Appendix A (unchanged):** dev build (unminified, React dev) + tracing overhead; single trace, one preset, one arm; no strata-vs-v2 browser A/B. Attribution shape — not absolute milliseconds — is the evidence. Proof-API timing emit stays deferred (plan D7).

### Two registered levers

- **(A) Index-scope extension.** Today `withTerraformPlanNodeKeyIndex` is wrapped at exactly one call site — `terraformPipelineLayoutShared.ts:1547`. The Appendix A attribution shows the ≈8.8 s of address/key-resolution leaf frames fire from **both** plan parsing and skeleton element building (`skeleton.resourceRects`), i.e. from call paths outside that single wrapped scope. Lever (A) widens the existing index to cover skeleton materialization, parsing, and topology resolvers, and ships **ALWAYS-ON** with a byte-identity proof — following the RCA-fix precedent (`terraform-pipeline-rcll-v2-allresources-rca.md`, prep O(N²) fix) where a correctness/perf fix to shared resolution machinery shipped unconditionally rather than behind a toggle, once proven byte-identical. This is an **owner decision to ship always-on**, registered here before WP1 lands.
- **(B) `pipelineFull` worker job.** A worker job so the pipeline/strata build leaves the main thread, using the **existing WorkerPool infra** (the same `layoutTerraformViaWorkers` seam every W11/W12/W13 battery arm already goes through — `runSequential` is its no-worker fallback path). Fallback to `runSequential` is preserved; an env kill-switch `VITE_TERRAFORM_LAYOUT_WORKERS=false` forces main-thread execution for debugging/rollback.

## 2. Measurement plan (registered before code)

Re-run the **SAME trace procedure** as W12 Appendix A: a chrome-devtools-mcp performance trace around import on the dev build (`yarn start`, `localhost:3002`), same URL:

```
/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&strataSweeps=4&strataCoordRefine=1
```

plus the **full-detail v2 arm** W12 used (`F_v2_full_ancillary`'s option shape, for a strata-vs-v2 browser-observed comparison point, honoring the same content-parity caveat W12 recorded — strata still defers ancillary pending the M3 port).

**Arms:**

- **(i) index-only** — lever (A) landed, workers disabled via `VITE_TERRAFORM_LAYOUT_WORKERS=false` (isolates the index-scope effect from the worker-offload effect).
- **(ii) index+worker** — lever (A) + lever (B) both landed, workers enabled (the shipped end state).

**Reported per arm:** felt import wall-clock (LCP → long-task-end → apply/render settle, same segmentation as Appendix A), longest single main-thread task duration, and the same leaf-frame resolution attribution (`resolveTerraformPlanNodeKey`, index-stripping RegExp, `terraformModulePrefixForAddress`, `parseStackAddress`, `collectKnownStackIdsFromNodes`, `stripTerraformAddressIndexes`) so the ≈8.8 s bucket can be re-measured under the same six-function breakdown.

Deltas vs the frozen baseline (§1) are **REPORTED, never gated** — there is no pass/fail threshold on any of these numbers. Success/failure language in the results section (§5, pending) is **descriptive only** ("X ms faster/slower", "task split into N tasks of Y ms"), never a gate verdict, never a SUPPORT/WORSENING classification (those are W12/W13 vocabulary for statistical batteries; this is a single-trace perf report and does not borrow that machinery).

## 3. Verification obligations

Before any browser re-trace is treated as meaningful, the following must be green:

- **Differential indexed-vs-scan equivalence test** over real preset node maps — for every widened call site under lever (A), the indexed lookup path and the pre-existing linear-scan path must return identical results across all committed presets' node maps (not just P1).
- **Zero `.snap` diffs** across the layout snapshot, worker-parity, prep-cache, RCLL, and strata test suites.
- **`gateRegister.json` test green**, with no V32/manifest churn — the frozen baseline rows and gate register are read-only inputs to this milestone, never written by it.
- **W12/W13 battery reports regenerate normalized-byte-identical** — re-running `terraformPipelineStrataW12HeldoutScaleBattery.test.ts` and `terraformPipelineStrataHopSweepBattery.test.ts` after WP1/WP2 land must reproduce `.normalized.json` outputs byte-identical to the committed artifacts; **only `buildMs`-class (wall-clock) fields may move**. Any non-timing-field diff is a defect in lever (A) or (B), not a battery update.
- **Fallback-scan counter reported** — if lever (A) or (B) retains any fallback path (indexed-miss → scan; worker failure → `runSequential`), the number of times each fallback fired during the verification run is reported honestly, not silently absorbed.

## 4. Hazards registered up front

- **Sync/async scope teardown trap.** `withTerraformPlanNodeKeyIndex` is presently a synchronous scope wrapper around one call site. Widening its scope to cover async-adjacent call paths (skeleton materialization spans multiple await boundaries in the worker-offloaded arm) risks the index being torn down (or never built) before a later resolver call needs it — this must be verified structurally, not assumed from the current single-site usage.
- **Nodes ref-equality requirement.** Any indexed lookup structure keyed off node identity must preserve reference equality with the node objects used elsewhere in the same build pass; rebuilding or cloning nodes between index construction and index consumption silently breaks the index (produces empty/stale results, not a loud failure).
- **`buildExistingEdges` key-mutation hazard.** Address/key strings are mutated (index-stripping, module-prefix rewriting) downstream of edge construction in places; the index may only be scoped in **after** keys are stable for the call path in question — scoping it earlier over a call path that still mutates keys would index pre-mutation strings and silently miss lookups post-mutation.
- **Worker bundle DOM/React audit.** The `pipelineFull` worker job must not pull in DOM- or React-dependent code into the worker bundle (workers have no DOM); any such dependency either fails at runtime in the worker context or silently no-ops, and must be audited before landing, not discovered via the fallback-scan counter.
- **Worker serialization overhead measured honestly.** Message-passing structured-clone cost (scene in, layout result out) across the main-thread/worker boundary is a real cost this lever introduces; it must be measured and reported alongside the felt-cost numbers in §5, not netted out or assumed negligible by construction.

## 5. Results

_(pending WP1-4)_

### 5.1 Index-scope extension outcome (pending WP1)

_(pending WP1)_

### 5.2 Worker offload outcome (pending WP2)

_(pending WP2)_

### 5.3 Verification obligations disposition (pending WP3)

_(pending WP3)_

### 5.4 Re-traced browser felt-cost (pending WP4)

_(pending WP4)_

### 5.5 Interpretation

_(pending WP4)_

## Provenance

Dual-planner convergence: Claude Opus Plan agent + codex gpt-5.6-terra (medium effort), **identical #1/#2/#3 ranking** on the candidate lever set for this milestone. The M3 ancillary port (full-detail extent pairing unlock, per W12's M3-port gate summary) is **deferred** as an owner/Q7-gated substrate change — out of scope for W14, which addresses browser felt-cost only. Owner decisions registered here: both levers (A) and (B) are in scope for this milestone; lever (A) ships **always-on** (not behind a toggle) once the byte-identity proof (§3) is green.
