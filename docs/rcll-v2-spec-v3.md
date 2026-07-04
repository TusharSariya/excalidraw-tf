# RCLL v2 — Layout Engine Specification, revision 3 (normative amendments)

| Field | Value |
| --- | --- |
| Status | **Normative — source of truth together with [`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md).** This revision is an **amendment document**: every v2.0 section NOT amended here is incorporated by reference unchanged; where this document and v2.0 conflict, this document wins. (v2.0 §5 already defined amendment as the C11 mechanism; this is that mechanism exercised.) |
| Version | 3.0 (2026-07-04) |
| Produced by | Round-6 adversarial review ([`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md)): first attack on v2.0's new algorithms (A0/A2/A7), counter-attack on round-5's corrections (A3/A4/A6), full v1→v2 traceability audit, reading-list/corpus audit, SOTA-2026 sweep, **two-preset generalization + cyclic probes**, fable refute panel. |
| What did NOT change | Engine shape (D2′ substrate — now double-preset supported), D1′/D3′/D4′/D5′/D6′/D7′ decisions, A3 (verified exact), A1, A0's placement mechanics (contiguity/overlap proof attacked and held), A6 ids/seeds/versions (verified against real code), the build order S0a→S9→S4→S0b→sweeps→SA7→S0c→S8→S2, C1′/C2′/C4′/C5′, C7–C10′, R1–R3, R5, R7–R10, T1/T2/T3/T5–T8, OD-2/4/6/7/8/10/11. **Touched with scope notes or asserts (not redesigned):** C3′ + R6 (scope clarifications, §6), T4 (+assert, §6), S0b (+assert §7, failure contract §8.4), T9/T10 (§2), OD-1 (§4.5), M1 exit (§9). |
| Audience | Same as v2.0. An implementer reads v2.0 with this document open beside it; §5 below lists every v2.0 anchor that is superseded. |

## 0. What changed since v2.0 and why (read this first)

Round 6 measured and refuted the premise that **A7 is the near-straightness lever**:

1. **The near-straightness objective was structurally mis-assigned.** Each E′ edge participates in the Y-ordering/placement objective at exactly one hull (its endpoints' LCA); below the LCA every ancestor hull orders blind to it. Cross-band edges are floored at ≈208px vertical extent by the geometry constants themselves (FRAME_PAD·2 + BAND_GAP + TITLE_RESERVE) — 8.7× the 24px near-straight threshold — regardless of anything A2/A7 do. A7's only cross-hull mechanism is the rigid-block nudge the hull-Y campaign killed twice. Refute-panel calibration: P(A7-as-v2.0-specified materially improves the owner's long-cross-hull-vertical complaint) ≈ 0.05–0.10. **Near-straight is now a within-packed-hull metric; the cross-band objective is owned by A0+A2 and measured by different statistics (§2).**
2. **The only cross-band lever was pointed at the wrong objective.** A2's banded ordering is the sole edge-aware automatic input to band order — but v2.0's acceptance gate admitted reorders only on strict *crossings* decrease, so an adjacency win with flat crossings was rejected. **A2's banded-level acceptance now targets cross-band vertical extent (§3).**
3. **Gate statistics corrected.** Median vertical deviation is tail-blind; the owner's complaint is the tail; A7 optimizes Σ|Δy| but was gated on the median. Tail statistics (mean/p95) are now co-gates; a compactness metric exists; the NS A/B gains a tail co-gate. The owner's asymmetric objective (long-horizontal-fine / long-vertical-bad) is recorded as an **owner-calibrated engineering prior** with indirect literature support (Helmke GD'24 domain-conventions; geodesic tendency) — not as a literature-established fact.
4. **Generalization measured (the round-5 power caveat substantially reduced — two distinct graphs now, still not a battery).** The 7-arm battery ran on a second, structurally different preset + a cyclic fixture. The v2 substrate wins both presets (D2′ vindicated); the owner's daily view does **not** generalize (4.4× worse deviation than baseline off-preset); round-5's "rcll ≈4× less add-churn" was preset-specific (falsified on preset #2); one injected 2-cycle blows v2 width +77% and the owner-view height +141% (A3's structural repair vindicated). **§4 baselines replaced with two-preset tables; every cross-engine claim is per-preset qualified.**
5. **A6 tombstone contradiction resolved.** A spec-literal tombstone (no `updated` timestamp, per v2.0 A6's "no updated timestamps anywhere") is dropped by `isSyncableElement`'s 24h wall-clock window at the first broadcast reduce (`Portal.broadcastScene`) and never persists — T4's no-resurrection guarantee failed on every path (refute-panel UPHELD, no bypass exists). **Fixed by a scoped exception (§6).**
6. **A sixth silent seam.** `applyCompoundHierarchicalLayout` is "the sole owner of provider Y" in all three existing export paths; v2.0's fork boundary and seam list never named the export/scene-build layer. **C6′ seam #6 (§7).**
7. **Dropped v1 issues dispositioned.** DEC-7 huge fan-out, T4 fan-out pinning, T5 hub centering, the failure-mode ladder, Q7-AXIS, and extraction timing each get an explicit owner or OD (§8).

Corpus note: Forster 2004 (*constrained two-level crossing reduction*) **is in the corpus with full text** (`forward-10-1007-978-3-540-31843-9-22`) — the reading list's "missing" claim was wrong; it is now the designated A2 upgrade reference (OD-12).

## 1. Amended decisions

| # | Decision | Change vs v2.0 |
| --- | --- | --- |
| **D8″** | Milestones | M1a unchanged (GO as written + the S0b provider-Y assert, §7) — but explicitly labeled: at K=0 band order is pure model order; the readability battery is not meaningful until K=4. M1 exit adds the **arm-E side-by-side comparison** (§9). |
| **D9′** | Metric family | Replaced in full (§2): LCA-policy scope split; slice-B gates = vertical-extent tail + bands-skipped + stacked band height; slice-A gates = near-straight + tail deviation; compactness metric added; geometry constants frozen like thresholds. |
| **D10** (new) | Cross-band objective owner | The cross-band vertical objective is owned by **A0 (band heights/packing) + A2 (band order)**, gated by slice-B metrics; A7 owns slice A only. OD-9 routing is **plan-of-record** for the flow-reading ceiling (owner decision required before M2 freeze). |

## 2. D9′ / R4′ / T9′ — the metric family (replaces v2.0 D9, R4, T9 metric definitions)

**Metric edge population (normative, resolves the isDeleted trap):** the population is the **engine-emitted, non-aggregated declared-dataflow (TFD) arrows, regardless of `isDeleted`** — declared arrows ship hidden and visibility is view-time; "rendered" never appears in a metric definition.

**Edge scope split (normative).** Every population edge is classified by the **schema policy of its endpoints' LCA hull** (policy-based, so R10's configurable schemas are covered without role-name lists): **slice B (cross-band)** — the LCA hull's policy is `banded`, or the LCA is the root; **slice A (intra-packed)** — every other case. (Under the default AWS schema this yields A = {region, vpc, subnetZone} LCAs, B = {account, provider, root}.) T9 reports every metric per slice; gates bind per slice as stated below.

**Baseline precondition (C11 — the gates below are INERT until this lands):** the slice-level baselines do not exist yet — the round-6 probes measured aggregates. At S0b, run the T9 battery on the **v2 substrate** on both presets to derive the slice-A/B baselines (p50/p90 vertical extent, bands-skipped, stacked band height, area utilization) and freeze them by amendment **before** any gated engine code lands. Deriving any of these numbers from the engine under test voids the gate (C11 verbatim).

| Metric | Slice | Role |
| --- | --- | --- |
| vertical extent p50 **and** p90 (px) | B | **GATE** (the owner-complaint statistic): strictly better than the frozen v2-substrate baseline, both presets |
| mean bands-skipped per edge — bands-skipped(e) = count of sibling bands strictly between the two endpoint-containing bands in final Y order (adjacent ⇒ 0; same band ⇒ edge is not slice B) | B | **GATE** for A2's banded ordering: lower than the frozen v2-substrate baseline, both presets; an empty slice ⇒ vacuous pass, reported as such |
| total stacked band height (Σ band heights per banded hull) | B | not-regress vs the frozen **v2-substrate** baseline (derived at S0b, never from the engine under test — C11); t1's owner metric (packing density) |
| near-straight fraction (≤24px) | A only | GATE (strictly better vs v2 baseline); on slice B **report-only** (composition-floored ≈208px — gating it gates the constants, not the code) |
| median **and mean/p95** vertical deviation | A | GATE (median alone is tail-blind; A7's own objective is Σ|Δy| — the gate must track the optimized statistic) |
| rank-span-normalized deviation (vertical extent ÷ ideal chord length) | A+B | report (the honest formalization of the asymmetric objective — a long edge legitimately spanning many ranks is not penalized like a vertical jog within one) |
| area utilization (Σ element areas ÷ content bbox area) | scene | **report-only during M1** — the compactness measurement (aspect/W×H are shape, not density); whether it becomes a gate is decided at S2 under C11 (R5's existing width/aspect treatment is unchanged) |
| crossings ÷ eligible pairs (pairs sharing no endpoint address; same population rule as above) | scene | diagnostic, never a gate |
| hub centering (with hub counts) + fan-out column rate | scene | report, **arm-E-comparative** (see §9) |
| collisions, aspect, W×H, wall-clock | scene | report; OD-10 budget asserted by T10 |

**Geometry-constant freeze (C11 extension) — frozen NOW by this amendment** (the reachability of every gate above depends on them; the ≈208px cross-band floor is their function under the current defaults — treat the floor as a current-defaults lower bound, not an architectural constant): `PIPELINE_FRAME_PAD = 28`, band/lane gap `PIPELINE_LANE_GAP_Y = 96`, `TITLE_RESERVE (HULL_TITLE_BAND) = 56` (as-built values A0 normatively copies, `terraformPipelineV2Pack.ts:70,75,95`), `NEAR_STRAIGHT_MAX_PX = 24` (`terraformPipelineCollisionDiagnostics.ts:75`), COLUMN_GAP per the shared constants file. Changing any of them voids and re-derives every frozen threshold and baseline.

**Empirical anchors (replace v2.0 §4; reproduce via the round-6 probe files).** Preset 1 `staging-extended-localstack-v2` (145 arrows, eligible pairs 10,073) — the v2.0 §4 table stands with two added columns: mean deviation (A: 1,589 · E: 2,688) and normalized crossings (all arms 0.02, E 0.04). Preset 2 `staging-localstack` (69 arrows, eligible 2,223): A v2-compact **33 cr (0.01) / 459 med / 1,247 mean / 0.04 near-straight / 8.7k×5.7k / 1.2s**; E owner-view 124 (0.06) / **2,017** / 2,706 / 0.01 / 10.9k×20.3k / **6.6s** (18.0s on preset 1). Cyclic fixture (one injected 2-cycle, preset 1): v2 width +77% (clamp blowout), owner-view height +141% + 1 collision — no crashes, both engines deterministic. Churn preset 2: single-line reorders = 0/70 moved on both engines; one added edge = 32/70 on **both** (round-5's "rcll ≈4× less churn" is preset-1-specific — retired). A cyclic arm joins the standing T9 battery.

## 3. A2 amendments (v2.0 §6-A2 text otherwise unchanged)

1. **Acceptance objective, banded hulls (replaces lines 229–231 for hulls with policy "banded"):** accept the re-sorted sequence iff **Σ slice-B vertical extent over lifted E′ chords strictly decreases** in the trial placement; the deterministic crossing count is the tiebreak (accept on equal extent iff crossings strictly decrease). Packed hulls keep the crossing-decrease acceptance. *(Round 6: the crossings-only gate rejected exactly the band-adjacency wins that move the owner's complaint.)*
2. **Scoping words pinned at the acceptance clause:** the trial placement and its counts are computed **over units(h) and the edges lifted to h only** — never over global E′. (The v2.0 wording invited a ~100× misread that would blow OD-10; the correct per-hull cost is ~4–160ms at 400 nodes/500 edges — measured diagnostics at 145 arrows run in 1–3ms.)
3. **Chord attachment geometry (new, normative):** a lifted edge's trial chord attaches at the **center of each unit's padded box**. This is a proxy for the leaf-level T9 metric; T9's leaf-level numbers remain the shipping truth.
4. **Acceptance mode:** per-sweep strict-improvement is replaced by **best-of-{initial, K}**: run all K sweeps unconditionally, score the **initial (model-order) sequence and each of the K resulting sequences** with the acceptance objective, keep the best (ties → the earliest candidate, so the initial sequence wins all-ties — the diff-stability-preserving default). Deterministic, bounded, can never regress below the model-order start, and cannot freeze there the way v2.0's per-sweep gate could.
5. **Fixture (mandatory, joins v2.0's list):** banded hull with ≥4 bands and a connectivity pattern whose optimal adjacency differs from alphabetical — assert the accepted order places connected bands adjacent (this is the load-bearing behavior; v2.0 shipped it untested).
6. **Label correction:** A2 is **Strategy-1-inspired** (GD'24's mechanism selects among crossing-min outcomes by model-order agreement; A2's gate is a distinct construction). Do not cite it as Strategy 1 implemented.
7. **OD-12 (new) · A2 upgrade path:** Forster 2004's constrained two-level crossing reduction (merge-on-violation constrained barycenter, `forward-10-1007-978-3-540-31843-9-22`, in-corpus full text) generalized per Forster GD'02's constraint method — a single global sweep with contiguity constraints and descendant-weighted lifted edges. Stateless, deterministic, R7-compatible. **Evidence qualification:** the <1%-from-optimal result is for the paper's two-level constrained problem; the compound generalization proposed here is unmeasured — the number motivates the A/B, it does not predict its outcome. Evaluate **after** M1 exit; adopt if slice-B gates or crossings-per-eligible-pair improve without T2 regression.

## 4. A7 amendments (v2.0 §6-A7 text otherwise unchanged)

1. **Scope claim corrected:** A7 is the **slice-A (within-packed-hull) refinement pass**. It is not, and cannot be, the cross-band lever (LCA-blindness + band clamps + the twice-measured hull-Y NO-GO). v2.0's "the near-straightness lever" framing is retired.
2. **Gate (replaces v2.0's SA7 acceptance):** slice-A near-straight AND slice-A mean/p95 deviation strictly better than the same engine pre-A7, T2 not regressed. Slice-B numbers are reported for honesty and MUST NOT be cited as A7 wins.
3. **Escalation ladder re-aimed:** OD-3B (dummy chains) and OD-5 Option 2 (full BK) are slice-A levers only — dummies never move endpoint Y across bands, and same-layer band edges generate no dummies at all. The designated cross-band escalation is **OD-9 routing** (now plan-of-record; owner decision before M2 freeze; prerequisite = the §2 metric split, because vertical *extent* punishes orthogonal jogs).
4. **Implementation notes (from source verification):** v2.0's "priority/median nudge" label is inaccurate — Option 1 is the iterative *averaging* class (BK's refs [14,16]), not Sugiyama's priority method (which displaces lower-priority neighbors). Keep the algorithm, fix the name. Known quality costs, accepted: Jacobi batch converges slower than Gauss–Seidel; the L1 objective vs L2 (PAV) projection mismatch can produce no-op columns. Neither affects determinism or safety (strict-improvement acceptance remains monotone — the oscillation attack failed).
5. **OD-1′ (amends v2.0 OD-1):** the NS-refinement arm ships as default only if, on both presets, **width improves AND slice-B p90 vertical extent does not regress AND slice-A mean/p95 deviation does not regress** past the frozen baselines. Rationale: NS minimizes the symmetric rank-span objective — the axis the owner declared cheap — and its width win can mask vertical stacking that a median-only gate cannot see (round-6 F2; §4 D2 row: deviation rose 496→532 under NS while width improved).

## 5. Superseded v2.0 anchors (quick index)

| v2.0 anchor | Status in v3 |
| --- | --- |
| D9 (line 46), R4 (63), T9 (425) | replaced by §2 |
| §4 baselines (71–85) | replaced by §2 anchors + round-6 probe JSONs |
| A2 acceptance (229–231), sweep semantics | amended by §3 (banded objective, best-of-K, geometry, scoping) |
| A7 header claim + gate (238–283) | amended by §4 |
| A6 line 373 ("no … updated … anywhere") + tombstone paragraph (365–372) | replaced by §6 |
| C3′ (93), R6 (65) | scope clarifications, §6 |
| C6′ (96) | +seam #6, §7 |
| OD-3 (433), OD-5 (435), OD-9 (439) | re-aimed/promoted per §4.3 |
| A4 (285–315) | additions §8.1 (M1_rel/M2_flip unchanged) |
| §10 literature | corrections §10 below |

## 6. A6 tombstone amendment (replaces v2.0 A6 lines 365–373; refute-panel-drafted)

> Tombstones are OWNED BY THE APPLY LAYER (unchanged). The tombstone's `version` (= G) and `versionNonce` (= FNV-1a(stableId+":"+G) & 0x7fffffff ||1) are deterministic and MUST be passed explicitly (never via `newElementWith`'s `?? randomInteger()` fallback). Its **`updated` field MUST be set via `getUpdatedTimestamp()`** (wall-clock in prod; constant `1` under isTestEnv) so it clears `isSyncableElement`'s `updated > Date.now() − DELETED_ELEMENT_TIMEOUT` gate (`excalidraw-app/data/index.ts:49-54`; every broadcast route reduces through it in `Portal.broadcastScene`, `Portal.tsx:154-164`, and the Firebase save/load paths re-filter) and therefore actually broadcasts and persists. This is the **sole permitted wall-clock read in the apply layer**; `Math.random`/`Date.now` remain forbidden everywhere else. Tombstone retention is the platform's **24h wall-clock window** (not "one generation window").
>
> **C3′ scope note:** C3′ binds layout and finalize only; the apply-layer tombstone's `updated` is the single explicit exception.
> **R6 scope note:** R6's byte-identical comparator covers ENGINE (finalize) output; the apply-layer tombstone's `updated` is deterministic under isTestEnv and excluded from any prod byte-comparison of the applied scene.

T4 gains the assertion: a tombstone constructed per this amendment passes `isSyncableElement` at creation time. **Test construction note (executability):** under isTestEnv, `getUpdatedTimestamp()` returns the constant `1`, which is stale-by-construction against `Date.now() − 24h` — the unit test must therefore inject the clock: stub `getUpdatedTimestamp` (or construct the tombstone with `updated = <injected now>`) and assert the real `isSyncableElement` predicate accepts it, plus a companion negative assert that `updated = 1` is rejected (proving the test exercises the real 24h window, not a tautology).

## 7. C6′ seam #6 (appended to v2.0 C6′)

> **(6) the export/scene-build layer:** `applyCompoundHierarchicalLayout` re-stacks every provider subtree sequentially in Y (`terraformPipelineLayoutCompoundHierarchy.ts:213-249`) and is invoked by all three existing export paths (`terraformPipelineLayoutV2.ts:121`, `…LayoutRcll.ts:335`, `…LayoutCompound.ts:112`); the rcll placement layer documents it as "the sole owner of provider Y." The rcll-v2 engine owns absolute coordinates end-to-end (A0 "after root"): its scene build MUST NOT route through this re-stack (fork or bypass). **S0b acceptance gains the assert: engine-emitted provider Y survives byte-identically into the built scene** (single-provider presets mask the clobber as a pure translate — the assert must run on a ≥2-provider fixture or compare exact Y values, not shapes).

## 8. Dispositions for the round-6 residue

1. **A4 additions (F8), executable definitions:** gate M1_rel + M2_flip as specified **plus**:
   - **M4_disp95** = p95 over U of the translation-corrected per-node displacement: for node a, `disp(a) = ‖pos_new(a) − pos_old(a) − shift(col_old(a))‖` where `col_old(a)` = a's column in L_old (rounded bbox-min X, the churn probe's convention), and `shift(c)` = the **median Δposition vector (Δx, Δy) of all U-nodes whose old column is c**; if fewer than 3 U-nodes share c (or a's column has no counterpart), use the global median Δposition over U instead. Catches the localized big moves the |U|²-pair mean provably washes out (m=2 movers among n=400 cap M1_rel at ~0.01) while respecting Sondag's translation argument.
   - **M5_hull** = 1 − ARI between the two partitions of U given by **each node's deepest containing hull** (its immediate parent hull id, mapped across regenerations by hull address; the partition is flat — one label per node — so ARI is well-defined despite the nested tree). O(n), immune to the sparse one-hot sector brittleness; Meidiana-CCQ-shaped.
   - Both gated with thresholds frozen per the unchanged C11 protocol (derive preset-set 1, validate on the disjoint set; round-6's falsification of the 4× churn claim is the standing demonstration of why the split is mandatory).
2. **OD-13 (new) · huge fan-out:** v1's DEC-7 (unbuilt there, dropped in v2.0). Designated mechanism: **ELK-0.10-style layer unzipping** (split an over-tall layer into adjacent sub-columns) as a flag-gated A/B post-M1. Until then, T9 reports max column height so the blind spot is visible.
3. **Hub/fan-out ownership:** hub centering and fan-out column alignment are T9 arm-E-comparative report rows from M1; an owning milestone decision (algorithmic centering pass vs accept-as-emergent) is due at M2 planning, informed by those rows. *(v1 had these as phase objectives T4/T5; v2.0 silently dropped them; the owner's preferred arm wins precisely here.)*
4. **Failure contract (new, S0b), executable form:** the engine entry point wraps A3→A7 in a single guard. **Caught classes (exhaustive):** (a) any thrown error from an engine phase; (b) an R2/R3 structural-check failure on final geometry in prod builds (dev builds still hard-assert); (c) a non-finite coordinate in the output. (A2/A7 cannot "non-converge" — both are bounded by construction; that phrase is retired.) **On catch:** return the **v2 substrate's output for the same input** (the fallback layout call, same options minus the variant), with meta `rcllV2Degraded = { stage: "a3"|"a1"|"a0"|"a2"|"a7"|"finalize"|"structural-check", reason: <first-line of the error or the failed check name> }` merged into the scene meta (same channel as today's `rcllDegraded`, so the demo UI and T9 harness surface it). If the fallback itself throws, propagate the error (the app's existing import-failure path shows it) — never a silent partial scene. T9 asserts `rcllV2Degraded` is absent on both presets. *(v1's 5-rung ladder is not reproduced; one rung + observability is the v3 posture.)*
5. **Q7-AXIS scheduled:** before M2 gates freeze — hand-label 20 cross-hull edges on both presets: does X = dependency depth read as the dataflow direction? (Round-3 question, dropped twice.)
6. **Battery realism:** the T9/R4 battery runs **with ancillary strips on** for at least one arm per preset (every real owner view has them; a battery on extraction-free scenes measures a view nobody uses). Hub extraction (TF-visualizer Step-3 style) is an M2 A/B candidate, not M3 — extraction is the closest production analog's legibility *prerequisite*.
7. **T9 population rule (normative):** the diagnostics arrow population counts arrows **regardless of `isDeleted`** (declared-dataflow arrows ship hidden; visibility is view-time). Round 6's own probe initially read 0 eligible pairs from exactly this trap; it is now a stated rule, not folklore.

## 9. M1 exit (amends v2.0 §7/D8′ exit language)

M1 exit = T2 (frozen A4 thresholds, derive/validate on disjoint presets) **AND** the §2 battery vs the frozen v2-substrate baselines on ≥2 presets **AND** an **arm-E side-by-side that is itself a gate**: the T9 report renders the new engine's numbers next to the owner's daily-view arm (E) on both presets — slice-B extent, bands-skipped, hub centering, aspect, wall-clock — and **M1 does not exit until the owner's recorded verdict on that comparison is positive** (a negative verdict returns the milestone to M1b with the owner's stated deltas as the work list). *(An engine that beats the v2 baseline but loses to the view the owner already uses has not shipped a readability improvement; v2.0's gates could not see this — and a threshold table cannot adjudicate it, only the owner can.)* Wall-clock context: arm E costs 18.0s/6.6s main-thread on presets 1/2 — the OD-10 budget (≤2s/≤10s) is not just a constraint, it is a headline win if met.

## 10. Literature corrections (amends v2.0 §10)

- **Forster 2004**, *A Fast and Simple Heuristic for Constrained Two-Level Crossing Reduction* (GD 2004, LNCS 3383 pp. 206–216, DOI 10.1007/978-3-540-31843-9_22) — **in-corpus, full text** (`forward-10-1007-978-3-540-31843-9-22`); designated A2 upgrade (OD-12). The reading list's "missing" claim is corrected in [`rcll-reading-list.md`](./rcll-reading-list.md) §14.
- **Sander 1996 grounding scoped**: A0 inherits Sander's *ranking/spans*, not his placement (no border nodes, no per-layer cluster positions, no routing corridors); Forster GD'02 p.278 documents the per-hull-recursion crossing cost A0 accepts for structural contiguity. Cite accordingly.
- **Domrös & von Hanxleden GD'24**: A2 is *Strategy-1-inspired* (see §3.6).
- **The asymmetric objective** (long-horizontal-fine / long-vertical-bad): supported indirectly (Helmke et al. GD'24 — domain conventions override classical aesthetics, verified at source; Huang/Eades/Hong 2009 geodesic tendency; Ware 02 continuity); **no study isolates vertical-vs-horizontal edge cost** — this is an owner-calibrated engineering prior, and the spec says so.
- **Fooling/Goodhart** (van Wageningen et al., arXiv 2508.15557): **that paper's specific morph attack** fails against this engine's rank-pinning + hull contiguity (the morphs need 2-D relocation freedom the constraints remove) — this does not prove the §2 family is Goodhart-resistant in general; the defense is the structural constraints + multi-metric breadth + the owner-verdict gate (§9), and the claim is scoped to exactly that.
- **New references:** Meidiana/Hong/Eades 2020 (`arxiv-2008-07764v2`) — A4 complement; Charytitsch & Nascimento, *C-IGDP* (EJOR 2026, arXiv:2508.15949) — the literature formalization of diff-stable regeneration (shapes T2's framing; anchoring itself remains rejected); Pupyrev et al. GD 2010 (in-corpus) + Edge-Path Bundling (arXiv:2108.05467) — hub-relief A/B candidates; ELK 0.10 release notes — layer unzipping (OD-13). Back-edge *styling* is a confirmed literature hole → in-house A/B alongside A3's styled reversals.
- **Harvest list** (owner action, priority order): C-IGDP 2508.15949 · Edge-Path Bundling 2108.05467 + Bundling-Aware GD 2024.15 · Dobler & Roithinger 2502.20896 (layered gaps/crossings) · Brandenburg–Hanauer 2011 (free PDF, uni-passau MIP-1104) · TF-visualizer PDF (corpus stub; `[essential]` billing) · Wei 2011 skyline + Huang 2009 geodesic (stubs the spec leans on) · CHI 2025 bundling-perception · gdMetriX.

## 11. Traceability (amendments → round-6 findings)

| Amendment | Finding |
| --- | --- |
| §2 metric family (slices, tail gates, compactness, geometry freeze) | F1, F2 |
| §3 A2 (banded acceptance objective, best-of-K, geometry, fixture, OD-12) | F1, F6, F7 |
| §4 A7 (scope, gate, ladder, naming) | F1, F2 |
| §6 tombstone | F4 |
| §7 seam #6 | F5 |
| §8.1 A4 additions | F8 |
| §8.2–8.7 dispositions | F9, F10, F12 |
| §9 M1 exit (arm-E comparison) | F3, F9c |
| §10 literature | F6, F11, audit findings |
| §2 anchors (two-preset + cyclic + churn) | F3, F10 |

## GSTACK REVIEW REPORT

| Review | Trigger | Runs | Status |
| --- | --- | --- | --- |
| Round-6 adversarial review | user-invoked round 6 | 1 | This document is its output |
| Refute panel | fable (architecture composite C1–C5) + opus (tombstone chain) | 2 | All verdicts folded (C1/C2/C3 CORRECTED-FORM, C4 CONFIRMED, tombstone UPHELD) |
| Codex review | `/codex` consult over report + this spec (session `019f2f08-da69…`) | 1 | 10 P1 + 7 P2 — **all 10 P1 and 5 of 7 P2 folded in place** (slice-baseline precondition, geometry constants pinned, best-of-{initial,K}, bands-skipped definition + substrate-derived freezes, tombstone clock-injection test, OD-1′ NS tail co-gate, executable A4 definitions, executable failure contract, owner-verdict-binding M1 exit, population rule; front-matter list, utilization wording, policy-based slices, 208px/Forster/fooling/generalization qualifications). 2 P2 acknowledged-not-changed: none remaining. |

**VERDICT:** M1a GO as written (+§7 assert). M1b GO **under these amendments** (v2.0's M1b as previously aimed: NO-GO — its centerpiece gate certified the wrong statistic on the wrong scope). First code remains the v2.0 §12 D10 bug-fix PR, then S0a — with the §2 baseline-derivation run as part of S0b.

NO UNRESOLVED DECISIONS
