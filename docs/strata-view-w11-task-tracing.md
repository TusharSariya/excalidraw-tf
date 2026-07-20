# Strata W11 — task-evidence vertical slice: directed focus + Q7-AXIS + task-tracing battery

**Date:** 2026-07-13 · **Status:** Battery report (REPORT-only cells; no gate asserted, no PASS minted). Ships three default-off components — directed relationship-focus traversal, the Q7-AXIS blinded direction-reading instrument, and a task-tracing battery — per the SDEC-24 task-evidence precondition (v3.2 §8 item 2) and the round-8 core defect (R8-F6): the campaign has optimized geometric proxies without ever measuring the reader task (impact tracing, SDEC-9).

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current (Q7-AXIS owner labeling is the standing exit criterion — WP-OWNER open) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-56 (W6 condition-(iii)) · SDEC-65 |
| Sisters | [`strata-view-w6-highlight-spike-report.md`](./strata-view-w6-highlight-spike-report.md), [`strata-view-w10b-band-compact-battery.md`](./strata-view-w10b-band-compact-battery.md) |
| Next (agent) | Run WP-OWNER (Q7 labeling) — see the owner instructions section below. Until it lands, treat the pre-registered reading as a prediction, not a result. |

## Context

Four independent research tracks (Claude Fable, Claude Opus, codex 5.6 sol, codex 5.6 luna) converged on the same next step at round 8: the campaign needed task evidence, not an 8th geometry lever. Round-8's confirmed core defect (R8-F6, all three agents) is that every prior battery (W3–W10b) measured geometric proxies (crossings, extent, churn) and never the reader's actual task. SDEC-9 pinned that task as **impact tracing** ("if X changes, what breaks downstream" — L→R dependency following) back at round 7; Q7-AXIS (SDEC-24: a 20-edge, both-preset, blinded direction-reading hand-label) was scheduled before M2 gates freeze and has stood owed since.

The proximate trigger was the pending W6 condition-(iii) owner canvas eval (SDEC-56): the plan to validate whether the shipped click-highlight substitutes for further geometry work was about to judge the **wrong feature**. The shipped `terraformRelationshipFocus.ts` click-highlight is undirected and 3-hop-capped, while the modeled task artifact used throughout W5–W10b (`computeStrataConeMetrics`, `rtHatAttenuated`) is a **directed, unbounded** impact cone. W11 closes that gap: it ships an opt-in directed traversal mode, instruments Q7-AXIS to determine which traversal direction the layout axis actually reads as, and runs a battery quantifying exactly how mismatched the shipped undirected mode is against the modeled task.

**Owner decisions locked (plan front matter):**

- (a) W11 scope = P1/P2 only; a held-out third preset is W12 (re-runs this battery out-of-sample).
- (b) Directed focus is opt-in; default click behavior stays byte-unchanged (undirected 3-hop).
- (c) **Q7-AXIS owner labeling is a W11 exit criterion** — W11 is not done until the blinded sheets are filled, scored, and the result artifact committed.
- (d) UI home = **TerraformLayers main-menu section**, colocated with the edge-layer pins.

## What shipped (commits)

| Commit | Scope |
| --- | --- |
| `f2936397d` | WP0 — directed traversal core: `options?: { direction?, maxHops? }` on `getTerraformRelationshipFocus`/`applyTerraformRelationshipFocus` (`both`\|`dependencies`\|`dependents`); directed out/in adjacency; `"both"` short-circuits to the existing path (byte-identity); golden byte-identity regression; C10′ reversed strata back-edge fixture; reveal-≤1-hop invariant held |
| `fe9df4224` | WP1 — runtime threading: AppState fields, TerraformLayers main-menu segmented Direction/Hops controls, demo URL params (`focusdir`/`focushops`), canvas share URL, cold auto-import restore |
| `4ac6469dd` | `-1` JSON-safe sentinel for unlimited hops in AppState (`Infinity` doesn't round-trip through `JSON.stringify`) |
| `0bff1847e` | WP3 — task-tracing battery (`terraformPipelineStrataTaskTracingBattery.test.ts`) |
| `75419a441` | WP2 — Q7-AXIS blinded instrument (sheet + sealed-key generator) and Wilson scorer |
| `acdda87fe` | Shared source-left-of-target proxy consolidated into one module (DRY, plan decision 13) |
| `6a67359b5` | codex diff-review fixes: F1 far-group reveal leak, F2 stale persisted settings on cold share URLs, F4 ingress normalization, F5 finite caps shareable, F6 C10′ test honesty, F7 boundary tests (F3 direction-naming-in-URL-param-name was rejected — see below) |

## Direction semantics (deliberately neutral naming)

Traversal modes are named `"both" | "dependencies" | "dependents"` — never "downstream/upstream/dataflow" — because `customData.relationship.source/target` records the **declared-dependency** direction (what the anchor references), which is not necessarily the dataflow direction (a Lambda declares a dependency on its queue; data flows the other way, queue→Lambda). Q7-AXIS is precisely the instrument that resolves which one the rendered layout axis reads as; until it does, the code, UI copy, and battery reports make no downstream/upstream claim. "dependencies" follows `relationship.source→target`; "dependents" follows the reverse (what references the anchor — the impact cone of changing the anchor).

## Battery results (`W11_TASK_TRACING_BATTERY.json`, seed 20260704, P1/P2, REPORT-only)

### Production-call validation (unfiltered)

The validation cell runs the real, unfiltered `getTerraformRelationshipFocus` production call in directed/uncapped mode against `computeStrataConeMetrics`' true declared-dependency reachability — no test-only population filter (codex's position over an earlier draft that would have restricted the compared population; see SDEC-65).

| Metric    | Result                                       |
| --------- | -------------------------------------------- |
| Precision | 1.0 on every anchor, every arm, both presets |
| Recall    | 1.0 on every anchor, every arm, both presets |
| Anchors   | P1: 50/50 mappable · P2: 36/36 mappable      |

No per-layer exclusion proposal is needed — the production traversal's edge-layer population (`isTerraformLayerEdge`'s 5 layers) matches true reachability exactly once direction and hop cap are uncapped.

### Task-mismatch (shipped undirected 3-hop focus vs true cone)

This is the headline finding: quantifying how far the **shipped, default** feature (undirected, 3-hop-capped) diverges from the modeled directed-impact-cone task.

| Preset | Mean precision | Mean recall |
| ------ | -------------- | ----------- |
| P1     | 0.464          | 0.682       |
| P2     | 0.483          | 0.739       |

- **All pollution** (false-positive membership) = `declaredDataFlow` undirected links — 1,462 node-occurrences on P1, 479 on P2.
- **All misses** (false-negative membership) = the 3-hop cap — 1,023 node-occurrences on P1, 385 on P2.
- **Zero** layer-population misses — the shipped feature's error is entirely direction and hop-cap, not which edge layers it walks.

### rt̂ (task-cost proxy), p50/p90, seconds

| Preset | Arm  | p50   | p90   |
| ------ | ---- | ----- | ----- |
| P1     | A_v2 | 14.77 | 22.92 |
| P1     | I    | 13.36 | 21.39 |
| P1     | I_RS | 14.21 | 24.89 |
| P2     | A_v2 | 11.50 | 19.32 |
| P2     | I    | 12.58 | 21.78 |
| P2     | I_RS | 15.08 | 23.76 |

Paired vs `A_v2`: `I` improves P1 p50 (−0.27, CI [−0.48, −0.05]) but worsens p90 (+2.07); on P2, `I` worsens both cells. `I_RS` worsens every cell measured (p90 +4.61 on P1, +7.58 on P2).

### Crossover α (sensitivity-labeled, W6-comparable)

Per plan decision 10, α is an **assumed substitution model**, not a measurement — these cells are sensitivity analysis, not evidence of a real substitution rate.

- `v2+F` parity-or-better vs unaided `I`: holds through α=0.75 on P1, α=1.0 on P2.
- `I_RS+F` parity-or-better vs unaided `I`: holds through α=0.75 on both presets.

### Direction-consistency proxy (sourceLeftShare)

`sourceLeftShare` = 1.0 on all 6 battery cells (P1/P2 × 3 arms) — every measured-path edge in this battery drew source-left-of-target. This is the **machine proxy**, not the Q7-AXIS reading; it is the same `sourceLeftOfTarget` function the Q7 sealed key uses (DRY, plan decision 13), reported here as a sanity check that the battery's own path population is direction-consistent before Q7 labels land.

### Runtime-apply (real element-patching seam)

25 anchors/preset drove the actual `applyTerraformRelationshipFocus` seam (not just traversal-membership validation):

| Preset | apply p50  | apply max |
| ------ | ---------- | --------- |
| P1     | ~5.4–5.7ms | 8.85ms    |
| P2     | ~2.5ms     | 8.85ms    |

The reveal-≤1-hop invariant held on every anchor — the dim-cone extends under directed/uncapped traversal, but reveal (soft-delete un-hiding) never exceeds 1 hop, matching the shipped click-highlight's existing safety property.

### coneCrossings (p90)

| Preset | I   | A_v2       |
| ------ | --- | ---------- |
| P1     | 79  | 112        |
| P2     | 39  | 33 (worse) |

`I` beats `A_v2` on P1's cone-crossing tail but is slightly worse on P2. `I_RS` is notably worse on both (164 P1, 104 P2). Determinism held true on both presets; battery wall-clock ≈34s.

### Q7 instrument (eligibility, prior to labeling)

| Preset | Eligible cross-hull edges | Sampled |
| ------ | ------------------------- | ------- |
| P1     | 100                       | 20      |
| P2     | 67                        | 20      |

Eligibility uses the deepest-containing-hull cross-hull definition (codex catch #2 — `terraformTopologyPath[0]` is `aws` everywhere on P1/P2, so a path-segment-0 definition would have selected zero edges). Wilson 95% interval on a synthetic 16/20 known-answer: `[0.583983, 0.919339]` — this is the scorer's own hand-derived sanity check, not a real result (no labels exist yet).

## Honest caveats

- **α is an assumed substitution model, sensitivity-only** — the crossover cells say "if a highlight replaces X% of visual-search cost, parity holds through α=…", not "highlights actually replace X% of cost." No telemetry exists to measure the real substitution rate.
- **Two presets, no held-out state** — P1/P2 only (W12 re-runs out-of-sample); the standing R8-F11 held-out-preset gap is unchanged by this battery.
- **REPORT-only** — every cell in this battery and in the Q7 instrument is measurement, not a gate; nothing here mints a PASS or flips a default.
- **Direction naming is deliberately dependency-relative pending Q7** — "dependencies"/"dependents" are the only sanctioned labels until the Q7-AXIS result determines whether the rendered axis reads as declared-dependency direction or its reverse (dataflow). No code, UI copy, or report claims "downstream"/"upstream" today.
- **Production-call precision/recall = 1.0 is a population-match result, not free correctness** — it confirms the production traversal's edge-layer population equals true declared-dependency reachability once direction/hop-cap are uncapped; it says nothing about whether declared-dependency direction is the task-faithful axis (that is exactly what Q7 answers).
- **The task-mismatch cell's pollution/miss attribution is exhaustive by construction** (100% pollution = `declaredDataFlow` undirected links, 100% misses = hop cap, 0% layer misses) — this is a clean result, not a sign the harness stopped looking; both populations were checked against the full 5-layer set.

## Q7-AXIS owner instructions

Q7-AXIS labeling is the standing **W11 exit criterion** (owner decision c). It is not yet done — this section is the runbook for finishing it.

### 1. Generate the blinded sheets (already run once; re-run is deterministic and safe)

```bash
Q7AXIS_REPORT_DIR=docs/strata-baselines yarn vitest run \
  packages/excalidraw/components/terraformPipelineStrataQ7AxisSheet.test.ts \
  --exclude "**/.claude/**"
```

This writes, per preset (`P1` = `staging-extended-localstack-v2`, `P2` = `staging-localstack`):

- `Q7_AXIS_SHEET_{P1,P2}.md` — the human-readable blinded sheet to fill in (a table: row index, endpoint A, endpoint B, canvas region, blank "your read" column).
- `Q7_AXIS_SHEET_{P1,P2}.json` — the same rows in machine-readable form (blank `ownerLabel` per row).
- `Q7_AXIS_KEY_{P1,P2}.json` — the **sealed key**: declared source/target addresses, which sheet slot (A/B) holds the declared source, and the machine `sourceLeftOfTarget` proxy. **Do not open this until every row on both sheets is filled.**

The generator is deterministic (run-twice byte-identical) and blinded by construction: sheet rows carry no source/target role, no coordinates, and no machine-proxy value — only a neutral row index, the two endpoint display names in a randomized A/B order, and a coarse canvas-locating region hint.

### 2. Fill in the sheets

For each of the 20 rows per preset: open the preset canvas (share URL / preset picker), locate the connection between endpoint A and endpoint B in the given region, and answer the frozen proposition — "on the canvas, which way does this connection read as flowing?" — with exactly one of `A->B`, `B->A`, or `ambiguous` (the scorer's `normalizeOwnerLabel` also accepts unicode/ASCII arrows and `"to"`, case/space-insensitive). **Do not open the sealed key file while labeling** — that is what makes the label a blind read rather than a confirmation.

Fill `rows[].ownerLabel` **directly in the sheet JSONs** (`Q7_AXIS_SHEET_P1.json` / `Q7_AXIS_SHEET_P2.json`) — the scoring runner reads the sheets themselves; no separate labels file is needed.

### 3. Score

Run the file-driven runner (`terraformPipelineStrataQ7AxisScoreLabels.test.ts`) against the directory holding the filled sheets and their sealed keys:

```bash
Q7AXIS_LABELS_DIR=<dir-with-filled-sheets-and-keys> yarn vitest run \
  packages/excalidraw/components/terraformPipelineStrataQ7AxisScoreLabels.test.ts \
  --exclude "**/.claude/**"
```

It refuses to score fully-unlabeled sheets (the pre-labeling state must not masquerade as a result), scores per-preset (`n`, `matches`, `mismatches`, `ambiguous`, `missing`, `invalid`, `unknown`, `duplicateWarnings`, `accuracy`, Wilson `{lo, hi}`), pools both presets, prints the summary, and writes `Q7_AXIS_RESULT.json` next to the sheets. Without `Q7AXIS_LABELS_DIR` the suite skips (it is not a CI cell). Robustness is handled inside the scorer: partial/missing labels, unrecognized labels, labels for unknown edge indices, and duplicate labels all degrade gracefully (reported, never thrown) per `terraformPipelineStrataQ7AxisScore.test.ts` (synthetic-fixture unit tests).

### 4. Commit

Per the plan's WP-OWNER scope: filled sheets + scored results land at `docs/strata-baselines/Q7_AXIS_LABELS_{P1,P2}.{json,md}` plus the result JSON. This closes the W11 exit criterion.

## The pre-registered Q7 reading (recorded BEFORE any label exists)

Per plan decision 8, this reading was frozen in the plan **before** the sheets were generated or any owner label was recorded, so it cannot be fit to the result after the fact:

- **Accuracy ≥ 0.8 AND Wilson lower bound > 0.5** ⇒ the axis reads as **dependency direction** — `customData.relationship.source→target` is the task-faithful traversal direction, and the shipped "dependencies" mode (not "dependents") is the impact-tracing-faithful mode.
- **Accuracy ≤ 0.5** ⇒ the axis reads **REVERSED (dataflow)** — the layout's rendered left-to-right axis follows dataflow, not declared dependency, and **"dependents" is the task-faithful impact mode** (the reverse of what the raw `relationship.source/target` field encodes).
- **Ambiguous ≥ 30%** ⇒ the axis **does not read directionally at all** — neither "dependencies" nor "dependents" is a reliable visual read, and impact tracing on this layout requires an explicit indicator (arrowheads, labels, or the highlight feature itself) rather than relying on left-to-right position.

A result landing strictly between 0.5 and 0.8 accuracy, or between the two ambiguous thresholds, is inconclusive under this pre-registration and would need a follow-up decision from the owner rather than an automatic reading.

## Open exit criterion

**WP-OWNER (Q7-AXIS labeling) is not done.** Everything in this report except the Q7-AXIS section is closed evidence (committed, code-complete, battery-run). The Q7-AXIS pre-registered reading above is a prediction frame, not a result, until the owner completes the labeling runbook in this section and the scored result is committed per §4. W11 is not exit-criterion-complete until that lands.
