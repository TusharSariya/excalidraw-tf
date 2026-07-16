# RCLL v2 / Strata — shit-test round 9 (packed-hull crossing objective)

**Date:** 2026-07-12 · **Status:** Review / Evidence-only — dispositions belong to a future spec amendment (would-be v3.3) and to the Package-C re-scope, not this report.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Review |
| Status | Evidence-only |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) (the stack under attack) |
| Sisters | [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md), [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md), [`strata-view-w6-highlight-spike-report.md`](./strata-view-w6-highlight-spike-report.md) |
| Next (agent) | Owner adjudication → packed-acceptance repair work package (Package C re-scope) + process amendments |

## Trigger

Owner screenshot on P1 (`staging-extended-localstack-v2`): the region-scoped SQS queue `aws_sqs_queue.regional_writer_west` sits in a loose-leaf frame **above** VPC `vpc-5b587bc4a0510e356`, with a long diagonal edge spanning that VPC's full height down to an RDS instance inside VPC `vpc-a0fcf7a066cd52312`. The initial cross-model diagnosis (Fable + codex, this session) called the move "equal crossings, only shorter edges — rejected on a tie." The owner challenged that framing: _the move absolutely lowers crossings once you count across several columns_, and asked whether the crossing calculation must be expanded, how hull edges fit in, and why the docs never caught it. **The owner was right — confirmed by experiment — and the prior "tie" framing was wrong in the owner's favor.**

## Methodology

Four parallel investigations, cross-verified: (1) a Fable fork audited the packed acceptance counter and ran the decisive forced-order experiment (env-gated scratch patch inside the packed branch forcing the region-hull order, two full builds via the W5 harness path — fully reverted, `git status` clean after); (2) a Fable fork ran a literature deep-dive via `bin/rag graph` + web; (3) a Fable fork audited the docs/review trail for why the blind spot survived rounds 5–8; (4) an independent OpenAI Codex agent (`gpt-5.6-sol`, effort `xhigh`, repo + rag + web) did the algorithmic deep-dive and remedy ranking. Raw codex output: session scratchpad `codex-crossing-raw.jsonl`.

## TL;DR

The Strata packed-hull ordering objective is **structurally blind to the crossing class the owner pointed at**. When a hull orders its children, every child hull is one opaque unit: its internal edges are dropped at lift (`from === to`), chord pairs sharing a lifted hull endpoint are excluded, and the trial geometry is a synthetic vertical stack that packed placement never renders. The forced-order experiment proves the consequence: the owner's proposed move reduces **true global crossings 123 → 120** and halves the SQS→RDS edge (1303 → 676 px), while the acceptance counter scored **0 for both orders** — no sweep at that hull could ever be accepted, regardless of merit; the shipped order is pure C4′ alphabetical. This is the classical _improper layered graph_ defect at hierarchy scale (no dummy chains → multi-column edges vanish from local counts), compounded by an objective/metric mismatch (the batteries measure exactly what the optimizer cannot see) and a metric gap shared by both counters (edge-over-hull-box "tunneling" counted nowhere, despite M-H naming it an exact-zero condition). Round 6 caught the defect _class_ but the remedy was narrowed to banded hulls; v3.0 codified the packed exemption without rationale, and three later reviews read it as settled law.

## Consolidated findings

### R9-F1 — The packed acceptance counter is structurally blind to the observed crossing class — **[P1] CONFIRMED-BY-EXPERIMENT**

Mechanics (all in `terraformPipelineStrataOrdering.ts`): `liftStrataEdgesToUnits` (`:82-104`) lifts E′ onto the direct child units of the ONE hull being ordered and **drops every edge whose endpoints land in the same unit** (`:92`) — a child VPC's entire internal dataflow is invisible to the parent's ordering. `trialChordCrossings` (`:230-275`) then counts proper straight-segment intersections between unit box-centre chords, **excluding any pair that shares a lifted unit endpoint** (`:254-260`). At the region hull in the screenshot: `vpc-5b5`'s internal edges never lift (dropped), and even external edges incident to `vpc-5b5` are ineligible against each other (shared endpoint). The counter therefore registers **0 crossings for both the as-built and the proposed order** — the strict-decrease acceptance (`:467`) can never fire at this hull.

**The decisive experiment** (P1, strata K=4+A7 compact, W5 options, seed 20260704; forced region-hull order `[…, vpc-5b5, SQS, DynamoDB, vpc-a0f]` vs as-built `[dynamo, s3-replica, sqs, vpc-5b5, vpc-a0f]` — the as-built order is the untouched C4′ alphabetical initial order; no sweep was ever accepted at that hull):

| Measure                                 | As-built | Forced move | Δ         |
| --------------------------------------- | -------- | ----------- | --------- |
| Global crossings (battery counter)      | **123**  | **120**     | **−3**    |
| Packed acceptance counter (what A2 saw) | 0        | 0           | 0 — blind |
| SQS→RDS centre distance                 | 1303 px  | 676 px      | −48%      |
| SQS→DynamoDB centre distance            | 535 px   | 496 px      | −7%       |
| sharpShare (<30°)                       | 0.41     | 0.41        | unchanged |

The owner's claim is confirmed and the prior session framing ("equal crossings, only length improves") is withdrawn: **true crossings improve too**, in the class the counter cannot see.

Codex's qualification (adopted): the blindness is **conditional, not universal** — a multi-column chord _is_ counted when both crossing edges survive lifting at the same hull with four distinct sibling-unit endpoints and the synthetic chords properly intersect. The defect is information loss at lift (internal-edge drop + shared-endpoint exclusion) plus proxy geometry, not "multi-column edges are never counted."

### R9-F2 — The trial geometry is never rendered — **[P1] CONFIRMED**

The acceptance evaluates candidates on a **synthetic full vertical stack** (cumulative y over all units, `terraformPipelineStrataOrdering.ts:220`, `:240-244`) — but packed hulls are actually placed by a 2-D **skyline** (`dropY`, `terraformPipelineStrataPlacement.ts:73`, `:273-281`) where units can sit side-by-side. The counter can both miss and invent crossings relative to the geometry that ships. Chord endpoints anchor at whole-unit box centres under the fake stack — the SQS→RDS chord anchors at `vpc-a0f`'s centre, not the RDS's true skyline position.

### R9-F3 — Objective/metric mismatch: the batteries measure what the optimizer cannot see — **[P1] CONFIRMED**

The battery counter (`diagnosePipelineScene`, `terraformPipelineCollisionDiagnostics.ts:410-428`; kernel `:163`) counts ALL non-aggregated TFD arrow pairs on their **real routed polylines**, globally, pair-once — including long regional arrows vs VPC-internal arrows. Four-axis divergence from the acceptance counter: endpoints (actual arrows vs lifted sibling units), geometry (final polylines vs synthetic centre chords), scope (whole scene vs one hull's quotient graph), exclusion rule (geometric coincidence vs shared lifted unit). W5's "123 crossings" headline for arm I therefore includes a crossing class the ordering stage was **structurally incapable of optimizing**. Minor kernel mismatch, same family: the local counter rejects all orientation-zero collinear/touching cases (`terraformPipelineStrataOrdering.ts:205`) while the battery kernel does not explicitly reject orientation zero after its 1 px shared-endpoint test (`terraformPipelineCollisionDiagnostics.ts:247`).

### R9-F4 — Edge-over-hull-box passage is counted by NEITHER counter — **[P1] CONFIRMED**

A chord piercing `vpc-5b5`'s rectangle is not an edge–edge crossing: the local counter ignores boxes entirely, and the battery's collision pass is rectangle–rectangle/title logic, not arrow–rectangle intersection (`terraformPipelineCollisionDiagnostics.ts:306`). The readability literature names this **edge tunneling** and treats it as a first-class quality defect distinct from crossings (Evaluating Readability of Force-Directed Layouts, arXiv:1808.00703, rag `arxiv-1808-00703v2`; Sprawlter, Liu et al. 2020). It is also an **implementation gap against the adopted M-H definition**, which names "arrow crossing an unrelated card interior" as an exact-zero structural condition ([`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md) M-H row) — no counter enforces it for hull/card interiors today.

### R9-F5 — Literature grounding: the classical improper-layered-graph defect at hierarchy scale — **[P2]**

- The Sugiyama framework's answer to multi-column edges is properization: dummy-vertex chains (or Eiglsperger/Siebenhaller/Kaufmann's sparse normalization, equivalent crossings in `O((V+E) log E)`) so crossing reduction sees a long edge in every column it traverses. Förster's compound decomposition — each base-edge crossing attributable to a unique hierarchy node, minimized via weighted child-order graphs — **requires proper layered clustered graphs** (Förster GD2002, pp. 278–283, rag `forster-compound-crossing-gd2002`). Our unrouted point-to-point chords violate the precondition, so the per-hull LCA count undercounts by construction.
- Sander 1996 subdivides edges at subgraph boundaries and assigns long-edge dummies into the nesting tree (TR A/03/96, rag `sander-compound-directed-graphs`). ELK's default bottom-up hierarchy handling has **precisely this defect class documented** (unremovable crossings once inner layouts are fixed), repaired by `hierarchyHandling=INCLUDE_CHILDREN` + hierarchy-aware layer sweep with hierarchical port dummies — which ELK itself flags as invasive and strategy-incompatible (ELK docs; hierarchy-aware layer sweep thesis, rtsys `alan-mt.pdf`, Fig 1.4, pp. 28–32).
- The "rejected on strict equality" failure is the known plateau problem motivating sifting (rag `forward-10-1007-3-540-46648-7-22`), windows optimization (rag `forward-10-1007-3-540-36151-0-27`), global sifting (Bachmaier et al., JGAA), and lexicographic/secondary objectives. Loose-leaf insertion at every sibling boundary = single-unit sifting under Förster-style contiguity constraints (rag `forward-10-1007-978-3-540-31843-9-22`).
- No canonical weighting exists for tunneling penalties; layered systems _prevent_ passage by construction rather than price it — any weight is an engineering choice subordinate to true crossings.

### R9-F6 — Why the docs missed it: reviewed-but-scoped-out, with a specified-but-wrong core — **[P2] docs-miss**

Provenance timeline (docs audit): **v2.0** specified the local crossings-only trial acceptance deliberately ([`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md) §A2 acceptance, `:242-243`) — while its own D9 (`:59`) rules "raw crossing count is a diagnostic, never a gate" for batteries; nobody flagged the inversion. **Round 6 caught the class** — F1: "crossings-only acceptance rejected the band-adjacency lever"; t3 even wrote that within-band endpoint position is "owned by nothing" ([`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) `:51-57`) — but the remedy wording narrowed it to "A2's **banded-level** acceptance is re-aimed" (`:57`, `:215`) because the presenting symptom of the day was cross-band extent. **v3.0 codified the exemption with no rationale** ("Packed hulls keep the crossing-decrease acceptance," [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) `:73`); **v3.1 re-affirmed it twice** (`:40`, `:42`); **SDEC-40** implemented it faithfully (engineering scrutiny went into making the packed gate _function_, never into whether it was the right objective). **W5** surfaced the aggregate signature (uniform tll stretch) and attributed it to "banded verticality" without slicing by LCA hull policy — the packed contribution stayed invisible inside the total. Rounds 7 and 8 attacked statistics, enforcement, and task evidence; neither asked whether the optimizer's acceptance statistic and the battery statistics are the same measure. [`rcll-loose-leaf-edge-length-research.md`](./rcll-loose-leaf-edge-length-research.md) was the near-miss: it prescribed edge-length objectives for the intra-column top-anchor problem and silently scoped out the inter-hull sibling case. Classification: **primarily reviewed-but-scoped-out, with a specified-but-wrong component** — the words were in the spec, the rationale was not, so later reviews read settled law where there was an open question.

## Consolidated remedy (cross-model adjudicated; evidence, not law)

**Primary (codex's recommendation, adopted): whole-layout candidate scoring at the A2/A0 boundary.**

1. Keep banded ordering and its round-6 acceptance untouched.
2. For packed hulls, generate the candidate **set** `{initial, sweep1…sweepK}` without per-sweep strict rejection — codex's structural point: today a rejected _neutral_ sweep becomes the parent of no later sweep (`terraformPipelineStrataOrdering.ts:474`), so acceptance-chaining kills improvements reachable only through neutral intermediates. Score candidates, don't chain acceptances.
3. Trial-place each candidate with the **real A0 skyline** (not the synthetic stack).
4. Score on **leaf-level E′ geometry** (never lifted unit-centre chords), excluding pairs only on shared actual leaf endpoints.
5. Lexicographic, non-compensatory objective: **(global edge-pair crossings, unrelated edge–box penetrations, total integer L1 edge length)**; earliest candidate wins exact ties (determinism: fixed candidate order, integer centres, no RNG).
6. Post-A7 lexicographic **never-worse guard** on the same triple (A7 keeps its order-preserving contract; the guard protects ordering↔final-geometry alignment).
7. Keep lifted edges for barycenter candidate _generation_ only — stop treating them as sufficient crossing _evidence_.

Cost at K=4: ~`O(K·(N + E² + E·B))` — ≈180k segment-pair tests at E=300, comparable to the existing per-hull `O(m²)` work. **Fallback** if profiling objects: the in-loop surrogate — hull-piercing term (chords through a non-endpoint sibling hull's box, weighted by that hull's internal E′ edge count) + real-skyline trial + lexicographic length tiebreak; the experiment hull had 5 units × 4 candidates, trivially cheap. Not recommended now: full dummy-chain properization (architecturally right destination, too invasive — high regression risk to the proven banded wins) and ELK-style INCLUDE_CHILDREN global sweeps (ELK marks its own version invasive; hostile to the deterministic freeze). Ship default-off behind a `strata*` toggle; **the sceneContext literal in `layoutTerraformFromSources` must forward the new option** (standing threading rule). rankSeparate stays off per v3.2 §5/§6; the scorer must consume effective ranks/x-extents if it is ever combined.

## Gate plan (per v3.2, for the repair work package)

- **Structural exact-zero:** R2 non-ancestor overlaps, title collisions, contiguity; determinism/A4 thresholds; **new unrelated arrow–card/hull penetration counter completing M-H** (R9-F4).
- **Primary:** M-RT p50 no-regress; M-RT p90 improvement on ≥2 presets.
- **Components:** M-TCR (global crossings) exact no-regress everywhere and **strict improvement on P1**; M-CRP p90, M-CON p90, M-TLL p50 no-regress; M-ANG must improve (this is an OD-15-class geometry milestone); M-EXT within the existing waiver discipline.
- **Reports (cannot rescue a failure):** bands skipped, heights, area/aspect, M-GEO/M-TRAP/M-BND, penetration amounts alongside the hard count.
- **Register schema extension required first:** `terraformPipelineStrataGateRegister.ts` currently only admits `extentSliceB`/`rtHat`/`con`/`cr`/`tll` cells (`:68`) — no M-H, M-ANG, or M-TCR claims exist. Extend the register (SHA-pinned recompute, FAIL-WAIVED-never-PASS) before acceptance; a report-only table is not enough. Frozen: B=1000, `mulberry32(20260704)`, statistic-specific p50/p90, p90 floor n≥31.

## Process amendments proposed (for the next spec amendment)

1. **Objective/metric consistency register:** every internal acceptance objective (hull-policy × stage) must be mapped to the battery statistic it is supposed to move; an unregistered proxy objective is a spec defect — the same discipline v3.2 imposed on gate waivers.
2. **Class-vs-remedy delta rule:** when a review names a defect class and the adopted fix covers a subset, the uncovered remainder becomes an explicit OD at amendment time — never narrowed silently in the fix wording (v3.0 §3.1 needed one sentence of rationale and a revisit condition).
3. **Corollary check:** slice battery tll/extent statistics by LCA hull policy (the slice machinery exists since v3.0 §2) — W5's uniform stretch would have shown a packed-LCA line item pointing at region-level sibling order.

## Cross-model agreement table

| Claim | Fable forks | Codex xhigh | Adjudication |
| --- | --- | --- | --- |
| Packed counter blind to the observed class | CONFIRMED by forced-order experiment (123→120 vs 0→0) | CONFIRMED from code, same mechanics | Agreed; experiment is the evidence |
| "Multi-column edges are invisible" (universal) | Implied | **Qualified**: conditional on lift-collapse/shared-endpoint/proxy-geometry — a 4-distinct-unit chord pair IS counted | Codex's qualification adopted (R9-F1) |
| Trial stack ≠ real skyline | CONFIRMED | CONFIRMED (can also _invent_ crossings) | Agreed |
| Tunneling counted nowhere + M-H gap | CONFIRMED (neither counter) | CONFIRMED, named the M-H implementation gap | Agreed (R9-F4) |
| Remedy home = ordering stage, not A7/compaction | Literature memo: ordering owns relative order | A2 generation + A0 trial + model-level scorer; A7 guard only | Agreed; codex's A2/A0-boundary formulation adopted |
| Remedy form | In-loop surrogate (piercing term + skyline trial + length tiebreak) | Whole-layout candidate-set scoring, leaf-level geometry | Codex primary (higher fidelity, kills acceptance-chaining defect); Fable surrogate kept as perf fallback |
| Fix v2 too? | Leave v2 as baseline | Equivalent change possible in `layoutHullBlock` | Leave v2 untouched (it is the external reference for every battery) |

## Recommendation (evidence, not law)

1. Make the packed-acceptance repair the **first Package-C work item**, displacing the angle-aware separation probe — this defect is experiment-confirmed on the owner's own complaint, aims at the same measured residuals (tll, M-TCR), and is cheaper than band-geometry surgery.
2. Extend the gate register schema (M-TCR/M-ANG/M-H cells) before any acceptance claim.
3. Add the arrow–card/hull penetration counter to the diagnostics regardless of the ordering fix (completes M-H; R9-F4 stands on its own).
4. Adopt the two process rules + the LCA-policy slicing corollary in the next amendment so this class cannot recur silently.
