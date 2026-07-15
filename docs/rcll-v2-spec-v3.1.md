# RCLL v2 — Layout Engine Specification, revision 3.1 (normative amendments)

| Field | Value |
| --- | --- |
| Status | **Normative — source of truth together with [`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md) (base) and [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) (first amendment layer).** Precedence on conflict: **v3.1 > v3.0 > v2.0.** Every section not amended here is incorporated by reference unchanged (C11 mechanism, third exercise). |
| Version | 3.1 (2026-07-04) |
| Produced by | **Round 7** — the pre-implementation review the owner ordered before any code lands: (1) a full lineage audit (3 auditors over the v1.0 spec, round-5 report, rounds 1–4 docs incl. the pivot memo and architecture assessment, the round-6 traceability matrix vs the v1 RFC, and the auxiliary rcll docs); (2) an adversarial attack on **v3.0's own never-attacked machinery** (the round-6-authored §2 metric family, §3 A2 acceptance, §8.1 A4 additions, §8.4 failure contract) via two opus literature lanes (corpus deep-reads + web) and one code-implementability lane; (3) a fable refute panel adjudicating the combined amendment set. Lineage-audit verdict: **no CRITICAL loss — v2.0+v3.0 is safe to build from**; the residue (dispositions, rationale, open questions) and the round-7 defects land here. |
| Owner decisions folded | **Q0-TASK closed: the primary reader task is IMPACT TRACING** ("if X changes, what breaks downstream" — left-to-right dependency following). View name **Strata** (`view=strata`); build scope M1 (D10 → S0a → M1a → M1b) with owner visual validation at every milestone. |
| What did NOT change | The build order, A0/A3/A6/A7 algorithm text (except the A6 restorations in §6), all v3.0 amendments not listed in §10, D1′–D8″, C1′–C11 (except the §8 freeze-list additions), R1–R10, T1–T8, OD-1–OD-13. The v3.0 tombstone amendment survived code verification unchanged (`getUpdatedTimestamp` importable from `@excalidraw/common`, no layer violation; 24h window confirmed). |

## Document graph

| Relation | Link |
| --- | --- |
| Role | Normative-amendment |
| Status | Current top amendment — precedence v3.1 > v3.0 > v2.0 |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) |
| Children | [`strata-view-decision-log.md`](./strata-view-decision-log.md); [`strata-view-implementation-flow.md`](./strata-view-implementation-flow.md); [`strata-baselines/README.md`](./strata-baselines/README.md); [`terraform-pipeline-rcll-v2-allresources-rca.md`](./terraform-pipeline-rcll-v2-allresources-rca.md) |
| Sisters | — |
| Next (agent) | Implement: §0 then §1–§8; status/as-built → decision-log; freezes → strata-baselines. |

## 0. What changed since v3.0 and why (read this first)

Round 7 attacked what round 6 wrote — the same discipline rounds 5 and 6 applied to their predecessors. Verdict: **AMEND, then GO.** Nothing was refuted at the architecture level; every defect is an objective mis-aim, an executability pin, or a lost disposition:

1. **A2's banded acceptance objective was misaligned with its own gate — twice over.** v3.0 §3 scored candidates by Σ vertical extent over **box-center chords**; the shipping gate measures **leaf-level p90**. The center proxy's error is bounded by half the endpoint band heights — unbounded in the tall-band regime that IS the owner complaint — and a Σ-objective can be strictly improved while p90 regresses (constructed counterexample). Separately, the K=4 barycenter sweeps are **height-blind** while the selector was height-weighted, so the height-optimal order need not be in the candidate pool at all; and float-sum ties could break "ties→initial" by 1 ULP. The literature check confirmed extent-as-ordering-objective is **unprecedented** (every ordering-phase method in the corpus gates on crossings — Forster 2004 deep-read included) though defensible as MinLA. **Fix (§2): the acceptance objective becomes height-weighted bands-skipped — the exact t2 term of F1's decomposition, integer, computed from the candidate sequence alone.**
2. **The §2/§8.1 metric definitions were not executable as written.** Two literal build-breakers (÷0 on same-rank edges in rank-span-normalized deviation; NaN in M5's single-cluster ARI case), two uninterpretable-number defects (area utilization > 1 from hierarchical double-counting; M4's <3-column fallback manufacturing false positives on exactly the sparse preset), two undefined-on-slice-B holes (bands-skipped undefined at LCA=root and for nested bands; a missing band-row invariant), one noise gate (p90 "strictly better" over ~20 edges certifies noise), and one citation error (M5 is ARI-stability, **not** Meidiana-CCQ — CCQ _rewards_ proportional change, the opposite gating direction). **All pinned in §3–§4.**
3. **A root-policy seam of the same species as seam #6.** §3.1's acceptance switch keyed on `policy == "banded"` while §2 classifies the **root** as slice-B by special case — a multi-provider root would order providers under the wrong acceptance, masked today by single-provider presets. **Fix (§2.4): root policy pinned `banded` in the M1 schema copy.**
4. **Code-implementability gaps.** The §8.4 fallback as written would silently re-pay the ~20s skeleton-build on every failure (the v2 builder takes no `prep`); hull **policy has no data representation anywhere** (the "no role-name lists" framing is an R10 target-state, not an M1 instruction); T9 harness pickup is hand-edited, not mechanical. **Fixed in §5.**
5. **Lineage residue.** The one hard defect in round 6's own traceability matrix: **DEC-12/rankSeparate (the −42% height lever) was mis-mapped to OD-1 NS** — mechanisms the v1 RFC says cannot compose — leaving the height lever with no disposition (→ OD-14). Also recovered: the silently dropped subnet-de-band height lever (→ OD-15), the shared-prep wall-clock blind spot in OD-10 (→ T10 addition), the `groupId` line lost from A6, the S7 schema trap pointer, and dispositions for every open question rounds 1–5 left dangling (§7).

## 1. §3 A2 acceptance machinery — replaced (supersedes v3.0 §3.1, §3.3, §3.4; §3.2, §3.5–3.7 unchanged)

1. **Acceptance objective, banded hulls (replaces v3.0 §3.1).** For a candidate sequence over units(h) of a banded hull h, the score is the **weighted bands-skipped cost**:

   > cost(seq) = Σ over lifted E′ edges e=(uᵢ,uⱼ), i<j in seq, of Σ\_{k=i+1}^{j−1} ( height(unit_k) + PIPELINE_LANE_GAP_Y )

   — the exact **t2 term** of F1's cross-band decomposition (bands-skipped × the heights actually skipped), in **integer pixels** (heights are integer px under the frozen constants), computed from **the candidate sequence + the already-fixed child unit heights alone** (prefix sums; A0 post-order step 1 has laid children out before h orders them — no chord geometry, no trial placement needed for the objective). Accept the best-scoring candidate; on equal cost, the **deterministic crossings count of a trial placement is the tiebreak** (strictly fewer wins); remaining ties → the **earliest candidate** (initial/model order wins — the diff-stability default). Packed hulls keep the v2.0 crossings-decrease acceptance unchanged. _Why not the alternatives (refute-panel adjudicated): pure bands-skipped count anti-optimizes extent under heterogeneous heights (skipping one 1000px band scores better than skipping two 50px bands — 10× worse in px); leaf-level p90 as the objective is an order statistic over ~15–25 edges that ties on most permutations → ties→initial → A2 freezes at model order, the ONO failure A2 exists to escape. Height-weighted bands-skipped is integer (exact ties, C4′-clean), needs no geometry, and targets the term A2 actually controls; the §2 slice-B gates remain the backstop for the Σ-vs-tail residual._

2. **Chord attachment geometry (rescopes v3.0 §3.3).** Unit-box-center chords are retained **only** for the crossings **tiebreak** trial (and packed-hull acceptance) — the banded objective above uses no chords. _(The refute panel caught this: retiring centers entirely, as lane A first proposed, would have left the tiebreak with no geometry.)_
3. **Candidate set (replaces v3.0 §3.4).** best-of becomes **{initial, sweep results 1..K, height-aware greedy seed}** in that pinned order, earliest-wins on ties. The **height-aware greedy seed** exists because the barycenter sweeps are height-blind while the objective is height-weighted (generator/selector mismatch): insert units one at a time in pinned key order, each at the position of the partial sequence minimizing the §1.1 cost — deterministic, O(n² · degree) on hulls whose unit counts are single-digit-to-tens. Score all K+2 candidates with the §1.1 objective.
4. **Root policy (new, closes the seam).** The M1 hardcoded schema copy **pins `root.policy = "banded"`** (matching the as-built provider stacking). The acceptance switch keys on **policy alone** — no "or the root" special case in the algorithm (the special case lives only in §2's slice definition, where it is now redundant but harmless). S10's configurable schemas MUST state root policy explicitly. **Fixture (mandatory): a ≥2-provider root asserting the banded acceptance path fires at root** — the same single-provider mask that hid seam #6 hides this one.
5. **Determinism note.** The cost reduction iterates lifted edges in the pinned A2 key order; all arithmetic is integer; candidate comparison is exact. C4′'s comparator-pinning covers this reduction.

## 2. §2 metric family — pins (amends v3.0 §2; the table's gate/report roles are unchanged except as stated)

1. **bands-skipped, defined for all slice-B edges (replaces the v3.0 row's definition).** For an edge whose endpoints' LCA is hull h (h banded or root): **project each endpoint to h's immediate child on that endpoint's ancestor path**; bands-skipped(e) = count of h's children **strictly between** the two projected children in **h's final Y order** (child frames sorted by y). Adjacent ⇒ 0. Well-defined for LCA = root (children = provider bands) and nested banded hulls (LCA = provider ⇒ project to account-bands). **In-trial equivalence (used by §1):** at a banded hull the sequence IS the Y order, so in-trial bands-skipped ≡ index distance − 1 — exact, not a proxy. **Dissolved bands (deBand comparison arms only; Strata M1 ships no deBand):** a dissolved level has no frame — band identity comes from the element's `customData.terraformTopologyPath`, band Y-order from the median y of the band's members (deterministic).
2. **Band-row invariant (new; S0b assert).** Every child of a `banded` hull occupies exactly one band-row; a **bare-leaf child is its own singleton band**. Consequences: a lifted edge at a banded LCA always joins **distinct** band-rows (so "same band ⇒ not slice B" is a theorem — any same-band edge has a strictly deeper, packed LCA ⇒ slice A); §1's "all lifted edges at a banded hull are slice-B" is exact. An endpoint that is itself a hull takes its **parent hull** for LCA purposes. (Population stays "non-aggregated," so collapsed-module aggregate arrows remain out of scope.)
3. **rank-span-normalized deviation (fixes ÷0).** ideal chord length = **max(COLUMN_GAP, |Δx_endpoints|)** (final horizontal endpoint separation; COLUMN_GAP per the frozen constants). Same-rank edges (|Δx| = 0) floor to COLUMN_GAP — a pure same-rank vertical jog correctly scores high — and their count is reported separately. Report-only (A+B), never gated (unchanged).
4. **area utilization (fixes >1).** = Σ areas of **leaf elements only** (terraform resource node cards; frames/hulls/bands and all pure containers excluded) ÷ content bbox area — a true packing density ∈ [0,1] (leaves are mutually non-ancestor ⇒ non-overlapping by R2). Report-only during M1 (unchanged).
5. **slice-B extent gate operationalization (fixes the noise gate).** "Strictly better than the frozen v2-substrate baseline" is operationalized as: **the paired per-edge improvement's bootstrap CI excludes 0** (B ≥ 1000, **pinned seed and pinned resampling procedure** — C4′ spirit; the repo's standing bootstrap-CI gate practice). **Pairing key = canonical terraform edge address** (true direction + relKind) — engine-invariant (A6 element ids differ across engines; A3-reversed arcs draw true-direction, so the address key is stable); unmatched addresses are **excluded and counted** (a high unmatched count voids the comparison). **p90 is gated only when slice-B n ≥ N_B,min** (frozen at S0b via bootstrap stability, target ≈30); below it, gate p50 and report p90. CI-gating **complements** C11: C11 freezes the baseline; the CI is the comparison operator against it.
6. **Slice classification, M1 implementation route (new — the "no role-name lists" clause is rescoped).** v3.0 §2's "policy-based … without role-name lists" is the **R10 target state**, not an M1 instruction: hull policy has **no data representation in the codebase today**. M1 implementation = a **role→policy map that mirrors the engine's own hardcoded schema copy** (same source of truth as A0's M1 copy; roles from the topology path — the hull tree is reconstructable read-only from `customData.terraformTopologyPath` on frames). Schema-stamped policy (`terraformHullPolicy` in frame customData) arrives **with S10**, at which point the diagnostics read the stamp and the role map is deleted. **T9/Q2 harness note:** `terraformPipelineQ2Audit.test.ts` consumes the diagnostics object by **named field access** and echoes object-shaped meta keys by **explicit exception lines** — new slice-A/B fields and `rcllV2Degraded` are hand-added, not automatic (state this in the work package; do not assume mechanical pickup).

## 3. §8.1 A4 additions — executability pins (amends v3.0 §8.1)

1. **M4_disp95.** `shift(c)` = **componentwise** median (Δx, Δy) over U-nodes with old column c, used when **|c ∩ U| ≥ 3**; for 1–2-member columns use the **±1 rank-band neighborhood median** (adjacent columns' X-translations differ only by one local width delta — columnX is a prefix sum — so smearing is bounded and strictly better than the global fallback); only if that too has <3, the global median. **Report the coverage ratio** (fraction of U with a same-column ≥3 estimate). **Low coverage (< threshold frozen at S0b) ⇒ M4 is INCONCLUSIVE — the milestone exit requires an explicit owner acknowledgment**, never a silent pass and never a silent report-only downgrade. Gate only when |U| ≥ N*min. In-spec honesty: M4 removes \_per-column rigid translation* (the columnX confound) — Sondag's full relative-position invariant remains M1_rel's job.
2. **M5_hull.** = 1 − ARI(P*old, P_new); P_x = partition of U by each node's parent-hull identity **computed independently within layout x** (root counts as a hull). **sklearn `adjusted_rand_score` conventions: identical single-cluster (or all-singleton) partitions ⇒ ARI ≡ 1 ⇒ M5 = 0.** ARI is label-permutation-invariant, so **no cross-regeneration hull-address mapping is required or performed** (v3.0's mapping clause is deleted — it invited a hunt for a label ARI never needs). Vacuous pass (report-only) when |U| < N_min or U spans < 2 distinct hulls in both layouts. Range is **[0, 1.5]** (ARI can go negative at small n); clamp for display only, never before threshold comparison. **Citation corrected:** ARI-as-partition-similarity for regeneration stability (Hubert–Arabie 1985; the dynamic-maps Rand-stability precedent `jgaa-2603`; Meidiana 2019 CQ `arxiv-1908-07792v1` as the node-link ARI precedent) — **not** Meidiana 2020 CCQ (`arxiv-2008-07764v2`), which is a \_change-faithfulness ratio* that rewards proportional change — the opposite gating direction. (The doc_id itself is valid; the construction it names was wrong.)

## 4. §9 M1 exit — one row added (amends v3.0 §9)

The arm-E side-by-side table gains a **crossings-per-eligible-pair** row. It is an **owner-adjudicated row of the binding verdict**, never an automatic gate — D9/§2's "crossings are a diagnostic, never a gate" is uncontradicted; the owner's verdict is already the gate, and this row is the honest home for the one statistic the fooling literature found robust. Zero extra compute (already computed for §1's tiebreak).

## 5. §8.4 failure contract + implementation pins (amends v3.0 §8.4)

1. **The fallback call passes `prep`.** The v2 substrate builder (`buildTerraformPipelineV2ExcalidrawScene`) gains an **optional `options?.prep ?? preparePipelineLayout(...)`** parameter (mirroring the compound builder's existing pattern) so the engine's failure path reuses the prep it already computed — otherwise every failure silently re-pays the ~20s skeleton build (the measured dominant cost). This touches a **shared file**: D2′ applies — default behavior unchanged, existing-engine snapshots must hold.
2. **`rcllV2Degraded` surfacing, honest scope.** Surfaced in **scene meta + asserted absent by T9** (as v3.0 stated). Today's `rcllDegraded` is read **only by tests** — a demo-UI badge is an **explicit small S0a task**, not assumed-existing behavior.

## 6. A6 / S7 restorations (amends v2.0 §6-A6 and §7-S7)

1. **A6 `groupId` restored** (lost between v1.0 and v2.0; survived only as S7 prose): `groupId(stableGroupKey) = "tfg:" + stableGroupKey` — content-stable, **member-set-independent**; the A6 roles list gains `group`. **The A6 id-reference rewrite list is extended with `groupIds`** (each element's groupIds array mapped oldId→newId; dev-assert no dangling group refs) — restoring the derivation line without the rewrite entry would leave dangling refs.
2. **S7 overlay-store schema restated inline** (kills the trap pointer into v1.0's S7 paragraph, which fuses this valid schema with the **refuted** reconcile-based orphan mechanics — v2.0 §7-S7's corrected mechanics remain the only normative mechanics): app-level `TerraformOverlayStore` (excalidraw-app/data), keyed by **address**: `{ schemaVersion; derivationVersion; groupings: [{id, memberAddresses, label?}]; annotations: [{id, anchorAddress, anchorRole?, offset, skeleton}]; styles: Record<address, Partial<StyleProps>>; priorHashes: Record<address, string> }`, with `groupId` content-stable and member-set-independent (`"tfg:"+key`, §6.1). Likewise S5's constraint type inline: `PipelineGroupConstraint = { groupId; kind: "keep-together"|"align"|"same-band"|"order-after"; members: address[]; priority; axis? }`.
3. **S5/S6 preconditions corrected:** v1.0's "Precondition: S1, S4" → **"Precondition: S0b (A2 in place), S4"** (S1 dissolved into A2/S0b in v2.0).

## 7. New ODs and dispositions (lineage-audit residue; appends to v2.0 §9 / v3.0 §8)

- **OD-14 · Height lever (DEC-12 class).** v1's `rankSeparate` (whole-model hull-separation ranking; measured **−42% height**, default OFF; **cannot compose with NS** — RFC DI-NS-4, rankSeparate wins) has **no v2 equivalent and is NOT assumed subsumed by A0's packing**. If M1's height/aspect reporting misses the owner's bar, a rankSeparate-class lever is the designated post-M1 A/B. _(Round-6 matrix row 3 mis-mapped DEC-12 to OD-1 NS — corrected in the report.)_
- **OD-15 · Subnet de-band port.** v1's `deBandLevel` (membership-as-annotation; frame suppression per level) is a **shipped, pivot-memo-named height keeper** silently dropped by v2.0/v3.0. Disposition: **port decision** (the lever exists in the v1 engine — this is a port, not new design), deferred M3-adjacent alongside ancillary; the battery's deBand comparison arms keep it visible; a frame-suppression-per-level report metric joins T9 when/if ported.
- **T10 addition (closes the OD-10 scope hole + answers Q1's residue).** T10 additionally **reports the shared-prep wall-clock** (`preparePipelineLayout`) beside the engine budget: the all-resources RCA ([`terraform-pipeline-rcll-v2-allresources-rca.md`](./terraform-pipeline-rcll-v2-allresources-rca.md)) shows two O(N²) prep sub-spans dominate real cost — an engine can pass OD-10 while the felt cost is unchanged; the report keeps that visible. OD-10's engine budget itself is unchanged.
- **Q5-TCO (the pivot's original motivation).** Strata is the **fourth** pipeline engine; the sprawl cost is acknowledged, not solved. **The engine-endgame decision (does Strata retire rcll/compound/classic, and when) is owned at M2 planning** — a decision-log entry with a named owner, not a platitude.
- **Q6-FIDELITY.** Extraction fidelity stays out of scope **with the explicit acknowledgment** that round 3 rated it potentially backlog-reordering; re-raise at M2 planning alongside the hub/extraction A/B.
- **Q0-TASK — closed.** Primary reader task = **impact tracing** (owner, 2026-07-04). Gate-weight rationale, the Q7-AXIS hand-label design, and the arm-E verdict rubric all read against this task.
- **SCC-quotienting supersession (one line the pivot diff needs).** The pivot's "keep bidirectional hull SCCs co-axial / SCC quotienting" is **superseded** by global leaf ranking + derived hull spans (hull co-axiality is emergent from colSpans; leaf-level cycles are A3's job). Not a loss — a replacement, now stated.
- **Shipped-v2 cyclic clamp: won't-fix, superseded.** The +77% width blowout on cyclic input remains in the shipped v2 engine; the new engine removes the failure mode structurally (A3-before-A1). Accepted, recorded.
- **Round-5 F17 orphans, dispositioned:** variant-switch UX and LOD/minimap/hover interaction → **S0a UI acceptance notes** (switching to/from Strata must reset per-view options sanely — the `handleSetView` pattern — and the view-agnostic LOD/minimap settings are verified against Strata output in the V0 battery); **incremental layout → REJECTED with rationale** (stateless full-regenerate IS the design; C-IGDP's constrained-incremental formalization is the reference for what was rejected and why — path-dependence); **saved-scene migration → S7/M3** (address-keyed overlay re-anchoring is the migration story; pre-Strata scenes re-import).
- **X1 rationale restated (routing order).** A7-before-routing stands on round-3's X1: ~85% of edges are adjacent-column; routing over mis-placed boxes redraws diagonals — placement first, then routing (OD-9, plan-of-record, owner decision before M2).

## 8. C11 freeze-list additions

Frozen at S0b **with** the slice baselines, by amendment, before any gated code lands: **N_min** (A4 gating floor), **N_B,min** (slice-B p90 gating floor, target ≈30), **M4 coverage floor**, **bootstrap seed + resampling procedure**, **A2 candidate order** ({initial, sweeps 1..K, greedy seed}). The v3.0 geometry-constant freeze (FRAME_PAD 28 / LANE_GAP_Y 96 / TITLE 56 / NEAR_STRAIGHT 24 / COLUMN_GAP) is unchanged.

## 9. Corrections applied to companion documents

- [`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) §5 matrix, row 3: the DEC-12 → "OD-1-gated NS" cell corrected to "no v2 mechanism — see v3.1 OD-14" (edit applied with a round-7 correction note).
- [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) front matter: "C1′/C2′/C4′/C5′" → C2 is unprimed in v2.0 (label typo; edit applied).
- v2.0 §6-A3 "facts an implementer must not re-litigate" gains (by this amendment, no edit to v2.0): ELS93 under-specifies tie handling and the comparator-least tie **changes |F|**, not just determinism — T7's arc-pinning covers it; do not "fix" ties without re-pinning T7.

## 10. Superseded-anchor index

| Anchor | Status in v3.1 |
| --- | --- |
| v3.0 §3.1 (banded acceptance = Σ slice-B extent), §3.3 (chord attachment), §3.4 (best-of-{initial,K}) | replaced by §1 (weighted bands-skipped; centers tiebreak-only; K+2 candidates) |
| v3.0 §2 bands-skipped definition; rank-span row; area-utilization row; slice-B gate "strictly better" | replaced/pinned by §2 |
| v3.0 §8.1 M4/M5 definitions | pinned by §3 (incl. the CCQ→ARI citation correction) |
| v3.0 §8.4 fallback call | amended by §5 (prep param; UI-badge scope) |
| v2.0 §6-A6 (groupId, id-rewrite list), §7-S7 pointer, S5/S6 preconditions | restored/replaced by §6 |
| v2.0 §9 OD list | +OD-14, OD-15 (§7) |
| v3.0 §9 arm-E table | +crossings row (§4) |

## 11. Provenance

Round-7 method: 3 lineage auditors (opus ×2, sonnet ×1 — v1.0+round-5 disposition audit; rounds 1–4 compression audit; round-6 matrix spot-check + aux docs + anchor re-verification, all anchors exact incl. the 208px arithmetic) · 3 attack lanes on v3.0's new machinery (opus ×2 with `bin/rag` corpus deep-reads — Forster 04, Meidiana 19/20, Sondag 18, jgaa-2603, gdMetriX — plus web; sonnet code-implementability lane) · 1 fable refute panel adjudicating the combined set (rejected pure-count and leaf-p90 acceptance variants with constructed counterexamples; caught the tiebreak-geometry defect all three lanes missed; coherence sweep clean). **Verdict: M1a GO (unchanged); M1b GO under v3.0 + these amendments.** First code remains the D10 bug-fix PR, then S0a.

NO UNRESOLVED DECISIONS

---

## 12. S0b freeze register (2026-07-04, W2 — the §8 TO-FREEZE items, frozen by this amendment BEFORE any gated code; C11)

Derivation run: WP-2d, v2 substrate, arms A (`v2 compact`) + F (`v2 full+ancillary`), presets P1 (`staging-extended-localstack-v2`) + P2 (`staging-localstack`). Populations reconcile exactly (`nA + nB + unresolved == tfdArrowCount`) in all 4 cells. Full frozen reports (all 7 arms × P1/P2/P3-multistate/cyclic, incl. per-edge bands-skipped distributions): `docs/strata-baselines/Q2_AUDIT_REPORT_{P1,P2,P3_MULTISTATE,CYCLIC}.json` — SHA-256: P1 `8dd4546c…`, P2 `8429bcc3…`, P3 `b6d9f54d…`, CYCLIC `2305c325…`. The v2 substrate stays byte-identical under D2′, so these are re-derivable; the JSONs are the canonical frozen copies.

1. **Slice-A/B baselines (headline cells).**

   | Preset | Arm | clusters | tfd | nA | nB | extent B p50/p90/mean | bandsSkipped mean (n) | stacked-band totalPx (hulls) | areaUtil |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | P1 | A (compact) | 123 | 145 | 108 | 37 | 3166 / 7098 / 3798.9 | 0.32 (37) | 32,897 (6) | 0.06 |
   | P1 | F (full+anc) | 123 | 145 | 31 | 114 | 2226 / 16309 / 4940.73 | 4.54 (114) | 140,651 (17) | 0.08 |
   | P2 | A (compact) | 70 | 69 | 65 | 4 | 1149 / 1955 / 906.29 | 0.5 (4) | 20,460 (3) | 0.07 |
   | P2 | F (full+anc) | 70 | 69 | 37 | 32 | 3219 / 9525 / 4763.59 | 6.59 (32) | 93,521 (8) | 0.08 |

   `unresolvedEdgeCount = 0` in all cells; `sameRank` normalized-deviation bucket vacuous (n=0) in all cells, reported as such.

2. **N_B,min = 30** (slice-B p90 gating floor, §2.5). Rationale (distribution-free order statistics — no per-edge extent dump exists to bootstrap directly, so the pin uses the exact argument the ≈30 target came from): nearest-rank p90 at n=30 is the 27th order statistic with 3 points above it — the minimum for a percentile-bootstrap CI on p90 to draw from more than the top 2 sample values; below that the CI is degenerate on the maximum. Gate-eligible cells for p90: P1-A (37), P1-F (114), P2-F (32). **W3 obligation:** the CI harness must report the realized CI width per gated cell (stability self-check) — a degenerate CI (upper == max) voids the p90 gate for that cell even at n ≥ 30.

3. **Slice-B p50 gating floor (new pin): nB < 10 ⇒ the cell is EXCLUDED from all slice-B gating** (report-only; milestone exit over such a cell requires explicit owner acknowledgment, INCONCLUSIVE-style per §3.1's pattern). §2.5 defined only the p90 floor; certifying a p50 over a handful of edges is the same noise-gate class round 7 killed. **Consequence: P2-A (nB = 4) is not a slice-B gating cell.** P2's slice-B gates run on its F arm; P2-A remains a slice-A + structural + churn cell.

4. **N_min = 20** (A4 gating floor over |U|, §3). Both presets clear it by a wide margin at full population (P1 |clusters| = 123, P2 = 70); real |U| after a probe edit is expected ≥ 60 on both. Below 20 → vacuous pass, report-only (§3.2's convention).

5. **M4 coverage floor = 0.5** (§3.1). Coverage (fraction of U with a same-column ≥ 3 estimate) < 0.5 ⇒ M4 = INCONCLUSIVE, requiring explicit owner acknowledgment at milestone exit.

6. **Bootstrap seed + resampling procedure (§2.5).** Seed = `20260704`; PRNG = `mulberry32(seed)` (32-bit, dependency-free, pinned implementation to live beside the CI code); B = 1000; CI = percentile method [2.5%, 97.5%]; resample unit = the address-keyed paired per-edge delta vector, n-out-of-n with replacement. **Unmatched-address void threshold (pins §2.5's "high unmatched count"):** unmatched > 20% of min(n_baseline, n_candidate) voids the comparison for that cell.

7. **A2 candidate order** — restated unchanged from §1.3: {initial (model order), sweep results 1..K in sweep order, height-aware greedy seed}; earliest-wins on exact-integer cost ties (after the crossings-trial tiebreak).

8. **Measurement conventions (WP-2d pins, adjudicated).** (a) vertical extent = polyline `max_y − min_y` over rendered points (the existing diagnostics convention, per §2's own "match the existing convention"); (b) `Δx_endpoints` = `|x_last − x_first|` of the arrow's rendered points; (c) content bbox = the `dataflow.aspect` element set (topology frames ∪ primary-cluster frames); (d) band Y-position: a real topology frame's rect wins over the dissolved-band member-median (§2.1's fallback fires only when no frame exists); (e) degenerate same-band slice-B edges report bands-skipped = 0, never negative/undefined; (f) percentiles = nearest-rank `sorted[floor(n·f)]`, capped at n−1 (reproduces the existing p50 exactly). Cluster ancestor paths resolve via the 3-tier rule (own `terraformTopologyPath` → `terraformCompoundParentKey` → deepest geometric containment) — required because compact-mode compound scenes stamp only the parent key (empirical, WP-2d).

Freeze authority: orchestrator per the approved plan ("orchestrator freezes … by spec amendment"); items 3, 5, and the 20% void threshold are new numeric pins made under that authority — flagged for owner review at checkpoint V1.

## 13. A4 threshold freeze register (2026-07-05, W3 — frozen by this amendment per v2.0 §6-A4's C11 clause)

Derivation evidence: the WP-3e fixture-triple reports (`A4_TRIPLE_REPORT_P1/P2`, arms A_v2_baseline / G_strata_k0 / H_strata_k4 / I_strata_k4_a7, mutations add-one-resource / add-one-edge / moved{}-rename; all health checks green, all cells |U| ≥ 68 ≥ N_min, no degradation).

1. **Frozen A4 gate thresholds (the v2.0 §6-A4 PASS clause — M1_rel and M2_flip ONLY; M3 report-only, M4/M5 report with their §3 statuses):**

   - **M1_rel ≤ 0.08**
   - **M2_flip ≤ 0.10**

2. **Derivation trail (honest, incl. a failed transfer):** the P1-only rule (max observed candidate-arm value × 3 headroom → M1_rel 0.06, M2_flip 0.02) FAILED P2 validation on M2_flip (P2 add-one-edge: strata 0.0544 > 0.02) — add-one-edge order churn is preset-structure-dependent (the v2 substrate shows the same jump: 0.0069 on P1 → 0.1514 on P2, ×22). Revised per C11: thresholds frozen from the JOINT two-preset triple with ~2–3× headroom over the worst observed candidate cell (M1_rel worst 0.0246, M2_flip worst 0.0544), bounded above by the requirement that v2-class churn FAILS (v2 observed: M1_rel 0.1638/0.2072 on add-one-resource-P1/add-one-edge-P2; M2_flip 0.1514 on add-one-edge-P2). Both presets' candidate arms pass all cells under the frozen values.

3. **Anchor requirement (separate from the thresholds, per §6-A4's empirical-anchor line):** the engine must beat the v2 substrate on M2_flip for the same preset's add-one-edge fixture. Observed: P1 0.0050 < 0.0069; P2 0.0544 < 0.1514 — satisfied at K=4 and K=4+A7 (K=0 is identically zero-churn).

4. **Scope:** gates the strata engine's shipping configuration on the fixture triple (T2, M1-exit and every M2+ regression run). K=0 arms trivially pass. A7 does not regress the gate (I ≡ H on every cell except P1 add-one-resource M1_rel 0.0183→0.0194, far under threshold).

Freeze authority: orchestrator per the approved plan; flagged for owner review at checkpoint V2.
