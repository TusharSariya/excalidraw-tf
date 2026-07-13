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

**AMENDMENT-1 (2026-07-13, recorded BEFORE the WP5 battery produced or read any statistic — definition/naming pins only, no threshold or estimator change):**

1. **Report filenames.** The record's output convention (§ Output convention) names no file. Pinned per the WP5 task order: the battery writes **`FOCUS_HOP_SWEEP.json`** plus **`FOCUS_HOP_SWEEP.normalized.json`** (wall-clock keys stripped — the run-twice byte-compare comparand). This supersedes the anticipated `W13_HOP_SWEEP_BATTERY.json` names in [`strata-baselines/hopsweep/README.md`](./strata-baselines/hopsweep/README.md) (that README predates WP5 and is a directory-convention note, not part of the pre-registered record).
2. **Cone-size-share denominator.** §7's "scene node count" is pinned as the **traversal node universe**: the set of distinct graph addresses appearing as an endpoint of any focus-traversal edge (relationship endpoints + `directions[]` hints on `isTerraformLayerEdge` elements) ∪ the anchor set — i.e. exactly the population an unbounded flood could highlight. Recorded verbatim in the report meta.
3. **≥2-tier wash-saturation share.** §7's prose is pinned to this operationalization: for cell (preset, direction, K with K ≥ 2), the share of mappable anchors whose (K−2)-slice already equals their full uncapped reach for that direction (`|slice(K−2)| == |slice(∞)|` — the anchor has been fully saturated for ≥ 2 histogram tiers by K). K ∈ {0, 1} ⇒ 0 by definition; the ∞ cell carries `null` (not applicable). REPORT-only; never selects.

These pins were committed to the battery implementation before any run; no sweep number existed when they were made.

## Results

**Battery run 2026-07-13** (WP5, `packages/excalidraw/components/terraformPipelineStrataHopSweepBattery.test.ts`, arm I `{layoutMode:"strata", pipelineCompact:true, strataSweeps:4, strataCoordinateRefine:true}`, seed 20260704). Full cells: [`strata-baselines/hopsweep/FOCUS_HOP_SWEEP.json`](./strata-baselines/hopsweep/FOCUS_HOP_SWEEP.json) (+ `.normalized.json`, the run-twice comparand — AMENDMENT-1 filenames). All cells SUPPORT (no VOID, no INCONCLUSIVE, `reportFindings: []`, `softFailures: []`); zero unmappable anchors on all three presets (P1 50/50, P2 36/36, P3 50/50). Numbers below are full-precision macros rounded to 4dp for presentation (§5 — the rule ran unrounded).

### Sweep cells (P1/P2 selection, P3 confirmatory)

**`dependencies`** (truth = forward closure; macro precision = **1.0000 at every K on every preset** — the directed slice is a subset of the true cone by construction, so the K axis trades recall/wash only). Macro recall by K:

| K | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | **9** | 10 | 11 | 12 | 13 | ∞ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | .1218 | .3408 | .5336 | .6671 | .7746 | .8420 | .8892 | .9195 | .9431 | **.9599** | .9766 | .9884 | .9966 | 1.0 | 1.0 |
| P2 | .1644 | .4495 | .6464 | .7389 | .8146 | .8638 | .9058 | .9352 | .9562 | **.9710** | .9824 | .9920 | .9968 | 1.0 | 1.0 |
| P3 | .1263 | .2957 | .4587 | .5451 | .6255 | .6900 | .7422 | .7859 | .8197 | .8488 | .8764 | .9031 | .9259 | .9451 | 1.0 (K=21) |

Cone-size share at the qualifying K=9: P1 0.1797, P2 0.1783 (vs 0.2097/0.2016 uncapped). Max observed finite distance: 13/13/21.

**`dependents`** (truth = REVERSE closure; macro precision likewise **1.0000 everywhere**). Macro recall by K:

| K | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | **10** | 11 | 12 | ∞ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | .2335 | .3555 | .4678 | .5720 | .6717 | .7516 | .8084 | .8568 | .9050 | .9467 | **.9756** | .9933 | 1.0 | 1.0 |
| P2 | .1632 | .2986 | .4201 | .5324 | .6377 | .7374 | .8094 | .8615 | .9067 | .9457 | **.9736** | .9915 | 1.0 | 1.0 |
| P3 | .1421 | .2940 | .4144 | .5190 | .5997 | .6721 | .7260 | .7717 | .8095 | .8400 | .8674 | .8918 | .9147 | 1.0 (K=20) |

Cone-size share at the qualifying K=10: P1 0.0778, P2 0.0943. Max observed finite distance: 12/12/20.

**`both`** (judged vs FORWARD closure — the W11 task-mismatch cell across the K axis, deliberately asymmetric per §4). Precision decays monotonically from 1.0 at K=0 and is already below the 0.90 bar at K=1 (P1 0.7457, P2 0.7338, P3 0.7190), reaching the uncapped floor 0.2455/0.2476/0.1766; recall crosses 0.95 only around K=8 where precision is ~0.29 — **no K satisfies the conjunction on either selection preset**. The undirected wash is also the flooding mode: uncapped cone-size share 0.8542 (P1) / 0.8140 (P2) / 0.9243 (P3) vs 0.2097/0.2016/0.1319 for `dependencies` uncapped.

**Wash saturation (AMENDMENT-1(3) definition, reported alongside):** directed modes saturate gradually (e.g. `dependencies` P1: 0.28 at K=4, 0.72 at K=8, 1.0 at K=15); `both` stays 0 through K=10 on P1/P2 then jumps (P1 0.16 at K=12 → 0.90 at K=17) — the undirected slice keeps growing across nearly the whole grid.

**P3 (confirmatory-only, never selects):** the same curve shapes reproduce, but the self-authored mesh is deeper (maxDist 21/20 directed) and recall rises more slowly — the P1/P2-selected K=9/K=10 reach only ~0.85/0.84 recall on P3 (P3 would need K≈14 for 0.95). This disagreement is a **reported finding for the owner**, not a re-selection (§1); W12 claim scoping applies, R8-F4 stays open. `both` on P3 floods hardest (cone share 0.9243 uncapped, wash-saturated from K=10).

### Sanity anchor reproduction (§6)

**GREEN** (hard-asserted before P3 was built and before the §7 rule was computed):

- (both, K=3) == the committed W12 shipped-3hop mismatch cell: P1 meanPrecision **0.4641** / meanRecall **0.6824**; P2 **0.4832** / **0.7389** — exact, W11/W12 round4 convention.
- Anchor populations: P1 **50/50**, P2 **36/36**, `unmappableAnchors` **[]** on both.
- (dependencies, ∞) == the directed production call: min/mean precision & recall **1/1**, perfect shares 1, on both P1 and P2.
- Forward-truth cross-check vs `computeStrataConeMetrics(...).rows[].coneNodes`: exact match for every mappable anchor on all three presets (zero soft failures).

### Recommendation under the §7 rule (mechanical; owner decides any default flip)

| Direction | RECOMMENDED K | Basis |
| --- | --- | --- |
| `dependencies` | **9** | smallest K with macro precision ≥ 0.90 AND recall ≥ 0.95 on BOTH P1 (1.0/.9599) and P2 (1.0/.9710); K=8 fails on P1 recall .9431 |
| `dependents` | **10** | qualifies on both (1.0/.9756 P1, 1.0/.9736 P2); K=9 fails on P1 recall .9467 and P2 .9457 |
| `both` | **keep 3** (fallback) | NO K qualifies — precision < 0.90 for every K ≥ 1 on both selection presets; the failure to qualify is itself the finding |

Tie-break: not applicable (the smallest qualifying K is unique by construction; cone-size share reported per cell). P3 confirmatory cells included; they cannot veto (see above).

### Determinism (§8 run-twice)

- **In-test:** each preset's fragment built twice (2 scene builds + 2 sweep computations per preset) and deep-equaled after stripping `buildMs` — deterministic on P1, P2, and P3.
- **External run-twice:** the suite was run twice with `HOPSWEEP_REPORT_DIR=docs/strata-baselines/hopsweep`; the two `FOCUS_HOP_SWEEP.normalized.json` outputs are **byte-identical** (`cmp` clean).
- **Tmpdir default verified:** a run without `HOPSWEEP_REPORT_DIR` wrote only to the system tmpdir; `git status --porcelain docs/` was unchanged by that run.

## Interpretation

**BLOCKED-ON-Q7.** The direction reading of any W13 number waits on the owner's Q7-AXIS labeling (standing W11 exit criterion, `docs/strata-baselines/q7axis/`, runbook in [`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md)). Until Q7 labels land: the §7 output is a per-direction RECOMMENDED K under a frozen population-match rule; which direction's recommendation is the task-faithful one is exactly Q7's question; and any default change (hop depth or direction) is the owner's decision, made nowhere in this document.
