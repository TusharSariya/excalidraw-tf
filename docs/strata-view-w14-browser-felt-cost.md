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

**Commit map:** WP0 (pre-registration) `1b824d728` → WP1 (index scope over skeleton element materialization) `a75b60d3c` → WP3 (`pipelineFull` worker job) `5565aee76` → WP2 (index scope over parsing + topology link resolution, scan-fallback counter) `b7b0328af` → fixes (`5ba3b2cad`, codex diff-review F1-F6). WP1/WP2/WP3 land out of their §1 letter order for dependency reasons (the worker job needed to exist before the widened index's async-scope teardown hazard, §4, could be verified end to end); this is a build-sequencing note, not a scope change.

### 5.1 Index-scope extension outcome (lever A)

Lever (A) shipped **always-on**, no toggle, per the owner decision recorded in §1/Provenance. `withTerraformPlanNodeKeyIndex` now wraps `pipeline.prep.materialize` in `preparePipelineLayout` (WP1, `a75b60d3c`) — this covers `skeleton.resourceRects` for both v2 and strata, the call path the W12 Appendix A trace attributed most of the ≈8.8 s address/key-resolution bucket to. WP2 (`b7b0328af`) then widened the scope over plan parsing and the TFD-overlay region. `buildExistingEdges` and `mergeRawTerraformStateIntoNodes` were **deliberately excluded** from the widened scope — both are key-mutating regions (index-stripping, module-prefix rewriting happen downstream of edge construction inside them per the §4 `buildExistingEdges` hazard), so indexing them pre-mutation would silently miss lookups post-mutation. On a full P2 parse this leaves **9,842 unscoped scans**, entirely attributable to the two excluded regions — reported honestly, not netted out. `knownStackIds` was confirmed subsumed by the widened index (no separate scoping needed).

### 5.2 Worker offload outcome (lever B)

Lever (B) shipped as a `pipelineFull` worker job on the existing WorkerPool/`layoutTerraformViaWorkers` seam (WP3, `5565aee76`), with `runSequential` fallback preserved and the `VITE_TERRAFORM_LAYOUT_WORKERS=false` kill-switch intact. **As landed in WP3, the worker predicate only routed `layoutMode === "pipeline" || "rcll"`** — `view=strata` fell through to `runSequential()` unconditionally, so lever B never engaged for the view this milestone measures. This gap was caught independently two ways: by the WP4 browser trace (zero `DedicatedWorker` activity in every pre-fix trace, both arms statistically indistinguishable) and by codex's diff review (F1, below). The fix commit (`5ba3b2cad`) adds `layoutMode === "strata"` to the predicate in `layoutTerraformViaWorkers` (`terraformLayoutWorkerClient.ts`), after which strata imports dispatch a `pipelineFull` job through `runJobWithFallback`.

### 5.3 Codex diff-review dispositions (F1-F6)

Codex (gpt-5.6-sol, medium effort) reviewed the WP1-WP3 diff and returned 4 P1 + 2 P2 findings, all folded into `5ba3b2cad` before the final trace:

- **F1 (P1, strata missing from the worker predicate)** — CONFIRMED, independently detected by the browser trace (zero worker activity pre-fix). Fixed: `layoutMode === "strata"` added to the `pipelineFull` dispatch predicate.
- **F2 (P1, parity-test rigor)** — fixed by exercising the worker-chunk handler directly via the exported `runTerraformLayoutWorkerRequest`, with a `structuredClone` round-trip test. A raw byte-compare approach was rebutted: element ids/nonces/seed are randomized per build, so the honest check is a normalized compare plus raw element-count parity, not byte equality.
- **F3 (P1, differential scope)** — fixed: the indexed-vs-scan differential equivalence test extended from one preset to **all 6 committed presets**.
- **F4 (P1, fallback counter granularity)** — fixed: worker-fallback counter now reports `disabled` / `poolFailure` / `cloneError` / `workerError` as separate cells rather than one aggregate.
- **F5 (P2, `ok:false` double-execution)** — fixed: validation failures now throw once; only genuine infra errors (pool failure, clone error, worker error) fall back to `runSequential`, closing a path where a validation failure could execute the job twice.
- **F6 (P2, scan counters always live)** — fixed: the scan-fallback counters are DEV-gated, matching the rest of this milestone's REPORT-only, no-prod-overhead posture.

### 5.4 Verification obligations disposition

Per the L2 sweep (haiku): `yarn test:typecheck` clean; `gateRegister.json` 10/10 with zero churn; the W13 hop-sweep and W12 held-out batteries reproduce their exact sanity anchors; the worktree is byte-identical (only `buildMs`-class fields move, as required by §3); zero NUL bytes across the changed files. The §3 differential indexed-vs-scan equivalence test passes over all 6 committed presets' node maps (post-F3). The `buildExistingEdges`/`mergeRawTerraformStateIntoNodes` exclusion (§5.1) is the source of the 9,842 residual unscoped scans on a full P2 parse — reported, not silently absorbed, per the §3 fallback-scan-counter obligation.

### 5.5 Re-traced browser felt-cost

Re-run of the §2 measurement plan (chrome-devtools-mcp performance traces, dev build, `staging-extended-localstack-v2`, `view=strata&compact=0&strataSweeps=4&strataCoordRefine=1`). Full raw numbers and method notes: WP4 trace results (scratch record, this session).

**Pre-fix arms (before `5ba3b2cad`; lever B not yet wired for strata — both arms statistically indistinguishable):**

| Metric | Frozen baseline (W12 App. A) | Arm (i) index-only (mean of 2 runs) | Arm (ii) index+worker (mean of 2 runs, pre-fix — worker not engaged) |
| --- | --- | --- | --- |
| Felt import settle | ≈ 15.1 s | ≈ 7.48 s | ≈ 6.88 s |
| Longest main-thread task | 13,412 ms | 5,618.6 ms | 5,381.9 ms |
| Six-function leaf-frame sum | ≈ 8,839 ms (~65% of busy time) | 3,594.4 ms | 3,555.8 ms |
| DedicatedWorker activity | None | None | None (= the F1 bug) |

Arms (i) and (ii) differ by only ≈600 ms felt / ≈237 ms longest-task — within each arm's own run-to-run spread (≈186-211 ms) — consistent with lever B not engaging pre-fix.

**Post-fix arm (ii) re-run (commit `5ba3b2cad`, workers default-on, no env override, 3 independent full-reload runs):**

| Run | Longest main-thread task (Long Task API, >50 ms) | Worker-enabled flag | `fallbackStats` |
| --- | --- | --- | --- |
| 1 | **0 tasks recorded** | `true` | `{disabled:0, poolFailure:0, cloneError:0, workerError:1}` |
| 2 | **0 tasks recorded** | `true` | `{disabled:0, poolFailure:0, cloneError:0, workerError:1}` |
| 3 (verification) | **0 tasks recorded** | (not re-queried) | (not re-queried) |

**Headline: the pre-fix ≈5.3-5.7 s single blocking main-thread task is gone.** All 3 post-fix full-reload runs recorded zero Long Task API entries (>50 ms threshold) anywhere in document load and import — a categorical change, not a marginal one.

**Named residual:** `terraformModulePrefixForAddress` stayed ≈2.1 s essentially unchanged across every arm (pre-fix index-only, pre-fix index+worker, and — by construction, since lever A didn't touch this resolver's call sites — expected to persist post-fix too), while the other five of the six leaf-frame functions dropped sharply. Its call sites sit outside the scopes lever A widened. **Open follow-up lever**, not addressed this milestone.

**Full-detail v2 arm:** the §2 plan called for reproducing W12's `F_v2_full_ancillary` arm as a browser trace for a strata-vs-v2 comparison point. Checked against `strata-view-w12-heldout-scale.md`: W12 never actually browser-traced that arm — its numbers are a Vitest/node timing-split measurement, not a chrome-devtools-mcp trace. There is no v2 full-detail browser-trace URL on record to reproduce, so this arm is recorded as **not-reproducible-as-specified and skipped** — no arm was invented in its place.

### 5.6 Lever verdicts (descriptive, not gated)

- **Lever A (index-scope extension):** six-function leaf-frame resolution sum dropped from ≈8.8 s to ≈3.6 s (**−59%**), and the longest main-thread task dropped from 13.4 s to ≈5.3-5.7 s pre-fix — felt import roughly halved by the index alone, before the worker fix landed. One exception: `terraformModulePrefixForAddress` (≈2.1 s, unchanged).
- **Lever B (worker offload):** pre-fix, inert for `view=strata` (F1). Post-fix (`5ba3b2cad`), main-thread blocking is eliminated for this view — 0 long tasks across all 3 post-fix runs, versus a consistent single ≈5.3-5.7 s task in every pre-fix trace. Combined effect vs the original frozen baseline: felt import moved from ≈15.1 s (one 13.4 s blocking task) to ≈6.9 s pre-fix-equivalent workload with **zero** blocking long tasks post-fix.

### 5.7 Caveats (verbatim from the trace record)

- **Direct DedicatedWorker-thread confirmation was NOT obtained.** The chrome-devtools-mcp tooling in this session had no worker-target listing, and raw-trace-file save was blocked by a workspace-root path restriction on `performance_stop_trace`'s `filePath`. The "0 long tasks post-fix" result is **indirect evidence**: `isTerraformLayoutWorkersEnabled()` returned `true` every run, no `terraform-layout-worker.chunk` network request was visible from the main page (expected for a worker-scope fetch, per the investigation), no console errors referenced worker/DataCloneError failures, and no renewed main-thread blocking appeared. This is consistent with the fix working but is not a positive identification of a `DedicatedWorker` thread inside the raw trace.
- **`fallbackStats` showed `workerError:1` per run**, identically in runs 1 and 2, uncorrelated with any main-thread blocking (0 long tasks in the same runs). The counter is a pure integer increment with no logging by design, so its root cause could not be identified from the console within this session. **Open follow-up** — not resolved this milestone, and not believed (on the evidence gathered) to affect the headline blocking-task result.
- Dev build (unminified, React dev), tracing overhead, single machine, background load not controlled — carried forward from W12 Appendix A.
- 2 runs per pre-fix arm (4 traces) + 3 post-fix runs, not a statistical battery — consistent with this milestone's REPORT-only status; no pass/fail language is used anywhere in this section.

### 5.8 Process note

WP0's pre-registration commit was made after a repo-wide `yarn prettier --write` was run in error, transiently reformatting the frozen v3.2 baselines. This was caught, verified formatting-only (no content diff), and the baselines were restored byte-exact from `HEAD` before WP0 landed. Going forward the rule is `npx prettier --write <file>` with explicit file arguments, never the repo-wide invocation.

### 5.9 Interpretation

Both registered levers land net-positive on the metrics this milestone measures, with the worker-offload fix (F1) doing the larger share of the final win: pre-fix, the index alone (lever A) cuts the resolution bucket ≈59% and roughly halves felt import time, but the import still runs as one blocking main-thread task (≈5.3-5.7 s) because lever B never engaged for `view=strata`. Post-fix, that blocking task is gone entirely (0/3 long tasks), which is the more consequential result for the user-facing "frozen canvas" symptom §1 opened with — a `≈5.5 s` blocking task and a `0`-blocking-task workload with equivalent-or-lower total resolution cost are qualitatively different user experiences, not just a smaller number. Two residuals are left open and explicitly not resolved by this milestone: `terraformModulePrefixForAddress` (≈2.1 s, untouched by lever A's widened scopes) and the unexplained `workerError:1` fallback (silent, uncorrelated with blocking, cause unidentified). Both are named as follow-up levers, not closed here. M3 ancillary port remains out of scope and owner/Q7-gated, as registered in §1/Provenance — nothing in this milestone touches that decision.

## Provenance

Dual-planner convergence: Claude Opus Plan agent + codex gpt-5.6-terra (medium effort), **identical #1/#2/#3 ranking** on the candidate lever set for this milestone. The M3 ancillary port (full-detail extent pairing unlock, per W12's M3-port gate summary) is **deferred** as an owner/Q7-gated substrate change — out of scope for W14, which addresses browser felt-cost only. Owner decisions registered here: both levers (A) and (B) are in scope for this milestone; lever (A) ships **always-on** (not behind a toggle) once the byte-identity proof (§3) is green.
