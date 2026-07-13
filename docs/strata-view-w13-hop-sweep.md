# Strata W13 — hop-depth × direction sweep for relationship focus

**Date:** 2026-07-13 · **Status:** Pre-registered analysis record (WP3 commit, record only). **REPORT-only** — this document and the battery it pins register nothing: no gate is asserted, no frozen row is added or changed, `gateRegister.json` untouched, no manifest pin. Seed **20260704** (frozen v3.1 §12 PRNG seed) everywhere. Branch `strata-v3.2-w5-w10b`. Everything in the "Pre-registered analysis record" section below is committed **before any W13 battery statistic exists** and is not edited after the battery runs.

**Amendment rule (same as W12):** post-hoc changes to this record are a new, **dated, labeled amendment** in the Amendments section — never a silent rewrite — and an amendment touching a definition may only be made **before reading the numbers that definition affects** (the W12 AMENDMENT-1 discipline: v2 fixture was cut after observing a frozen-VOID status but before reading any v2 extent number).

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery (pre-registration first; results appended after the WP5 hop-sweep battery runs) |
| Status | Current — record committed before statistics |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md) (W11 directed focus + tracing cells) → W13 plan |
| Sisters | [`strata-view-w12-heldout-scale.md`](./strata-view-w12-heldout-scale.md) (transfer battery whose P1/P2 tracing cells are this record's sanity anchor) |
| Artifacts | [`strata-baselines/hopsweep/README.md`](./strata-baselines/hopsweep/README.md) (non-frozen, REPORT-only, re-derivable) |
| Next (agent) | WP5 battery file implements exactly this record; results + interpretation appended here, never edited into the record |

## Scope and claim class

W13 grounds a **RECOMMENDED hop-depth default** for the configurable relationship-focus feature (hop depth 0..∞ × direction) with **population-match evidence**: how well each (K, direction) focus slice matches the true reachability cone on the impact-tracing question.

- **This is NOT task evidence.** Per W11's own caveat ([`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md):131): a population-match result "confirms the production traversal's edge-layer population equals true declared-dependency reachability … it says nothing about whether declared-dependency direction is the task-faithful axis (that is exactly what Q7 answers)." Every W13 number inherits that caveat verbatim.
- **The DIRECTION default stays bound to the frozen Q7-AXIS reading** (w11 doc :176-184, recorded before any label existed): accuracy ≥ 0.8 with Wilson lower bound > 0.5 ⇒ dependency direction is task-faithful; accuracy ≤ 0.5 ⇒ reversed (dataflow) and "dependents" is task-faithful; ambiguous ≥ 30% ⇒ the axis does not read directionally. W13 does not re-derive, compete with, or precondition that reading.
- **Any default flip — hop depth or direction — is an owner decision.** This record produces a RECOMMENDED value under a frozen rule (§7); it mints no default change.

## Pre-registered analysis record

Committed BEFORE the W13 battery produces any statistic. The battery file (WP5) implements exactly this record; any divergence discovered later is a defect in the battery, not a license to edit this record.

### 1. Presets

- **P1** = `staging-extended-localstack-v2`, **P2** = `staging-localstack` — the selection presets: the §7 recommendation rule reads ONLY these two.
- **P3** = `staging-heldout-mesh` — **confirmatory-only**: P3 cells are reported alongside, but P3 **cannot select or veto the recommendation retroactively**. If P3 disagrees with the P1/P2-selected K, that disagreement is a reported finding for the owner, never a re-selection. (P3 remains self-authored, out-of-tuning-distribution material — the W12 claim scoping applies; R8-F4 stays open.)
- All presets load through the same shared seam the W11/W12 batteries used; arm **I** scenes (`{ layoutMode:"strata", pipelineCompact:true, strataSweeps:4, strataCoordinateRefine:true }`, byte-equal option bundle to W11/W12).

### 2. Anchors

Anchors are constructed by the **W11 tracing-cell construction rule**, unchanged — the same anchor population the W11 battery and the W12 tracing cells used (resource-level graph addresses; the exact requested counts on P1/P2 are pinned as sanity anchors in §6). No new anchor-selection heuristic is introduced.

### 3. Grid

- **K axis:** every integer K from **0** to the **maximum observed uncapped distance** (per preset × direction: the largest finite `nodeDistance` value over all anchors; the grid's upper bound is the maximum of these across the preset's directions), **plus ∞** (uncapped).
- **Direction axis:** `{ both, dependencies, dependents }` — the three modes of the shipped W11 `getTerraformRelationshipFocus` options surface (`direction`, with `-1` as the JSON-safe unlimited-hops sentinel in AppState).
- **Slice derivation (no per-K BFS):** for each (preset, direction, anchor), run the **uncapped** `getTerraformRelationshipFocus` call ONCE and take its `nodeDistance` map; the K-slice is the set of nodes with `nodeDistance ≤ K`. Every K cell is a **threshold of the same single traversal** — a per-K re-traversal would be a battery defect (and a determinism risk), not an alternative implementation.

### 4. Truth builders — PER DIRECTION (pinned)

The truth cone is direction-specific. Judging every mode against a single closure would be a category error; the three builders are:

- **`dependencies`** → **forward closure**: BFS over declared-relationship arrows **source→target** from the anchor — the W12 `trueReachFrom` pattern (`terraformPipelineStrataW12HeldoutScaleBattery.test.ts:1175-1201`: self-loops skipped, parallel arrows collapsed, `computeStrataConeMetrics` convention).
- **`dependents`** → **REVERSE closure**: the same BFS on the **transposed** arrow set (target→source from the anchor) — who is reachable by following declared relationships **into** the anchor.
- **`both`** → judged **against the FORWARD closure**. This is deliberate and asymmetric: the `both` cells are a **task-mismatch measurement** in W11's framing (the shipped undirected default polluted/capped vs the true directed impact cone), NOT a fair-population comparison. An undirected truth set would define the mismatch away. State of the art here is W11's mismatch cell, reproduced across the K axis.

### 5. Estimator (pinned)

- **Anchor self-inclusion:** the anchor itself is a member of BOTH the predicted set and the truth set (the W11 convention; `trueReachFrom` seeds `reach` with the anchor).
- **Per-anchor precision/recall** on graph-address node sets; **equal anchor weighting** in every aggregate (macro mean over anchors — no cone-size weighting).
- **Unmappable anchors** (no matching graph address in the scene) are **excluded from aggregates, counted, and reported**; on P1/P2 the unmappable count **MUST be zero** (hard-asserted — a nonzero count on a selection preset fails the battery loudly; on P3 a nonzero count is reported and flagged, and voids affected P3 cells).
- **Per-preset conjunction:** the §7 rule requires its thresholds on **BOTH P1 AND P2** independently — never on a pooled or averaged cross-preset number.
- **Aggregation from RAW integer counts:** per-anchor |predicted ∩ truth|, |predicted|, |truth| are kept as integers; ratios are computed from those integers at aggregation time. **Rounding is presentation-only** — no number is rounded before a threshold comparison; the §7 `≥0.90` / `≥0.95` comparisons run on full-precision values.

### 6. Sanity anchors (executable; hard-asserted before any sweep cell is read)

The battery reproduces the committed W12 artifact's tracing cells **exactly** before any W13 sweep number is read (guard pattern = the W12 anchor block, `terraformPipelineStrataW12HeldoutScaleBattery.test.ts:1875-1908`: requested == mappable, empty unmappable list, exact aggregate equality; the orchestrator is ordered so sweep cells are not built until the anchor is green). Anchor values, quoted from [`strata-baselines/q12/W12_HELDOUT_SCALE_BATTERY.normalized.json`](./strata-baselines/q12/W12_HELDOUT_SCALE_BATTERY.normalized.json) (the committed run-twice determinism comparand):

- **Shipped undirected 3-hop mismatch cell** (`direction:"both"`, `maxHops:3` — the W13 grid's (both, K=3) cell must equal it):
  - P1: `meanPrecision` **0.4641** / `meanRecall` **0.6824**
  - P2: `meanPrecision` **0.4832** / `meanRecall` **0.7389**
- **Anchor populations:** P1 `anchorsRequested` **50** / `anchorsMappable` **50**, P2 **36** / **36**; `unmappableAnchors` **[]** (zero) on both presets, both tracing cells.
- **Directed production call** (`direction:"dependencies"`, uncapped — the W13 grid's (dependencies, ∞) cell must equal it): per-anchor **minima** `minPrecision` **1** / `minRecall` **1** (hence mean 1/1, perfect shares 1) on both P1 and P2.

Any mismatch on these fields fails the battery loudly (harness-health assertion, not a report cell).

### 7. Frozen recommendation rule (the only selection permitted)

**Per direction**, on the P1/P2 selection presets:

- **RECOMMENDED K** = the **smallest** K such that macro precision **≥ 0.90** AND macro recall **≥ 0.95** on **BOTH P1 and P2** (raw-count macro per §5, full precision, no rounding).
- **Tie-break** (identical qualifying K across candidate readings): the lower **cone-size share** (mean |predicted| / scene node count — the flooding proxy) wins.
- **If no K qualifies** on a direction ⇒ **keep the current default 3** for that direction; the failure to qualify is itself the reported finding.

**Metrics reported alongside (never selecting):** cone-size share per (K, direction, preset) — the flooding proxy; the **distance histogram** (count of nodes at each finite `nodeDistance`, per direction/preset, aggregated over anchors); and the **≥2-tier wash-saturation share** (share of anchors whose K-slice covers ≥ the scene population at K−2 tiers of the histogram — i.e. how quickly the slice saturates toward "highlight everything", the visual-wash proxy).

### 8. Outcome definitions + protocol (pre-registered)

**Per cell** (preset × direction × K):

- **VOID** — the cell could not be computed honestly: unmappable anchors > 0 on the cell's preset when that preset is P1/P2 (battery fails anyway), a P3 anchor-population defect, or a traversal/layout throw on the cell's scene (throw captured and stamped, report still written — the W12 F2 discipline).
- **SUPPORT** — cell computed, deterministic, and consistent with its frozen fixed points (the §6 anchors for the pinned cells; internal consistency for the rest: monotone non-decreasing recall in K, predicted-set nesting under thresholding).
- **INCONCLUSIVE** — computed but flagged (e.g. a monotonicity or nesting violation, which would indicate a `nodeDistance` map defect and is reported as a harness finding, not adjudicated away).

These classes describe **measurement health**, not layout quality — W13 has no IMPROVING/WORSENING axis; it measures one traversal against ground truth.

**Determinism:** seed 20260704; no `Date.now`/`Math.random` in any report-affecting path; the suite is **run twice** and the two report JSONs must **deep-equal after stripping wall-clock/timing keys** (the W11/W12 normalization approach); result of the comparison recorded with the results.

**Output convention:** one orchestrating test writes ONE report JSON to **tmpdir by default**; env **`HOPSWEEP_REPORT_DIR`** promotes the output to a chosen directory (set it to `docs/strata-baselines/hopsweep` to refresh the committed copy). CI never rewrites committed artifacts. The `hopsweep/` artifact directory is **non-frozen** — see [`strata-baselines/hopsweep/README.md`](./strata-baselines/hopsweep/README.md); verified that the W12 battery performs no runtime scan of `docs/strata-baselines/` (its "no committed artifacts" note is a manually verified header comment; its only filesystem read there is `q12/P3_DISTINCTNESS_PROFILE.json`), so the new subdirectory cannot trip any existing battery.

## Amendments

_None. (Dated, labeled amendments only, per the header rule — an amendment touching a definition must land before the numbers it affects are read.)_

## Results

**PENDING — battery not yet run.** This section is intentionally empty at pre-registration; the WP5 battery appends here without editing the record above.

### Sweep cells (P1/P2 selection, P3 confirmatory)

PENDING — battery not yet run.

### Sanity anchor reproduction (§6)

PENDING — battery not yet run.

### Recommendation under the §7 rule

PENDING — battery not yet run.

### Determinism (§8 run-twice)

PENDING — battery not yet run.

## Interpretation

**BLOCKED-ON-Q7.** The direction reading of any W13 number waits on the owner's Q7-AXIS labeling (standing W11 exit criterion, `docs/strata-baselines/q7axis/`, runbook in [`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md)). Until Q7 labels land: the §7 output is a per-direction RECOMMENDED K under a frozen population-match rule; which direction's recommendation is the task-faithful one is exactly Q7's question; and any default change (hop depth or direction) is the owner's decision, made nowhere in this document.
