# RCLL v2 — Layout Engine Specification, revision 2 (normative)

| Field | Value |
| --- | --- |
| Status | **Normative specification — source of truth.** Supersedes [`rcll-v2-spec.md`](./rcll-v2-spec.md) (v1.0) in full, **except** v1.0's S5/S6 `PipelineGroupConstraint` type and S7 `TerraformOverlayStore` schema, which are **incorporated by reference unchanged** (their *mechanics* are corrected here, §7-S7). |
| Version | 2.0 (2026-07-04) |
| Engine | New layout variant `pipelineLayoutVariant: "rcll-v2"`, own top-level UI button; existing `v2`/`rcll` engines byte-untouched (output-identical guarantee, see D2′) |
| Produced by | Round-5 adversarial review ([`rcll-v2-shit-test-round5.md`](./rcll-v2-shit-test-round5.md)): full anchor re-verification, 9 literature agents (citations fetched at source), codex outside voice, product + eng reviews, and 4 empirical probes — including the Q2 measurement rounds 1–4 specified but never ran |
| First milestone | **M1 = engine exists, readable, honestly gated**, split into **M1a** (S0a → S9 → S4 → S0b@K=0 — shippable rendering checkpoint) and **M1b** (sweeps → SA7 → S0c → S8 → S2 — gates frozen). NOT diff-stability-only. |
| Audience | An implementing agent executing §7 step by step; a reviewer checking §8 conformance. Where an algorithmic choice is genuinely open, it is an **OD-n** block in §9 with options + tradeoffs — do not resolve silently; pick per the stated default or escalate. |


## Document graph

| Relation | Link |
| --- | --- |
| Role | Normative-base |
| Status | Current base — read with v3.0 + v3.1 (later wins) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec.md`](./rcll-v2-spec.md); [`rcll-v2-shit-test-round5.md`](./rcll-v2-shit-test-round5.md) |
| Children | [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md); [`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) |
| Sisters | — |
| Next (agent) | Implement: algorithms §6 + steps §7, then apply v3.0/v3.1 amendments beside it. |

## 0. What changed since v1.0 and why (read this first)

Revision 2 exists because round 5 falsified parts of v1.0 and re-weighted its objective:

1. **Priority order corrected (owner decision, 2026-07-04).** READABILITY is the #1 product objective — "hierarchical, topological, containerized, strict L→R flow; if A→B, B sits right of A; compact but never semantics-breaking." **Diff-stability is demoted from objective to hard constraint**: every readability pass ships behind a frozen not-regress churn gate. Rationale: an unreadable diagram acquires no users and therefore has nothing to keep stable (adoption gate before retention gate); Round 4's inversion also rested on an unshipped premise (the "editable seed" — regeneration today destroys all edits, §5-F6) and on over-read citations (§10, Kobourov/Ware corrected readings).
2. **Two algorithms replaced.** v1.0's A2 (single forward barycenter, no sweeps) implemented the configuration its own keystone citation measured and rejected ("Strategy 2 … produces ONO layouts" — Domrös & von Hanxleden GD'24) and its diff-stability proof was false; v1.0's A3 pseudocode double-reversed the sink sequence (mechanically wrong; misclassifies acyclic chains as feedback). Corrected forms: §6-A2, §6-A3.
3. **Two algorithms added that v1.0 never wrote.** A0 (compound placement — hulls, frames, titles, bands: v1.0's S0 was a label over the plan's largest unknown) and A7 (coordinate assignment — the only lever that moves near-straightness, empirically pinned at 0.10–0.17 across all seven measured configurations).
4. **The M1 gate replaced.** v1.0's A4 metric inverted its citation (Sondag et al. explicitly reject absolute |Δpos|), had an identically-zero flip term, no thresholds, and depended on an M2 artifact. Corrected: §6-A4, with a threshold derive/validate protocol.
5. **The overlay design re-aimed.** Regeneration is a wholesale `scene.replaceAllElements` (`terraformSceneApply.ts:124`) — `reconcileElements` never runs on that path (it is collab-transport-only). v1.0's C9/S7 orphan mechanics targeted a hazard that does not exist there, while missing the real one (regeneration destroys every user edit). Corrected: §7-S7.
6. **Identity constants fixed.** `version=1`/`versionNonce=0` made same-cardinality regenerations invisible to collab reconcile, the sum-of-versions broadcast gate, and the Firebase save gate; seed 0 is RoughJS's "unseeded" sentinel (→ `Math.random()` per render); endpoint-sorted edge ids collide A→B with B→A. Corrected: §6-A6.
7. **The substrate decision empirically confirmed.** Q2 seven-arm A/B (§4): no rcll configuration — including the owner's daily view — beats the plain v2 baseline on deviation/crossings/area, and v1's built readability passes do not compose. Building NEW on the v2 substrate (depth-pinned X + skyline) is supported by measurement, not just prose. *(Power caveat: one preset, one run per arm — the ≥2-preset battery in §8 is a precondition for irreversible commitments.)*

Everything in v1.0 that survived attack is carried forward: the D2/D3/D4 engine shape, depth-pinned X, address-keyed identity, the deterministic-finalize decision, S4's pure gate, greedy-FAS repair + styled back-edges as the cycle policy, and the address as the canonical business key.

## 1. Decision history (compressed; full trail in the companion docs)

| When | Event | Net result |
| --- | --- | --- |
| 2026-06-20 → 06-26 | Pivot memo; assessment; Rounds 1–3 | Depth-pinned X is the correct backbone; crossing-count demoted for path-tracing; gates defined but **Q2 never executed** |
| 2026-06-29 | Round 4 + v1.0 spec | Product facts answered (regenerate-per-PR; editable seed) → diff-stability promoted to #1; D1–D8 locked; **over-rotation later corrected** |
| 2026-07-04 | **Round 5** ([report](./rcll-v2-shit-test-round5.md)) | Owner: readability #1. A2 refuted; A3/A4 broken as written; S7 mis-aimed; A6 constants unsafe; Q2 finally measured (v2 substrate wins; near-straightness structural); build order corrected. **This revision.** |

### Locked decisions (v2.0)

| # | Decision | Choice | Basis / tradeoff |
| --- | --- | --- | --- |
| **D1′** | Within-column order | **Hull-scoped Strategy-1**: deterministic crossing-reduction sweeps with the content key as the stable tiebreak (§6-A2) | The cited GD'24 result *as the paper actually states it*. Tradeoff: sweeps cost a bounded, measurable amount of churn vs a pure content sort — paid because pure model-order is the paper's rejected "ONO" configuration; the churn cost is gated by T2, not assumed. |
| **D2′** | Engine shape | New `rcll-v2` variant on the **v2 substrate** (depth-pinned X + skyline), existing engines **output-identical** (not "files untouched" — shared-file refactors are allowed iff existing-engine snapshots hold, see S10) | Q2-supported. Tradeoff: months before parity with v2's hardening, vs zero regression risk to shipped views. |
| **D3′** | Reuse boundary | Reuse pure kernels (`longestPath`, `dropY`, `segmentsCross`, `computeNetworkSimplexDepths`, `constraintGraphHasCycle`); fork ordering/placement/finalize. **Fork a sequence-free `computeDepths` signature** — the shared one's edge type embeds `sequence` (C4 conflict). | |
| **D4′** | Determinism | Own finalize; **R6 scoped to "byte-identical within a pinned environment"** (comparator pinned, fonts stubbed in tests, both finalize call sites covered). Cross-environment identity is a non-goal (ICU/`measureText`/asset realities, §5-F7). | |
| **D5′** | Cyclic policy | Corrected greedy FAS (ELS93-true) + self-loop drop + E′ contract + styled back-edges; per-SCC + model-order arc selection as the diff-stability refinement (OD-4) | |
| **D6′** | Containment schema | Configurable, **copy-then-parametrize** inside the new engine first (S10); consolidation later | Avoids the D2 contradiction of refactoring `topologyPathForCluster` under the existing engines mid-build. |
| **D7′** | Ranking | Longest-path floor, **NS refinement admitted** behind the pure gate as an A/B (OD-1) — v1.0's C1 wording forbade the repo's own proven kernel | |
| **D8′** | Milestones | **Readability payload in M1; diff-stability as its frozen gate.** M1 exit = T2 **and** the readability battery on ≥2 presets. | The inverse of v1.0's M1. |
| **D9** | Metric family | Owner-calibrated: vertical deviation, near-straight %, hub centering (with hub counts), aspect, chord-pierce + cluster contiguity, crossings **per eligible edge pair** (normalized). Raw crossing count is a diagnostic, never a gate. | Owner's revealed preference (§4.3 of the report): prefers the arm with the most crossings because it wins deviation/height/containment. |

## 2. Purpose, scope, definitions

**Purpose.** A new pipeline-view engine whose output is a **readable, semantically-ordered, diff-stable, identity-keyed function of the Terraform graph**, regenerated every PR/plan/drift, carrying user overlays keyed by address.

**Scope.** The `rcll-v2` engine: plumbing + UI button, cycle repair, ranking, hull-scoped ordering, compound placement, coordinate assignment, deterministic finalize, constraint input, overlay persistence, configurable schema. **Out of scope:** existing engines (output-identical), collab transport internals, extraction fidelity, edge *routing* (deferred with an owner — §9 OD-9).

**Definitions** (unchanged from v1.0 except as noted): TFD; hull/cluster/hull tree; depth; column; **diff-stability** (small input delta ⇒ small, localized output delta — distinct from determinism); **container-pierce** (a straight edge **chord** crossing a foreign container rect — "routed segment" was v1.0 fiction; edges today are 2-point center-clipped chords); ancestor containment (required, not overlap); overlay; address (canonical Terraform address in `customData.terraformVisibilityKey` — note it is a *precomputed field with falsy-OR fallbacks that can be null*, not a canonicalizing function; the engine MUST handle the fallback chain, `terraformVisibility.ts:252-263`).

## 3. Requirements

| ID | The `rcll-v2` engine SHALL… | Kind |
| --- | --- | --- |
| **R1** | render hierarchical, L→R, topological: a cluster's X column = its rank (longest-path floor, optionally NS-refined per OD-1); `X = columnX[rank]`. | structural |
| **R2** | produce no overlap between non-ancestor rectangles and no title/content collisions; **hull contiguity in every column** (members of a hull occupy contiguous Y-slots within their hull's extent — the A2 scoping makes this structural). | structural |
| **R3** | acyclic TFD: zero backward edges, no same-column TFD edge (by construction of longest-path over E′). Cyclic TFD: only A3's reversed set is backward, each styled (E′ contract: all phases after A3 consume E′; true direction restored at draw). | structural |
| **R4** | meet the **readability battery** (D9 metrics) with **frozen thresholds** on ≥2 presets: near-straight % and median vertical deviation strictly better than the v2 baseline column of the Q2 table; hub centering reported with hub counts; chord-pierce + contiguity not regressed vs the M1-exit frozen baseline. | quality (the #1 objective) |
| **R5** | not produce excessive width: widen-then-compact retained; NS-refinement and grid-packing levers stay flag-gated until they pass T2. | aesthetic |
| **R6** | be deterministic: identical input in a **pinned environment** ⇒ byte-identical output (pinned comparator; no `Math.random`/`Date`/wall-clock; fonts stubbed in test env; both finalize call sites covered). | quality |
| **R7** | be diff-stable: the fixture-triple deltas (§8-T2) keep content-unchanged clusters under the frozen thresholds of the corrected A4 metric. | hard constraint on R4 work |
| **R8** | assign stable identity: `element.id` = pure function of address + role (+ content-derived ordinal), stable across regenerations, **unique before `restoreElements` runs** (which silently randomizes duplicates, `restore.ts:739-741`). | quality |
| **R9** | persist user overlays (groupings/annotations/styles) keyed by address across regeneration **on the `replaceAllElements` path** (§7-S7); auto-layout owns geometry. | quality |
| **R10** | support a configurable containment schema; default schema reproduces today's AWS taxonomy (structural-deep-equal, pinned env — not byte-snapshot). | quality |

## 4. Empirical baselines (normative context — gates reference these numbers)

Preset `staging-extended-localstack-v2`, 145 TFD arrows, `diagnosePipelineScene`; reproduce: `yarn vitest run packages/excalidraw/components/terraformPipelineQ2Audit.test.ts` (probe currently uncommitted).

| Arm | crossings | med. vert. dev px | near-straight | hub-center | W×H (aspect) |
| --- | --- | --- | --- | --- | --- |
| v2 compact (the substrate baseline to beat) | 177 | 402 | 0.17 | 0.05 | 10.0k×10.1k (0.99) |
| rcll everything-off | 250 | 655 | 0.14 | 0.02 | 11.8k×14.3k |
| rcll `readable` profile | 185 | 936 | 0.16 | 0.07 | 11.8k×16.6k |
| rcll max (crossingMin+straighten+coordRepack+compact) | 219 | 496 | 0.15 | 0.07 | 11.8k×14.3k |
| rcll max + NS shorten | 249 | 532 | 0.17 | 0.09 | 10.8k×14.5k |
| owner's daily view (rcll full+ancillary+rankSeparate+…) | 371 | 701 | 0.10 | 0.11 | 17.7k×15.3k (1.16) |
| v2 full+ancillary | 222 | 2,254 | 0.12 | 0.00 (hubs may be unresolved) | 11.8k×29.1k (0.41) |

Read: (i) the v2 substrate wins everything measurable; (ii) **near-straight is pinned 0.10–0.17 in every arm** — A7 exists to break this; (iii) raw crossing counts across arms are not denominator-normalized (E/F include ancillary edges) — future batteries normalize per eligible pair; (iv) the owner prefers the highest-crossings arm → D9's metric weighting. Diff-stability baseline (churn probe, same preset): one added edge on v2 moves 20/123 addresses (19 unrelated, median |Δy| 634px, Δx=0); full edge-line reorder moves 100% with 51% pair-order flips; rcll ≈4× less add-churn than v2; both engines byte-deterministic run-twice.

## 5. Constraints (invariants) — corrected set

| ID | Constraint |
| --- | --- |
| **C1′** | `X = columnX[rank(v)]` for every cluster; rank = longest-path floor over E′, optionally NS-refined (OD-1) via the pure gate — never mutated mid-probe. No off-grid spill; no `?? PIPELINE_MARGIN` silent fallback (a rank outside the grid is a hard dev-assert, not a left-margin pin). The engine does not reuse `resolveSinkBundles`. |
| **C2** | Structure (R1/R2/R3) never yields to groupings/aesthetics; soft constraints relax lowest-priority-first, address tiebreak, relaxations surfaced. |
| **C3′** | No `Math.random`/`Date`/wall-clock in layout or finalize. Seeds are **nonzero-clamped** (RoughJS treats 0 as unseeded → render-time `Math.random`, `roughjs …/math.js:8-14`). Version policy per A6 (never constant across content changes). |
| **C4′** | Every sort terminates in a content-derived total order using a **pinned comparator** — either code-unit (`<`) or `localeCompare(a, b, "en-US", {…pinned options})`; bare `localeCompare` is forbidden (ICU-version drift). No file-position counter anywhere; the forked `computeDepths` signature carries no `sequence` field. |
| **C5′** | `element.id` per A6; ids proven unique **before** convert/restore (dev-assert), never routed through `regenerateIds:true` + random icon injection; **frame ids SVG-safe** (frame ids are emitted unsanitized into `clipPath`/`url(#…)` — `scene/export.ts:404`, `staticSvgScene.ts:79` — quotes/spaces silently break clipping). |
| **C6′** | Variant/option threading covers the **four** silent-drop seams: (1) the `sceneContext` literal in `layoutTerraformFromSources` (`terraformLayoutCore.ts:1012-1061`); (2) the `applyRcllToggleGuards` input literal (`:481-503`); (3) `terraformSceneApply.ts` session-mapper + spread literals (~`:284/:370`) + the `LayoutSceneContext` type; (4) the **`skipLayoutCache` allowlist** (`terraformSceneApply.ts:253-261`) — an un-allowlisted variant silently serves stale KV-cached geometry. **(5) the dev proof API + demo-URL param mappings** (`excalidraw-app/dev/terraformImportPresetDevPlugin.mjs`, `terraformDemoUrlParams.ts`) — each maintains its own param→option table; a variant absent there is silently unprobeable or mis-mapped, and T5/T9's headless gates route THROUGH it (this session's arm-E measurement was bitten by exactly this class: requested `shorten`, got `compact`). Plus the **variant clobber guard**: `layoutMode==="rcll"` force-rewrites the variant (`terraformLayoutCore.ts:1026-27`, duplicated in `terraformSceneApply.ts`) — `rcll-v2` MUST ride its own layoutMode or the clobber sites must be amended. Threading + cache regression tests required (template: `terraformLayoutCoreRcllThreading.test.ts`), extended with a curl-level assertion: URL param → resolved engine flags echoed in scene meta must match. |
| **C7** | Feasibility probing non-mutating (`isDepthFloorValid` extracted from `Shared.ts:598-601`); only the accepted candidate commits via `applyDepthFloorIfValid` (dual-write is intentional and load-bearing). |
| **C8** | Cross-hull groups get Y-cohesion bias only; never rigid blocks. |
| **C9′** | Regeneration is `replaceAllElements` — the engine's overlay pass (S7) re-applies overlays **after** replacement; a removed resource appears exactly once (ghost via canonical id in the orphan tray). The `reconcile.ts` analysis applies to the **collab lane only** (where A6's version policy is the defense). |
| **C10′** | Cyclic input: A3's reversed set only, styled; **all post-A3 phases consume E′ = (E − F) ∪ reverse(F)**; true direction restored at draw time only. |
| **C11** (new) | Gate hygiene: every threshold in §8 is **frozen by spec amendment before the gated code lands**, derived on one preset set and validated on a disjoint one. A gate whose baseline/threshold is produced by the code under test is void. |

## 6. Algorithms (normative)

Pipeline order (strict): **A3 (cycle repair) → A1 (rank) → A0+A2 (compound placement with hull-scoped ordering) → A7 (coordinate assignment) → A6 (finalize)**. A4/A5 are metrics. Reused kernels marked [reuse]; new code [new]. Every tiebreak uses the C4′ pinned comparator on addresses.

### A3 — Cycle repair: GreedyFAS, corrected [new]

Input: the **collapsed** cluster graph (the same edge set A1 ranks — module collapse is what *creates* 2-cycles and self-loops; the leaf graph is acyclic in canonical presets). Literature: Eades–Lin–Smyth 1993; verbatim restatement Geladaris/Lionakis/Tollis JGAA 27(8) 2023 Alg. 1; Brandenburg–Hanauer 2011 §2.4.

```
0. drop self-loops from E for RANKING/ORDERING only — they remain in the render set:
   finalize (A6) emits them as loop adornments on the node card with id
   tf:edge:…:self:<content-ordinal>, excluded from all §8 metrics.
   dedupe parallel edges for ranking (keep multiplicity as a weight if desired — OD-4);
   the render set keeps every parallel edge, disambiguated by relKind + content ordinal
   in the A6 edge id.
1. (RECOMMENDED, OD-4) Tarjan-condense; run steps 2-4 inside each nontrivial SCC only
   (deterministic adjacency: neighbors visited in pinned-comparator order).
   Composition rule: F = ⋃ SCC-local F sets. No global sequence s is needed —
   the condensation is a DAG, so inter-SCC edges can never be feedback arcs.
2. leftSeq = [], rightSeq = []
   while vertices remain:
     while ∃ sink (outdeg=0):    v = comparator-least such; PREPEND v to rightSeq; remove v
     while ∃ source (indeg=0):   v = comparator-least such; APPEND  v to leftSeq;  remove v
     if vertices remain:         v = argmax(outdeg−indeg), ties comparator-least
                                 APPEND v to leftSeq; remove v
3. s = leftSeq ++ rightSeq                    // *** NO reverse — v1.0's reverse() was the bug ***
4. F = { u→v ∈ E : index_s(u) > index_s(v) }
5. E′ = (E − F) ∪ reverse(F)                  // E′ is what A1/A2/A0/A7 consume (C10′)
   draw edges of F in TRUE direction with distinct back-edge styling (Holten & van Wijk CHI'09);
   all other edges strictly L→R
```

Facts an implementer must not re-litigate: greedy FAS is a heuristic, not minimum (min-FAS is NP-hard); the m/2 − n/6 bound is vacuous on 2-cycle-dominated inputs; it can reverse edges that lie on no cycle — acceptable, but **T7 pins which arc is reversed** so changes are visible. The v1.0 bug is regression-guarded by T7's mandatory fixtures: (i) acyclic chain ⇒ F = ∅; (ii) 2-cycle + 3-chain ⇒ |F| = 1 with the arc pinned; (iii) self-loop fixture ⇒ dropped, graph acyclic. Whole-graph GreedyFAS is deterministic but not diff-stable (unrelated edges can flip which arc of an untouched cycle reverses) — hence the per-SCC recommendation and OD-4's arc-selection refinement.

### A1 — Rank (X column) [reuse + option]

```
floor(v) = longest-path rank over E′ (Kahn; reuse the longestPath kernel via a
           forked, sequence-free computeDepths signature)         // C4′
OPTION (OD-1, default ON as an A/B behind a flag):
  rank = computeNetworkSimplexDepths(floor, E′)   [reuse, Shared.ts:638 — exact
         Gansner TSE93 §2, pure, deterministic (Bland's rule), starts from the floor,
         preserves strict forwardness; measured −8.4% width in the host repo]
  committed only through isDepthFloorValid → applyDepthFloorIfValid (C7)
  // NOTE: isDepthFloorValid's extraction (S4) is therefore an M1 step, BEFORE S0b —
  // NS stays OFF until S4 lands
X(v) = columnX[rank(v)]
```

Tradeoff (state of knowledge): longest-path is the literature's low-quality baseline ("performs very poorly in terms of drawing area, number of dummy vertices and edge density" — Healy–Nikolov, Handbook ch. 13 p. 421; classic pathology: a source feeding only a deep node draws a full-width edge that NS shortens to one column — the owner's exact complaint class). NS's cost is R7: it re-optimizes per component, so one added edge can move ranks of untouched nodes. **Neither is assumed the winner: T2 measures both arms; the flag ships whichever passes R4+R7.** Since A3 runs first, no cyclic clamp exists in this engine (v1.0's inherited clamp assigned raw TFD sequence numbers as depths — up to hundreds — and silently skipped both rewrite arms; that failure mode is structurally removed).

Locality honesty (corrects v1.0 §5.1): rank changes cascade transitively, and `columnX` widths derive from per-column max card width, so a single wider label translates all columns rightward. X churn is *bounded and benign-shaped* (translations), not "localized" — which is exactly why A4 must be translation-invariant.

### A0 — Compound placement (the algorithm v1.0 never wrote) [new]

Owns: hull tree, frame extents, title reserve, band policy, and the per-hull placement loop. Grounded in Sander 1996 (global base ranking, derived cluster spans) and the as-built v2 packer semantics (verified this round), minus its defects (sink-bundle spill, `?? PIPELINE_MARGIN`, firstSequence).

```
inputs: clusters (leaves) with rank(v) and built skeleton sizes; hull tree H —
        **in M1 a hardcoded in-engine COPY of today's provider→account→region→vpc→
        subnetZone semantics of buildHullTree** (the "copy" half of copy-then-
        parametrize happens in S0b; S10 later turns the copy into schema config;
        the shared buildHullTree is never mutated);
        E′; global columnX[] from per-column max leaf width (+ COLUMN_GAP)

layoutHull(h):                                    // post-order over H
  1. for each child hull c of h: layoutHull(c)    // children become fixed-size boxes
  2. units(h) = child hulls of h + leaf clusters directly in h
     unit.colSpan = [min,max] rank over the unit's leaves (a hull spans its leaves' ranks)
  3. ORDER units within h by A2 (hull-scoped — this is the R2-contiguity guarantee:
     ordering happens per-hull, so sibling-hull members can never interleave).
     A2 produces ONE sequence over units(h) (not per-column orders) — multi-column
     units have exactly one position in it; the sequence IS the placement order.
  4. PLACE units — BRANCH on policy = schema(h.role):
       "packed" (region/vpc/subnetZone default): per-hull skyline —
         for units in A2 sequence order:
           dropY(unit, x-range = the unit's ACTUAL padded horizontal extent —
                 its box width incl. FRAME_PAD/TITLE geometry, anchored at
                 columnX[colSpan.min] — never the bare column span, or padded
                 boxes with adjacent spans can still overlap; skyline of h)
         [reuse dropY semantics, Pack.ts:137-160 — monotone downward, deterministic;
          gap-filling is explicitly out of scope v1 (OD-6)]
       "banded" (provider/account default): vertical full-width stack —
         units stacked top-to-bottom in A2 sequence order with BAND_GAP;
         each unit's band box spans the PARENT's content width (the band ignores
         columnX for its own box; leaves INSIDE the band still pin to the global
         columnX grid — today's v2 band semantics).
  5. h.box = bbox(units) + FRAME_PAD on all sides + TITLE_RESERVE at top
     (the title strip is INSIDE the box — any positive sibling gap keeps frames+titles
      disjoint by construction; this is how R2's title clause is structural)
  6. (band policy lookup is defined by the schema, S10; M1 hardcodes the copy)
after root: assign absolute coords top-down (children offset by parent origin);
leaf skeletons pre-compensated by (box − frame-local origin) as in buildSceneFromBoxedTree
```

Notes: hull `placement` metadata is taken from the schema path, never first-writer-wins on input order (fixes the verified hazard in `V2Structure.ts:102`). Ancillary strips ("all resources") are out of M1 scope; when ported (M3) they join as pseudo-units excluded from `columnX` sizing, as today. Labels/titles are owned here (TITLE_RESERVE + measured text via the pinned test-env metrics); free-floating label placement beyond the reserve is out of scope with edge routing (OD-9).

### A2 — Hull-scoped ordering: Strategy 1 [new — replaces v1.0's rejected Strategy 2]

Literature (verified at source this round): Domrös & von Hanxleden GD'24 (arXiv:2406.11393) — **Strategy 1** keeps layer-sweep crossing reduction primary with model order as the secondary/stable criterion; their Strategy 2 (order purely by model order — v1.0's design) "cannot be the default option, since it produces ONO layouts" and "may increase the edge crossings significantly." Compound scoping per Forster GD'02 / Sander 1996. Classic sweeps: Sugiyama et al. 1981; ELK's implementation as production reference.

```
scope: within one hull h (A0 step 3), over units(h); edges = E′ lifted to units(h)
       (edge u→w contributes iff its endpoints lie in different units of h)
key(u) = content key = (sortedAddressTupleOfUnitLeaves(u) minimal address)  // pinned comparator

initial sequence over units(h): sort by key                          // model order
each unit's layer for sweep purposes = colSpan.min; a unit's "position" = its
  normalized index in the current sequence, pos(u) ∈ [0,1]
sweep k = 1..K (K = total number of directional sweeps; default K = 4,
  alternating down (layers ascending, neighbors = IN via lifted E′) and
  up (layers descending, neighbors = OUT) — OD-2):
  for each unit in the swept layer order:
    bary(u) = mean of pos(n) over its swept-direction neighbors
              PLUS its SAME-LAYER neighbors (units with equal colSpan.min
              connected by a lifted E′ edge in either direction) — same-layer
              edges dominate inside banded/top-level hulls where most units
              share layer 0; excluding them would leave the most visible
              container ordering effectively alphabetical. The strict-improvement
              acceptance below prevents same-layer oscillation.
              (positions are already normalized — cross-column comparability
               is by construction; see OD-3 for the dummy-chain alternative)
            = pos(u) itself if u has no neighbors at all in scope
              (no-neighbor units float with the sequence; they hold RELATIVE
               model order among themselves via the tiebreak)
  re-sort the sequence by (bary, key); key breaks every tie (stability anchor)
  ACCEPT the new sequence iff the deterministic crossing count of a TRIAL
    A0-step-4 placement (chord crossings over lifted E′) strictly decreases;
    else keep the previous sequence (trial placement is non-mutating — C7 spirit)
sources with no in-neighbors are moved by up-sweeps via successors — fixes
  v1.0's frozen-alphabetical source columns
```

Why this is still diff-stable enough: the procedure is a **pure function of (E′, addresses)** — stateless, no previous-layout anchoring (DynaDAG remains rejected). Its churn is strictly bounded by K accepted improvements from a content-keyed start, and T2 measures it. v1.0's "proof" (edit far away ⇒ key unchanged ⇒ position unchanged) is deleted — it was false even for v1.0's own algorithm (ordinals ripple); stability here is an empirical, gated property, not a theorem.

### A7 — Coordinate assignment (Y refinement) [new — the near-straightness lever]

After A0 fixes X and the within-hull order, refine Y to straighten edges without violating order, hull bands, or non-overlap. Literature: Brandes–Köpf 2001 **with the Brandes–Walter–Zink 2020 erratum** (two correctness flaws in the original); size-aware variant Rüegg/Schulze GD'15; the in-repo `straightenColumns`/`repackColumns` (M5/M5r) as prior art for band-clamped refinement.

```
scope: per hull h (respecting A0 bands), leaves + child-hull boxes as blocks
objective: minimize Σ over E′-chords of |yCenter(source) − yCenter(target)|
           subject to: (a) within-column order from A2 is preserved;
                       (b) blocks stay inside h's band; (c) min gaps maintained
method (OD-5 — two admissible options, default = Option 1):
  Option 1 "priority/median nudge" (default; simpler, matches repo prior art):
    fixed sweep count (default 2 down + 2 up): per column in sweep direction,
    set each block's target y = median of its E′-neighbors' centers in the
    swept-from column; project the column's targets to the feasible order-preserving,
    gap-preserving positions (monotone projection = deterministic isotonic pass);
    accept the column iff Σ|Δy of chords| strictly decreases and no constraint breaks.
  Option 2 "BK-with-erratum": full 4-alignment Brandes–Köpf adapted to blocks of
    heterogeneous height (Rüegg), average of the 4 alignments, clamped to bands.
    Strictly better straightness ceiling; materially more implementation risk.
determinism: fixed sweep counts, pinned tiebreaks, no RNG; pure function of inputs.
normative details (implementer MUST NOT improvise):
  - neighbors = E′ chords incident to the block, long edges included as direct
    chords under OD-3 Option A (under Option B, via their dummy chain);
  - update semantics = per-column batch (compute all targets for the swept column,
    then project once — Jacobi, not Gauss-Seidel), so results are order-free;
  - projection = pool-adjacent-violators (isotonic regression) over the column's
    blocks in A2 order with min-gap offsets — deterministic, O(n);
  - acceptance objective = GLOBAL Σ|Δy| over all E′ chords touching the swept
    column, evaluated after projection; accept iff strictly decreased;
  - nesting/ownership = bottom-up: refine INSIDE each child hull first, then the
    child hull is RIGID at the parent level; after all hulls refine, recompute
    hull extents bottom-up (A0 step 5 re-runs) and re-apply absolute coordinates
    top-down — A7 output is only final after this re-anchoring pass.
  - cross-hull edges: handled at their LCA hull's level as block-to-block chords
    (child hulls are rigid there) — per-hull scoping does NOT ignore them, it
    defers them to the level that owns both endpoints.
R2 STANDING INVARIANT (not an S0b-only acceptance): the R2 structural checks
  (non-ancestor overlap = 0, title collisions = 0, contiguity violations = 0)
  run on the FINAL geometry — after A7 + re-anchoring — in every T9 run, AND as
  an in-engine dev-assert immediately after the re-anchor pass. A MUST checked
  only at one build step is a snapshot, not an invariant.
gate: T2 (churn not regressed past thresholds) + R4 near-straight/deviation strictly
      improved vs the pre-A7 layout of the same engine (else the pass ships OFF).
```

This phase exists because of §4 fact (ii): nothing measurable today moves `fractionNearStraight` (0.10–0.17 everywhere); coordinate assignment is the standard Sugiyama mechanism for exactly this (routing/ports could also contribute — deferred, OD-9).

### A4 — Diff-stability metric + gate [new — corrected citation and form]

Sondag/Speckmann/Verbeek 2018 (verified at the author copy this round): their contribution is a **pairwise 8-sector directional relative-position measure**, normalized to [0,1]; the paper explicitly argues absolute-position change "is not sufficient to measure the stability" (their Fig. 19: trackable layout, distance-change 5.325, relative-position-change 0). v1.0 cited this paper *for* absolute |Δpos| — inverted; deleted.

```
inputs: L_old, L_new over plans P_old → P_new (minimal semantic delta)
U = addresses in both with unchanged interim content hash
    (hash = address + sorted incident E′ endpoints + parent path + collapse
     classification — computed inside S2, superseded by S7's full hash later)
metrics over U (element BOUNDING BOXES; a `moved{}` rename maps old→new address
BEFORE the U intersection, so the renamed node stays in U):
  M1_rel  = mean over all ORDERED pairs (a,b) ∈ U×U, a≠b, of
            D_rel(a,b) = ½ Σ_{k=1..8} |p^k_old(a,b) − p^k_new(a,b)|
            where the 8 sectors around a's bbox are formed by extending its four
            sides (E, NE, N, NW, W, SW, S, SE — Sondag Fig. 17) and p^k = the
            AREA FRACTION of b's bbox inside sector k (zero-area/degenerate boxes
            treated as center points: p^k ∈ {0,1}); D_rel ∈ [0,1] by construction
  M2_flip = within-column order-inversion RATE:
            (# pairs a,b sharing a column in both layouts with
              sign(ord_old(a)−ord_old(b)) ≠ sign(ord_new(a)−ord_new(b)))
            ÷ (# pairs sharing a column in both layouts)   ∈ [0,1]
            // rate, not count — raw counts are fixture-size-dependent and cannot
            // transfer between derivation and validation presets
  M3_disp = median / p95 |Δpos| — REPORTED as supplementary (Tak & Cockburn lineage),
            never gated (translation-polluted: columnX shifts globally by design)
PASS iff M1_rel and M2_flip ≤ frozen thresholds (C11: derived on the fixture triple
     for preset #1, validated on preset #2's triple; then amended into this spec)
fixture triple per preset: add-one-resource, add-one-edge, moved{}-rename
```

Empirical anchor for threshold-setting (§4): the *current* v2 engine's add-one-edge delta is 20/123 moved / 4 inversions — the new engine must beat this on M2_flip; run-twice determinism (T1) remains necessary-but-insufficient and MUST NOT be cited for R7.

### A5 — Chord-pierce + contiguity metrics [new]

```
pierce: for each E′ edge chord (center-clipped, as rendered):
  for each hull frame rect f not in ancestorFrames(source) ∪ ancestorFrames(target):
    count once per (edge, f) if the chord's interior intersects f's interior
    boundary semantics (normative): touching an edge/corner without interior
    entry does NOT count; collinear overlap along a border does NOT count;
    an endpoint ON f's border with the chord entering the interior DOES count.
contiguity: per hull h and column c: the units of h in c are contiguous in the
    column's final Y order (boolean per (h,c); violations counted) — this is R2's
    contiguity clause made measurable (and is 0 by construction if A0/A2 are correct).
```

Honest grounding: container-pierce is justified as a **faithfulness/false-membership** argument (geometry implying untrue containment), *not* by Ware/Huang/Kobourov (their stimuli were container-free — v1.0's attribution was wrong). Gate: **reported-only during M1** (a gate against a baseline produced by the code under admission is circular); the M1-exit values are frozen by amendment and become the not-regress gate **from M2 onward** (C11).

### A6 — Deterministic finalize: identity, versions, seeds [new — corrected constants]

```
stableId(role, address, ordinal?) = "tf:" + role + ":" + address (+ ":#" + ordinal)
  roles ∈ {node, frame, label, icon, edge, dup};
  ordinal = content-derived (satellite sub-address); NEVER a positional index;
  uniqueness dev-ASSERTED before convert/restore (restore silently randomizes dups)
frameId sanitization: frame-role ids pass an INJECTIVE SVG-safe encoding —
  percent-encode every char outside [A-Za-z0-9_.-] (never strip: stripping can
  collide two distinct addresses, violating R8) — because frame ids are emitted
  raw into clipPath/url(#…)
edgeId(u→v, relKind, parallelOrdinal?) = "tf:edge:" + len(u) + ":" + u + "→"
                       + len(v) + ":" + v + ":" + relKind (+ ":#" + parallelOrdinal
                       for parallel edges of the same relKind, ordinal = pinned-
                       comparator rank of the edge's distinguishing content)
  // direction-preserving (endpoint-sorting collided A→B with B→A — exactly what
  //  A3's reversal styling produces) and length-prefixed (— "__" was not
  //  prefix-free over legal Terraform identifiers)
seed = (FNV-1a(stableId) & 0x7fffffff) || 1        // nonzero clamp — RoughJS
                                                   // treats seed 0 as unseeded
version policy (OD-7): default = GENERATION scheme (a content hash is NOT a valid
  version: non-monotonic — a stale peer with a numerically larger hash wins reconcile):
  version = generation G, a monotone integer that is an INPUT to finalize
            (derived from plan metadata — state serial if present, else an app-side
             per-scene regeneration counter passed in; finalize stays a pure
             function of its inputs);
  versionNonce = FNV-1a(stableId + ":" + G)  (& 0x7fffffff, ||1)
  → every regeneration strictly exceeds every prior one: collab reconcile, the
    sum-of-versions broadcast gate, and the Firebase save gate all fire
  (rationale: v1.0's constant version=1/nonce=0 made same-cardinality regenerations
   invisible to all three — adds/removals were visible via the sum, geometry-only
   changes were not)
tombstones (the T4 no-resurrection guarantee) — OWNED BY THE APPLY LAYER, not
  finalize: at replaceAllElements time, terraformSceneApply computes
  removed = prevSceneAddresses − newAddresses (the pre-regenerate scene is in
  hand — no store needed, finalize stays pure) and appends, per removed address,
  its canonical-id element with isDeleted: true and version = G. A peer holding
  the live G−1 copy loses reconcile to the tombstone. Tombstones persist one
  generation window (S7 later refines retention via the overlay store's
  prior-address set once it exists — M3).
no Date.now / updated timestamps / Math.random anywhere (C3′)
coverage: BOTH skeleton-conversion call sites — terraformPipelineLayoutFinalize.ts:127
  AND terraformPipelineLayoutCompound.ts:128 (the fallback path otherwise keeps the
  old randomization and T1's outcome depends on which internal path fired)
id-reference rewrite: build oldId→newId, rewrite boundElements[].id / containerId /
  frameId / start+endBinding.elementId; dev-assert no dangling refs. DISPOSITION
  REQUIRED (OD-8) vs the existing post-hoc repairTerraformEdgeBindings
  (terraformVisibility.ts:969) — integrate or replace, never run both blindly.
```

## 7. Implementation steps (corrected order; each: goal/change/test/rollback)

```
M0 (spec work — THIS DOCUMENT discharges most of it; remaining: the two spikes)
M1a (shippable checkpoint): S0a plumbing → S9 (A3) → S4 (pure gate — required
    before the OD-1 NS arm) → S0b engine loop (A0+A2 with sweeps at K=0, i.e.
    pure model order) — EXIT: renders both presets, R2/R3 structural checks
    pass, §4 baselines extended to preset #2. Visible, reviewable, revertible.
M1b: A2 sweeps ON (K=4) → SA7 (A7) → S0c finalize (A6, both call sites) → T1
    → S8 (A5, report + FREEZE baselines at exit)
    → S2 (A4, fixture triples, FREEZE thresholds)          M1 exit = T2 + T9
M2: S3 identity hardening → S5 constraint path → S6 keep-together
    → diff highlighting (terraformDiffStatus via the S2 interim hash)
M3: S7 overlays (redesigned) → collab hardening → S10 schema → ancillary port
    → routing (OD-9, needs an owner decision)
```

- **S0a — plumbing only.** `"rcll-v2"` variant + **its own layoutMode** (or amended clobber sites), UI button, all four C6′ seams, `skipLayoutCache` allowlist entry, threading + stale-cache regression tests. Engine = passthrough to v2 initially. Rollback: remove variant; genuinely zero-impact. *(Test: threading test asserts a dialog/URL-set variant reaches the engine and that a warm KV cache is bypassed.)*
- **S9 — A3.** Precedes all ranking (A1 consumes E′). Tests: T7 with the three mandatory fixtures. Rollback: none needed — without it the engine cannot ship cyclic input at all (there is deliberately no clamp fallback in this engine).
- **S0b — A0 + A2.** The forked loop (closes milestone M1a). Acceptance: R2 structural checks (non-ancestor overlap = 0, title collisions = 0, contiguity violations = 0) + R3 forwardness on both presets; A2's sweeps flag-gated so S0b lands with K=0 (pure model order) first — that IS the M1a checkpoint — and K=4 turns on in M1b while T2 thresholds are being derived. The R2 checks become a standing invariant thereafter (re-asserted on final geometry in every T9 run — see A7).
- **SA7 — A7.** Flag-gated. Acceptance: near-straight and deviation strictly better than the same engine pre-A7 AND vs the v2 baseline column of §4; T2 not regressed.
- **S0c — A6.** Both call sites; T1 (pinned env; static scan for random/Date; run-twice byte-equal); the SVG-safety unit test (frame id with quotes/space round-trips export).
- **S8 — A5.** Freeze pierce + contiguity baselines at this point by spec amendment (C11).
- **S2 — A4.** Interim hash; run fixture triples on ≥2 presets; freeze thresholds by amendment (derive/validate split per C11). **M1 exit: T2 passes + R4 battery vs §4.**
- **S3** — full identity contract incl. the OD-8 disposition, pre-restore uniqueness asserts, collab-lane test (peer with pre-regenerate scene must NOT resurrect removed elements — this is what the A6 version policy buys; T4 must include this scenario).
- **S4** — extract `isDepthFloorValid` (unchanged from v1.0 — the one step that was sound as written).
- **S5/S6** — constraint input path + keep-together, as v1.0 specified, with the seam list corrected to C6′ and contiguity semantics now meaningful (post-A2).
- **S7 — overlays, redesigned.** Store schema as v1.0 (address-keyed, member-set-independent groupIds; incorporated by reference). Timing contract: **groupings are layout INPUTS** — read from the store *before* layout runs and fed through S5, so they shape the regeneration they precede; a grouping created mid-session takes effect on the next regeneration (or an explicit re-layout action — no automatic re-layout on group creation). The post-`replaceAllElements` apply pass handles **styles and annotations only** (merged last / re-anchored at anchor bbox + offset) — it never moves geometry. Orphans: removed addresses render as tray ghosts with canonical ids. Rename via `moved{}` if present (spike), else orphan tray is primary. The reconcile-path analysis is retained only for collab (S3's test).
- **S10** — schema: copy-then-parametrize `topologyPathForCluster`/`buildHullTree` equivalents inside the engine; default schema reproduces AWS taxonomy; T8 = structural-deep-equal in the pinned env, plus existing-engine snapshot tests if any shared file was touched (D2′).

## 8. Verification (conformance)

| Test | Asserts | Method / corrections vs v1.0 |
| --- | --- | --- |
| T1 | R6/C3′/C4′ | run-twice byte-equal in pinned env; static no-random/Date scan; **covers both finalize call sites**; comparator-pin lint |
| T2 | R7 | A4 metrics on the fixture triple, **≥2 presets**, frozen thresholds (C11); deep-equal never cited for R7 |
| T3 | R8/C5′ | id uniqueness pre-restore; every ref resolves; ids stable across regeneration; SVG-safe frame ids |
| T4 | C9′ + collab | regenerate path (`replaceAllElements`): removed resource appears exactly once (tray ghost); **collab scenario: peer holding pre-regenerate scene cannot resurrect removed/stale elements** (A6 generation versions + apply-layer tombstones computed by terraformSceneApply at replace time) |
| T5 | C2/C7 | constraint relaxation reproducible; no R2/R3 violation from groups; forwarded constraints reach the engine (curlable proof API) |
| T6 | R4 | pierce + **contiguity** not regressed vs frozen baselines; boundary semantics unit-tested (touch/collinear/endpoint cases) |
| T7 | R3/C10′ | acyclic ⇒ F=∅ + strict forward; **cycle+chain fixture ⇒ \|F\|=1 with the arc pinned**; self-loop fixture; E′ consumption asserted (reversed arc participates in ordering as forward) |
| T8 | R10/D2′ | default schema structural-deep-equal; existing-engine snapshots when shared files touched |
| T9 (new) | R4 battery | **THE single normative home for metric definitions** (D9/A5 defer here): those implemented by `diagnosePipelineScene` (normative by reference): `fractionNearStraight`, `medianVerticalDeviationPx`, hub metrics (reported WITH `hubCount` — a 0.00 rate with 0 hubs is vacuous, not a win), plus crossings ÷ eligible pairs (rendered non-aggregated TFD chords sharing no endpoint) and aspect (reported; R5 width/aspect thresholds frozen at S2 under C11 like all others). **Includes the final-geometry R2 re-check (post-A7 standing invariant).** Precondition: during S0b, run the Q2 battery on preset #2 to extend §4's baseline table — "vs §4 on ≥2 presets" requires a second baseline column to exist. M1 exit gate together with T2. |
| T10 (new) | OD-10 perf budget | engine wall-clock (A3→A7 inclusive) asserted against the budget frozen at S0b: proposed ≤ 2s canonical preset, ≤ 10s all-resources, measured in the T9 harness (same run, no extra fixture). |
| Fixtures (new, mandatory) | D4/D5/A3/A6 rules | (i) banded-hull sanity: banded output structurally comparable to today's v2 provider/account rows; (ii) multi-column unit: a hull spanning ≥3 columns ordered within its parent sequence; (iii) same-layer A2: band-like hull where ≥70% of units share colSpan.min, asserting same-layer edges influence order; (iv) two disjoint SCCs: F = union of SCC-local sets; (v) generation purity: identical input at G and G+1 ⇒ byte-identical geometry, only version/versionNonce differ. |

## 9. Open decisions (OD) — options an implementing agent must not resolve silently

- **OD-1 · Rank refinement: longest-path vs NS.** *Option A:* floor only — most incremental under edits (each rank a local max), zero new code. *Option B (default):* NS refinement behind a flag via C7's pure gate — shorter edges/narrower (−8.4% width measured in-host), literature-preferred, but per-component re-optimization may move untouched ranks. **Resolve by the T2/T9 A/B; ship the passing arm as default.**
- **OD-2 · A2 sweep budget K.** Default 4 (2 down + 2 up), strict-improvement acceptance. More sweeps → better crossings, more churn risk and wall-clock. Bound: wall-clock budget in OD-10. Tune only with T2/T9 evidence.
- **OD-3 · Long-edge handling in ordering.** *Option A (default):* no dummy nodes; cross-column barycenters use size-normalized positions (§6-A2). Cheaper; known to be weaker on graphs with many column-skipping edges. *Option B:* dummy chains per skipped column (classic Sugiyama; what production engines do), giving adjacent-layer-only barycenters and enabling A7 to straighten long edges through their dummies — materially more bookkeeping (dummies must thread A0's hull scoping). **If T9's near-straight target is missed with Option A + A7, Option B is the designated next lever before any routing work.**
- **OD-4 · FAS refinement.** Per-SCC condensation (recommended, default ON) and model-order-consistent arc selection (choose the reversed arc as the one against the content-key order when deltas tie). Pure quality/diff-stability refinements — whole-graph GreedyFAS is *valid* without them; do not block M1 on them.
- **OD-5 · A7 method.** Option 1 priority/median nudge (default) vs Option 2 BK-with-erratum. Start with 1; escalate to 2 only if T9's near-straight target is missed and OD-3B is insufficient. Never hand-roll BK without the 2020 erratum.
- **OD-6 · Skyline gap-filling.** `dropY` semantics are monotone-downward (never back-fills gaps). Back-filling packs tighter but is order-sensitive (churn risk). Default: keep monotone; revisit only with T2 evidence.
- **OD-7 · Version policy.** Default = the GENERATION scheme (§6-A6: monotone G as a finalize input from plan metadata / app-side counter). REJECTED alternative: content-hash versions (non-monotonic — a stale peer with a numerically larger hash wins reconcile). If collab is descoped entirely, `version=1` becomes tolerable *for persistence only if the save gate is also changed* — not recommended.
- **OD-8 · Id-rewrite vs existing repair pass.** *Integrate:* keep `repairTerraformEdgeBindings` as the single binding-repair authority and have finalize only assign ids (less new code; keeps a post-hoc mutation pass). *Replace:* finalize does a complete, asserted rewrite and the repair pass is skipped for this engine (cleaner contract; must replicate its edge-rebinding semantics exactly). Decide during S3 with a parity test either way.
- **OD-9 · Edge routing (deferred, unowned — decide before M3).** The owner's "reads like a proper flow" ceiling likely requires orthogonal/port routing eventually (v1 RFC EXT-3; Spönemann/ELK ports). It is deliberately NOT in M1/M2: chords + A7 straightening first, measure, then decide. Any routing work MUST first update A5 (chord-pierce becomes polyline-pierce) and the deviation metric (vertical *extent* penalizes orthogonal jogs — a known bias).
- **OD-10 · Performance budget (set at S0b).** The pipeline runs on the **main thread** (`terraformLayoutWorkerClient.ts:158-160` routes pipeline to `runSequential`; worker migration is blocked by `measureText`/icon-fetch DOM deps). Proposed budget: engine (A3→A7) ≤ 2s on the canonical preset, ≤ 10s on all-resources; A5 is O(chords × frames) — acceptable; A2 sweeps bounded by K. Freeze actual numbers at S0b with a profiler run.
- **OD-11 · `moved{}` spike (unchanged from v1.0).** Is `moved{}` present in consumed input? Gates S7's rename path only; if absent, the orphan tray is the primary rename UX.

## 10. Literature (verified at source in round 5 — trust levels stated)

**Implemented by this spec:**
- **Eades, Lin, Smyth 1993**, *A fast and effective heuristic for the feedback arc set problem* — A3. Construction verified against the verbatim restatement in **Geladaris, Lionakis, Tollis, JGAA 27(8) 2023** Alg. 1 (`s2 ← u·s2 … s = s1 s2`, **no reverse**) and **Brandenburg–Hanauer 2011** §2.4. <https://doi.org/10.1016/0020-0190(93)90079-O>
- **Domrös & von Hanxleden 2024 (GD'24)**, *Diagram Control and Model Order for Sugiyama Layouts*, arXiv:2406.11393 — A2. **Use Strategy 1** (sweeps primary, model order as stable tiebreak); the paper's own evaluation rejects Strategy 2 ("cannot be the default option… produces ONO layouts"). v1.0 implemented Strategy 2 — do not regress to it. Companion: Domrös et al., *Determining Sugiyama Topology with Model Order* (LIPIcs GD 2024 — v1.0's "Domrös & Riepe" authorship label was wrong; verify against the LIPIcs page when citing).
- **Sondag, Speckmann, Verbeek 2018 (IEEE TVCG)**, *Stable Treemaps via Local Moves* — A4's **pairwise 8-sector relative-position measure** (Eq. 1–2, Fig. 17). The paper argues absolute-position deltas are "not sufficient to measure the stability" (Fig. 19) — report |Δpos| only as a supplementary stat (Tak & Cockburn lineage), never gate on it. <https://ieeexplore.ieee.org/document/8019841/>
- **Brandes & Köpf 2001** + **Brandes, Walter, Zink 2020 (erratum, arXiv:2008.01252)** + **Rüegg/Schulze GD'15 (size-aware)** — A7 Option 2. The erratum is mandatory if hand-rolling.
- **Gansner, Koutsofios, North, Vo 1993 (TSE93)** — network-simplex ranking (A1/OD-1; the in-repo kernel `computeNetworkSimplexDepths` is an exact implementation); forwardness as a consequence of layering. <https://www.graphviz.org/documentation/TSE93.pdf>
- **Sander 1996**, *Layout of Compound Directed Graphs* — global base-node ranking, derived cluster spans, border/title handling context for A0. <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>
- **Forster 2002 (GD'02)** — compound-scoped crossing reduction (A2's hull scoping). **Holten & van Wijk 2009 (CHI)** — back-edge styling (A3 rendering).

**Grounding the priorities (read with the corrected interpretations):**
- **Healy & Nikolov**, Handbook of Graph Drawing ch. 13, p. 421 — longest-path layering "performs very poorly in terms of drawing area, number of dummy vertices and edge density" (grounds OD-1's default).
- **Kobourov, Pupyrev, Saket 2014 (GD'14)** — **corrected reading (verified against the PDF):** crossings were *significant* at 40 vertices (time p<.01, accuracy p<.05) and n.s. in aggregate at 120 (large-dense accuracy still significantly hurt; the "<39% accuracy" figure belongs to a 150-vertex/density-3.5 preliminary; stimuli were undirected fdp/neato). At Terraform per-container scale, crossings DO matter — but per D9, crossing *count* is a diagnostic, not the gate, because…
- **Ware, Purchase, Colpoys, McGill 2002** — for path-tracing, continuity/path quality outranks raw counts (crossings still top-2) — and the **owner's revealed preference** (§4: prefers the highest-crossings arm for its deviation/height/containment wins) calibrates D9's metric weights. Both Round 4's "defer all readability" and a naive "minimize crossings first" would optimize the wrong number.
- **Archambault & Purchase GD'12** vs **Purchase & Samra 2008 / Saffrey & Purchase 2008** — the mental-map literature is split-to-null; diff-stability's value here comes from the **product cadence** (regenerate-per-PR diffs must be reviewable), not from claimed cognitive universals. Hence: constraint, not objective.

**Rejected (carried from v1.0, still correct):** DynaDAG/previous-layout anchoring (path-dependent); libcola/IPSep as primary (non-deterministic); elkjs as the engine (not bit-reproducible); ML layout (no compound support, non-deterministic). **Correction to v1.0's provenance:** greedy FAS is ELK's default cycle breaker but NOT graphviz's or dagre's (both default DFS-based) — "universal production default" was an overclaim.

## 11. Traceability

| Req | Constraints | Algorithms | Steps | Tests |
| --- | --- | --- | --- | --- |
| R1 | C1′ | A1, A3 | S9, S0b | T7, T9 |
| R2 | C2, C8 | A0, A2 | S0b, S6 | structural checks in S0b, T5, T6 |
| R3 | C1′, C10′ | A3, A1 | S9 | T7 |
| R4 | C11 | A2, A7, A5 | S0b, SA7, S8 | **T9**, T6 |
| R5 | C1′ | A1 (OD-1) | S0b | T9 (aspect/width) |
| R6 | C3′, C4′ | A6 | S0c | T1 |
| R7 | C11 | A4 (+A2/A7 gated by it) | S2 | **T2** |
| R8 | C5′ | A6 | S0c, S3 | T3 |
| R9 | C9′ | — | S7 | T4 |
| R10 | — | — | S10 | T8 |
| enablers | C6′, C7 | — | S0a, S4, S5 | threading/cache tests, T5 |

## 12. Provenance & reproduction

- **This document was itself codex-reviewed twice before finalization** (contract-quality pass): 19 P1 + 6 P2 gaps were fixed in place — notably the A0/A2 single-sequence data model, A7's normative details + re-anchoring pass, the per-SCC F-composition rule, the generation-based version policy + tombstones (replacing an invalid content-hash version), injective frame-id encoding, M2_flip as a rate, the S4-before-NS ordering, and the preset-#2 baseline precondition.
- **Round-5 evidence base:** [`rcll-v2-shit-test-round5.md`](./rcll-v2-shit-test-round5.md) — findings F1–F18, per-algorithm/per-step verdicts, refute-panel results, and the codex review of the report itself. Line anchors in this spec were re-verified 2026-07-04.
- **Probes (uncommitted; keep or promote to fixtures during S2/T9):** `terraformPipelineChurnProbe.test.ts` (diff-stability baselines), `terraformPipelineQ2Audit.test.ts` (7-arm readability battery — extend to arm the new engine and a second preset).
- **Prior docs:** v1.0 spec (superseded), [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md), [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) (rounds 1–4), v1 RFC [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) (priority lattice §5, readability catalog §23, DEC-5 dummy nodes).
- **Known incidental bugs to fix independently of this spec** (they contaminate measurements): prep-cache fingerprint collision (`terraformImportPrepCache.ts:56-58`), invalid sibling-edge comparator (`…CompoundSiblingEdges.ts:131-134`), `randomInteger` zero-seed (`packages/common/src/random.ts:9`), the silent `shorten`→`compact` guard demotion UX, v2-full+ancillary collision. **Decision (eng review D10): fixed NOW as a standalone PR before M1 work begins.**

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | (office-hours product review ran in round 5 instead) |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | CLEAR | 19 P1 + 6 P2 contract gaps, all folded pre-review (§12) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 9 issues (4 architecture, 2 quality, 7 test gaps incl. 1 critical), all folded |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (engine spec; visual gates live in T9) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CODEX:** two pre-review passes converged after 25 fixes; no open codex findings remain.
**CROSS-MODEL:** codex (contract quality) and the Fable-5 eng review (architecture/tests) found disjoint defect classes; zero contradictory recommendations — all folded.
**VERDICT:** ENG CLEARED — ready to implement (M0 spec work is discharged by this document; first code = the D10 bug-fix PR, then S0a).

NO UNRESOLVED DECISIONS
