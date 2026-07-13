# Strata / RCLL-v2 — change log

| Field | Value |
| --- | --- |
| Status | **Living document.** Chronological register of every shipped change to the Strata / RCLL-v2 layout engines. |
| Rule | **Every commit that changes Strata/RCLL-v2 behavior, defaults, specs, or measurement MUST append a row here** (newest first). Pure bookkeeping commits (hash backfills, prettier, checkpoint-log-only recording) are omitted. |
| Decisions | Rationale lives in [`strata-view-decision-log.md`](./strata-view-decision-log.md) (SDEC register); this log records *what shipped, when, under which toggle*. |

## Document graph

| Relation | Link |
| --- | --- |
| Role | Companion |
| Status | Living |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) |
| Sisters | [`strata-view-implementation-flow.md`](./strata-view-implementation-flow.md) |
| Next (agent) | Append a row with every behavior/default/spec/measurement commit; cite the SDEC or battery report as evidence |

## Strata era (rcll-v2 engine, `view=strata`)

| Date | Commit | Change | Toggle / default | Evidence |
| --- | --- | --- | --- | --- |
| 2026-07-12 | `4b6468e41` | W8 rank×scorer factorial battery (7 arms × P1/P2: RS×packedScoring regresses the round-9 owner case — P_RS≡ALL splits SQS/Dynamo vertically 496→1629px while improving global crossings 220→151; W7 fix reproduces in P and P_NS; ALL silently suppresses NS) + gate-register `scalarCells` schema with M-TCR/M-H/M-ANG families and 18 W7-seeded REPORT cells (FAIL-never-relabeled + waiver-cites-SDEC enforced by the always-on register test). | Measurement + register schema; no defaults changed | SDEC-59; [`strata-view-w8-rank-scorer-factorial.md`](./strata-view-w8-rank-scorer-factorial.md) |
| 2026-07-12 | `81f7f86e4` | Packed scoring v2: per-hull coordinate descent + group-sift candidates (a loose leaf moves together with its satellite leaves). P1 flag-on: global crossings 123→97, the round-9 SQS case fixed exactly as the owner suggested (SQS+DynamoDB between the VPCs, edge 1303→676px), sharper-angle share improved; extent p50 +11.5% and 13.8s build are the reported costs. Post-A7 never-worse guard falls back to legacy if the scored arm is worse on final geometry. | `strataPackedScoring` / **off** | SDEC-57 remedy; W7 battery pending |
| 2026-07-12 | `6030151f8` | Round-9 remedy implemented: packed-hull ordering now supports whole-layout candidate-set scoring (all K sweeps chained, each snapshot trial-placed on the real skyline, scored by global crossings → edge-box penetrations → edge length). Fixes the owner's SQS case (edge 1303px → 546px on P1) but battery global crossings regressed 123→136 (scorer proxy is pre-A7, single snapshot for all hulls) — stays off pending per-hull selection / post-A7 scoring + battery. | `strataPackedScoring` / **off** | SDEC-57 remedy; round-9 gate plan |
| 2026-07-12 | `ed7021f94` | Round 9 recorded: the packed-hull ordering acceptance is structurally blind to the crossings its moves affect (experiment: forced SQS reorder cut global crossings 123→120 while the acceptance counter read 0 both orders). Packed-acceptance repair named the top Package-C work item. | — (evidence only) | SDEC-57; [`rcll-v2-shit-test-round9.md`](./rcll-v2-shit-test-round9.md) |
| 2026-07-12 | `273bbcf3b` | W6 highlight-spike battery: crossover sweep (does a click-highlight substitute for layout work?) + downstream-cone crossing metrics. Conditions (i)/(ii) of the Package-C deprioritization gate MET; owner canvas eval pending. | Measurement only; all cells REPORT | SDEC-56; [`strata-view-w6-highlight-spike-report.md`](./strata-view-w6-highlight-spike-report.md) |
| 2026-07-12 | `83adfc6ad` | Bare `view=strata` demo URL now resolves to the validated K=4+A7 default instead of K=0 — new shared `TERRAFORM_STRATA_LAYOUT_DEFAULTS` constant read by both the import dialog and the demo-URL path. Explicit URL zeros still honored. | Default ON at app layer; engine fallback unchanged | SDEC-54 gap closure |
| 2026-07-12 | `f80df0c7c` | Spec v3.2 adopted (new normative top): named-statistic bootstrap (mean no longer gate-eligible), gate register + frozen baselines normative, Ware path-cost (M-RT) gate family, W4 restated (median parity / p90 FAIL-WAIVED), rankSeparate relabeled a trade, K=4+A7 default codified, OD-15 re-scoped, task-evidence precondition. | — (spec) | SDEC-55; [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) |
| 2026-07-12 | `42c5ff5aa` | W5b probe: joint constrained network-simplex (rankSeparate constraints inside one NS solve). Feasible — refutes the old "cannot compose" claim — but loses to the sequential composition on task metrics; NO-GO as a replacement. | `strataJointNsRank`, default OFF | [`strata-view-w5b-joint-ns-probe.md`](./strata-view-w5b-joint-ns-probe.md) |
| 2026-07-12 | `484d5c758` | Frozen v3.2 baselines (SHA-pinned row JSONs) + gate register with always-on CI claim assertions — recorded gate outcomes are recomputed from pinned artifacts every test run; a FAIL relabeled PASS is a red build. W4's p90 extent override recorded as FAIL-WAIVED. | Always-on test suite | SDEC-55 §2; [`strata-baselines/README.md`](./strata-baselines/README.md) |
| 2026-07-12 | `f76f406b5` | Strata import-dialog defaults flipped to K=4 sweeps + A7 refinement ON (owner-directed; W5 showed the old K=0 default was the worst arm on every metric). Share URLs emit strata params in both states so defaults round-trip. | `strataSweeps=4`, `strataCoordinateRefine=true` by default; rankSeparate stays OFF | SDEC-54; W5 finding (f) |
| 2026-07-12 | `69ecabb28` | v3.2 minimal gate slice + W5 repaired-stats battery: statistic-parameterized bootstrap (CI on p50/p90, n≥31 floor), crossing-angle summary (sharp-crossing share), Ware path-cost metrics module, report-emitting W5 harness. W5 refuted W4's "parity" at p90 and validated K=4+A7 (first task-metric win over v2). | Measurement only | [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md) |
| 2026-07-12 | `33bf70705` | Round-8 cross-model audit (3× codex gpt-5.6-sol xhigh + Claude verification) + the v3.2 gate-family proposal (Ware regression headline, gate register design, statistics repair). | — (evidence + proposal) | [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md); [`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md) |
| 2026-07-05 | `3e0b5a384` | W4/M1c: `strataRankSeparate` height lever (rank-separation constraints, −height at the cost round 8/W5 later quantified) + Strata option toggles in the import dialog. | `strataRankSeparate`, default OFF | SDEC-49..53; [`strata-view-w4-extent-report.md`](./strata-view-w4-extent-report.md) |
| 2026-07-05 | `c4a60924b` | M1b: K=4 barycenter ordering sweeps (A2), A7 per-hull Y refinement, deterministic finalize (stable ids, tombstones), churn gates. | Sweeps/refine opt-in at the time (default ON since SDEC-54) | SDEC-38..47; [`strata-view-w3-battery-report.md`](./strata-view-w3-battery-report.md) |
| 2026-07-05 | `a466e1e63` | W2: S0b freeze register (v3.1 §12 — seed 20260704, frozen constants) + frozen baselines. | — (measurement) | SDEC-33 |
| 2026-07-05 | `314506bc6` | M1a engine core: cycle repair (A3), ranking (A1), banded/packed placement (A0) + initial ordering (A2), scene build, failure contract, slice metrics (T9). First real Strata geometry. | `view=strata`, opt-in | SDEC-30..37; V1 verdict SDEC-37 |
| 2026-07-04 | `43862be0e` | S0a: Strata view wired end-to-end (button, URL param, layout mode, all option-threading seams), passthrough to the v2 substrate. | `view=strata`, opt-in | SDEC-22, SDEC-27..29 |
| 2026-07-04 | `72cce4369` | D10/W0: five measurement-contaminating bug fixes (prep-cache fingerprint collision, non-antisymmetric edge comparator, RoughJS seed-0 clamp, NS-demotion surfacing, v2-full frame-offset under-reservation). | — (fixes) | SDEC-25/26; spec v2.0 §12 |
| 2026-07-04 | `61dc34f7f` | Spec v3.1 (19 round-7 amendments: banded acceptance objective, operationalized gate statistics, identity constants, freeze registers) + decision log + implementation flow. | — (spec) | SDEC-21; [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) |
| 2026-07-04 | `ac86d32e3` | Rounds 5+6 adversarial reviews + specs v2.0 (normative base) and v3.0 (slice metrics, A2/A7 rescope) + reading list + measurement probes. | — (specs + evidence) | [`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md); [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) |
| 2026-06-29 | `0106e4258` | RCLL v2 spec v1.0 (PR #51) — superseded by v2.0. | — (spec, superseded) | [`rcll-v2-spec.md`](./rcll-v2-spec.md) |

## RCLL v1 era (`view=rcll`, shipped engine — as-built RFC: [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md))

| Date | Commit | Change | Toggle / default | Evidence |
| --- | --- | --- | --- | --- |
| 2026-06-24 | `6fdaa6cea` | Y-axis hull-coordination NO-GO corrected with a coupled all-level re-measure (feasible region intrinsically 2D-inseparable). | — (measurement) | RFC campaign log |
| 2026-06-23 | `b4d35cdda` | Fix: all RCLL options forwarded on refresh and compact toggle (extracted replay-options helper). | — (fix) | RFC §34.3 |
| 2026-06-23 | `97d8ada89` | Perf: duplicate satellite scan eliminated in RCLL prep (T1–T4). | — (perf) | RFC §34.3 |
| 2026-06-22 | `d1c88c2e1` | Ancillary slack allocator + DI-ANC-6 block diagnostic. | Ancillary toggle | RFC §34.3 |
| 2026-06-22 | `5fa116256` | RCLL ancillary bands (reserved bands for "All resources" satellites). | Ancillary toggle | RFC §34.3 |
| 2026-06-21 | `ee824b8b3` | Fix: straighten pass lifts direct leaves beside lanes. | — (fix) | RFC §34.3 |
| 2026-06-21 | `83821086a` | M6c: container-aware crossing minimization. | Default OFF | RFC §34.3 |
| 2026-06-20 | `565c75197` | De-band generalized: subnet boolean → `deBandLevel` hierarchy ladder. | `deBandLevel`, default none | RFC §34.3 |
| 2026-06-20 | `95b6a0e8d` | Import menu + API redesign: outcome-first Layout profiles. | UI | RFC §34.3 |
| 2026-06-20 | `4724f3562` | M5c: column compaction (pull-left) under one Column-packing control. | `pipelineColumnPacking`, default OFF | RFC §34.3 |
| 2026-06-20 | `67b06712c` | Fix: forward dropped toggles + curlable layout proof API (`GET /api/terraform-layout`). | — (fix) | RFC §34.3 |
| 2026-06-20 | `4d3155195` | Dialog UX: pipeline-order grouping, one vocabulary, side-panel schematics. | UI | RFC §34.3 |
| 2026-06-20 | `ef67849d6` | Internal RCLL layout toggles exposed in the import dialog + footgun guards. | UI, defaults unchanged | RFC §34.3 |
| 2026-06-20 | `a10dbd7d8` | M8r: rankSeparate — whole-model-global Sander layering (GO; −42% height lever later ported to Strata as OD-14). | Default OFF | RFC §34.3 |
| 2026-06-19 | `bfd2fb9f5` | Subnet de-band: merge subnet Y-bands, annotate membership. | Default OFF | RFC §34.3 |
| 2026-06-19 | `23b52fd5e` | M5b: safe de-density (Axis-2 B); measured no-op on v2. | Default OFF | RFC §9.5 |
| 2026-06-18 | `b91a4d77a` | M5: Brandes–Köpf leaf straightening (Stage 1d, Axis-1). | Toggle | RFC §34.3 |
| 2026-06-18 | `3313c2d52` | Gate-fix: full-mode frame addressing + model readability metric. | — (fix + measurement) | RFC §34.3 |
| 2026-06-18 | `a6770f9d9` + `b169b2980` | M6: crossing-minimization reorder (per-container barycenter, **strict-improve gate** — the acceptance rule round 9 later found blind at packed hulls in Strata) + Ordering Off/On dialog toggle. | A/B toggle | RFC §34.3; round-9 lineage |
| 2026-06-18 | `ca4effe25` | Ancillary "All resources": honest toggle; reserved-band design recorded, feature deferred. | Toggle | RFC §34.3 |
| 2026-06-18 | `956d387a0` | M4: swimlane lane-rise (DEC-1 extended into swimlane interiors). | A/B toggle | RFC §34.3 |
| 2026-06-18 | `e62a9e46b` | M3b: hull-aware cyclic placement (2-way → swimlane, 1-way → staircase + DEC-1 Y-rise). | — | RFC §34.3 |
| 2026-06-17 | `68fa65398` + `ee0e44e93` | M3a hardening: iron rule (CON-12, no same-column edge), cyclic SCC handling, EXT-12 back-edges, swimlanes for spurious hull cycles. | — | RFC §34.3 |
| 2026-06-17 | `c25f0b2a1` | M3a: first geometry — forced bands + packed column-stack + derived frames + collision gate. | — | RFC §34.3 |
| 2026-06-17 | `651d87dfd` | M2: layering — local columns + hull staircase + fan-out pinning (Stage 1a). | — | RFC §34.3 |
| 2026-06-17 | `acaa4ead4` | M1: prep model — compound tree + lattice (UB/slack, fan-out/fan-in, D_H up-projection, cycle flags). | — | RFC §34.3 |
| 2026-06-17 | `be46f7c76` | M0b: measurement harness — polyline crossing counter + readability metrics + adversarial fixtures. | Measurement only | RFC §34.3 |
| 2026-06-17 | `ff77beac4` | M0a: RCLL view added — import→pipeline→export seam + measurement harness + test hardening. | `view=rcll`, opt-in | RFC §34.3 |
| 2026-06-16 | `497450e72` | RCLL layout RFC with visual glossary — campaign start. | — (RFC) | [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) |

Later X-axis levers ported into the RCLL option surface (network-simplex "shorten" packing, coordRepack) are registered in the RFC's own §34.3 commit map; rows above cover the commits recoverable from `git log` by subject.
