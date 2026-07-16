# Agent 8 (ADVERSARY) — Is strata's whole construction the right frame?

**Charter:** step back and ask, from the literature, whether Sugiyama + rankSeparate-longest-path + skyline-pack is even the right approach for nested AWS-infra dependency diagrams, or whether a fundamentally different literature-backed construction would avoid P1–P5 wholesale. Genuine skeptic; shit-test BOTH strata AND the alternatives.

**Method:** ground-truthed on `scratchpad/strata-problem-crystallization.md` + `docs/strata-readability-synthesis-2026-07-15.md` + `docs/strata-xcompact-removed-findings.md`; literature from graph-layout-rag (doc_ids inline). In-repo facts (NS ranker exists as `pipelineColumnPacking:"shorten"`) confirmed via graphify.

---

## BOTTOM LINE (read this first)

**P1–P5 are NOT inherent to the Sugiyama family. They are artifacts of strata's two BESPOKE stage instances** — `rankSeparate`/OD-14 (a separation-augmented _longest-path_ ranker that maximises columns and ignores edge length) and `dropY` (a greedy top-down skyline packer with height as an unscored by-product). The literature-standard instances of those exact two stages — **network-simplex ranking (Gansner et al., TSE 1993, `gansner-tse93`)** and **Brandes–Köpf coordinate assignment (GD 2001, `elk-10-1007-3-540-45848-4-3`)** — are _designed_ to not do what strata does: NS minimises Σ weighted edge length subject to a rank-separation floor (would place the DLQ one column past its source — exactly the "base floor" the crystallization doc computed), and BK balances/aligns instead of dropping greedily.

**Verdict (robustness × fit × cost):**

1. **(a) Fix the two bespoke stages** — but NOT by swapping the ranker. **Corrected by the W5b measurement (addendum): rank-NS is a NO-GO on this preset** (rank-span compression densifies columns → worse path readability, despite hitting its length objective). The right realization of "fix stage 1" is the **targeted guard-gated X-SHIFT operator** (synthesis #1 — move the ONE degree-1 sink / pure-sink block, keeping rankSeparate for the rank), plus **BK-class coordinate assignment** for stage 2. HIGHEST. Preserves everything strata does well; converges with synthesis #1/#5. Key cites: Brandes–Köpf `elk-10-1007-3-540-45848-4-3`; Gansner `gansner-tse93` now only as the _measured-NO-GO_ candidate generator (synthesis #2), not the fix.
2. **(b) Add a constraint layer** (IPSep-CoLa `dwyer-ipsep-cola` / Dig-CoLa / SetCoLa `forward-10-1111-cgf-13440`). MEDIUM, **but no longer an escalation target for "if NS-rank fails"** (see addendum): the joint constrained NS already embedded IPSep-CoLa's separation-as-constraint philosophy inside the rank stage and measured NO-GO, so a constraint layer optimizing the same rank-span objective would plausibly hit the same densification wall. Its remaining distinct value is a _joint X+Y_ solve with perpendicular (Y) slack — which is exactly what the targeted X-shift operator already targets. Worst fit-risk otherwise (loses columns, non-deterministic, containment-at-scale).
3. **(c) A different construction entirely** (orthogonal/HOLA, stress-primary). LOWEST. Would avoid P1–P5 but throws out upward-flow + columns + determinism = discards what works; enormous migration cost.

**strata is the right FAMILY; its two bespoke stages are the wrong INSTANCES.**

> **ADDENDUM (coordinator challenge, code+measurement-grounded — supersedes the NS-rank pessimism in §self-adversarial below).** Two corrections, both against my own original framing AND against the coordinator's premise:
>
> 1. **`pipelineColumnPacking:"shorten"` IS the rank assigner (Gansner §2.3), NOT the coordinate assigner (§4.2).** Code: `terraformLayoutCore.ts:554` > `networkSimplexRank: columnPacking === "shorten"` → dispatches `computeNetworkSimplexDepths` (`terraformPipelineLayoutShared.ts:766`), which assigns **depths = ranks/layers** by min Σ w·span under δ=1 separation constraints. In a left-to-right layout the rank axis _is_ the geometric X-axis, which is why memory labels it "X-axis NS" — but functionally it is the §2.3 rank/layer assigner that pulls a degree-1 sink tight to its source. **The coordinator's premise ("shorten = the coordinate one, not the rank assigner") is incorrect; my original implication that the built NS was a _different_ algorithm is also incorrect. It is the rank-NS.**
> 2. **rank-NS on this preset is NOT untested — it is measured three ways, and the most sophisticated (literature-faithful) form is a NO-GO.** In the strata rank dispatch (`terraformPipelineStrataRank.ts:119-173`) rankSeparate ON _replaces_ the rank before NS is attempted (mutual exclusion). The three measured attempts to run rank-NS instead:
>
>    - blanket swap (rankSeparate OFF, length-min rank): +176…+215 crossings, height ×4.3 (synthesis §2 / xcompact doc) — the "catastrophe" I cited;
>    - sequential NS-after-RS: +149% height (RFC DI-NS-4);
>    - **joint constrained NS** — Gansner's _actual_ constraint-edge device: solve ONCE over the augmented graph (real edges weighted + all-to-all sibling-separation edges as **zero-weight** constraints), preserving separation/height while compressing only real spans. **Built** (`computeStrataJointNsFloor`, flag `strataJointNsRank`) and **measured on staging-extended-localstack-v2** (`docs/strata-view-w5b-joint-ns-probe.md`, 2026-07-12): arm X hit its objective (real span 544→509, −6.4%), held height (14,105 vs sequential-RS 14,126) — **yet was strictly WORSE on every path-readability metric** (J-vs-X paired CI: crossings-on-path [+6,+7], rt̂ p90 [+4.47,+5.36], extent [+693,+2534]). **Verdict: NO-GO.**
>
>    **Deep lesson (empirical, this preset): rank-span compression — ANY NS rank objective, including the constraint-augmented joint solve — is the WRONG lever for the owner's cases.** Shortening a sink's rank span densifies its column and pushes more crossings onto traced paths, trading the length win for a crossings/readability loss. This is exactly why the 13-agent synthesis chose a **targeted per-node/per-block X-SHIFT operator** (move the ONE degree-1 sink — crossing-neutral by degree — or the pure-sink block), NOT a ranker swap: the ranker re-solves _all_ columns and cannot move one sink surgically. **Net effect on my verdict below: the "NS-rank" leg of fix (a) is downgraded from candidate-fix to measured NO-GO; the fix is the X-shift OPERATOR + BK coords, keeping rankSeparate. And my "escalate to constraint layer (b)" contingency is retracted as built on wrong evidence — the joint constrained NS already IS a constraint solve embedded in the rank stage (separation-as-zero-weight-edges = IPSep-CoLa's philosophy), and it failed for a reason _intrinsic to the rank-span objective_, not to the machinery, so a constraint layer optimizing the same objective would likely hit the same densification wall.** See revised §self-adversarial and §4.

---

## 1. Steelman the CURRENT construction

**What Sugiyama-layered is genuinely good at for these diagrams:**

- **Upward/left-to-right flow is a FIRST-CLASS OUTPUT, not an emergent property you fight for.** The owner's #1 constraint is LR edge flow. In a layered construction, direction _is_ the rank axis — every forward edge is monotone in rank by construction. Every non-layered alternative (stress, orthogonal) has to _re-impose_ direction as a soft constraint and can violate it under jitter (Dig-CoLa `openalex-10-1109-infvis-2005-1532130` exists precisely because plain stress does NOT respect edge direction). This is the single strongest reason to keep the family.
- **Deep containment maps natively onto compound layered layout.** account→region →VPC→subnet is a textbook compound Sugiyama problem (Sander compound Sugiyama; ELK layered, `s2-10-48550-arxiv-2311-00533`; Sponemann port constraints `elk-10-1007-978-3-642-11805-0-14`). Recursive rank-with-cluster-borders is a solved, deterministic, hundreds-of-nodes-scalable technique.
- **Clean uniform columns + gutters + determinism.** The `columnX` grid gives aligned ranks, uniform card width, reproducibility under a frozen seed (20260704). The xcompact post-mortem proved this is _load-bearing_: every attempt to leave the grid (greedy pack, per-hull snap) reintroduced the owner's own complaints (colinear cards, split peers).

**Are P1–P5 inherent to the family, or to strata's specific choices?** They are **strata-specific**, and the docs already localise them to two stages:

| Problem | Mechanism (ground-truthed) | Stage | Inherent to Sugiyama? |
| --- | --- | --- | --- |
| P1 DLQ long horizontal edge | rankSeparate inflates degree-1 sink r6→r15 | RANK | **No** — NS ranker places it at r6 (min edge length) |
| P2 SSM column Y-order | order/sift doesn't seat fan-in sinks near source Y | ORDER | **No** — coordinate/alignment stage concern |
| P3 west-2 stranded sinks + pierce | rankSeparate over-columns; sinks region-level _outside_ the VPC | RANK + hierarchy | **No** (rank) / hierarchy-assignment, not layout |
| P4 Account-04 block far-right | rankSeparate pushes pure-sink block +14 cols | RANK | **No** — NS clamps to deepest-source rank |
| P5 pull-forward vs packed height | dropY derives Y greedily from X, height unscored | PACK/coords | **No** — BK-class coords + explicit height term |

The recurring failure ("low-degree sinks stranded far from sources") is the _signature of a longest-path ranker that maximises columns_. Standard Sugiyama does **not** use longest-path for final ranks precisely because it wastes horizontal space and lengthens edges; Gansner introduced network-simplex ranking (`gansner-tse93` §2.3) to _minimise_ Σ ω·(rank(head)−rank(tail)) subject to the separation floor — the direct antidote to P1/P3/P4. Tradeoff, and it is real: rankSeparate was _chosen_ as a −42% **height** lever; NS trades height for edge-length. So the family isn't the problem — strata deliberately swapped the length-optimal ranker for a height-optimal one and inherited P1/P3/P4 as the cost.

---

## 2. Alternative constructions — would each AVOID P1–P5?

### (A) Constraint-based stress layout (IPSep-CoLa / Dig-CoLa / SetCoLa / topology-preserving)

Model direction, containment, and separation as _constraints_ on a stress majorization solve rather than as a rank pipeline.

- **Directional** → inequality `pos(v) − pos(u) ≥ δ` per edge (Dig-CoLa `openalex-10-1109-infvis-2005-1532130`; IPSep-CoLa separation constraints `dwyer-ipsep-cola`, DOI 10.1109/tvcg.2006.156).
- **Containment/separation** → non-overlap + boundary constraints, expressed concisely over node-sets in SetCoLa (`forward-10-1111-cgf-13440`).
- **Solver** → gradient-projection / VPSC; topology-preserving variant keeps a feasible drawing's topology while minimising P-stress (`doi-10-1007-978-3-642-00219-9-22`).

**Would it dissolve P1–P5?** In principle **yes, and most completely.** Stress pulls every node toward its graph-theoretic ideal distance from its neighbours, so a degree-1 sink sits _adjacent_ to its source (minimal stress) subject only to the directional gap δ — there is no longest-path maximisation to strand it. That is exactly the "adjacency" strata's search can never reach (synthesis: the win is purely horizontal, and the acceptance machinery already adopts it once generated). P5 evaporates because there is no rank→pack sequencing to create the Y-from-X coupling — a single solve places X and Y jointly.

**Scalability:** Wang et al. TVCG 2017 (`doi-10-1109-tvcg-2017-2745919`) run constrained stress majorization on **10K+ nodes interactively (GPU)**; VPSC gradient-projection is near-linear per iteration. Hundreds of nodes is not a scale problem.

**Where it FAILS for infra diagrams (adversarial):**

- **It is not columnar.** Stress produces organic positions; cards will not align into tidy uniform ranks unless you add heavy alignment constraints — and heavy alignment constraints re-create the very over-constraining that produces strata's rigidity. The owner _likes_ the column grid (xcompact post-mortem).
- **Containment-at-scale is cola's classic weak spot.** Non-overlap + boundary constraints over hundreds of _deeply nested_ boxes explode the constraint count; projection can thrash or hit infeasibility. IPSep-CoLa's own contribution is _making_ separation constraints tractable — deep nesting stresses it.
- **Non-determinism.** Stress is iterative and seed-sensitive; the owner's frozen reproducibility (byte-identical default-off) becomes fragile.
- **LR becomes soft.** strata's LR is a hard set-feasibility gate; cola satisfies it by projection, and near-boundary jitter can produce almost-but-not-quite monotone edges — visually worse than a crisp grid.

### (B) Orthogonal / Topology-Shape-Metrics / HOLA

Route edges orthogonally around obstacles; HOLA aims for "human-like" orthogonal drawings.

**Would it fix pierces/long edges?** The _routing_ half yes (route around the VPC frame → no pierce). The _layout_ half is a poor fit:

- Orthogonal layout **abandons the layered column metaphor** — no guaranteed upward flow, no uniform ranks. HOLA (absent from rag — see MISSING) and the successor ARCOL (`arxiv-2603-29618v1`) are aspect-ratio / readability engines, not upward-flow columnar infra engines.
- Classic TSM/planarization is for **sparse** graphs; deep containment + hundreds of nodes is not its home turf.
- **Bends replace pierces.** The owner wants _straight octilinear lines through metro-hubs_; orthogonal routing trades pierces for bend-count — a different aesthetic cost. Rüegg et al. 2014 stress-orthogonal DFD layout (`doi-10-1007-978-3-662-45803-7-27`) is the closest hybrid but is really cola+ports, i.e. it collapses back into (A).

**Verdict:** steal orthogonal _edge ROUTING_ to kill pierces (this is already synthesis change-set #4, "penetration-by-routing"), but **do not** adopt orthogonal _layout_ as the construction.

### (C) Sugiyama with NS rank + BK coords (the minimal literature-standard swap)

Keep the family; replace the two bespoke stages with their canonical instances.

- **rankSeparate → network-simplex rank** (`gansner-tse93` §2.3): min Σ weighted edge length s.t. rank(head)−rank(tail) ≥ δ. Directly places P1's DLQ one column past its source; clamps P4's Account-04 block to its deepest-source rank; pulls P3's sinks left. This is the exact antidote to the "longest-path maximisation" root cause.
- **dropY → Brandes–Köpf coordinate assignment** (`elk-10-1007-3-540-45848-4-3`,
  - Erratum `forward-10-48550-arxiv-2008-01252` for the two known bugs): linear-time, balances four alignments, straightens through-edges — the standard fix for P2/P5's coordinate pathology.

**Would it avoid P1–P5?** P1/P3/P4 directly (NS rank). P2/P5's coordinate half via BK. **Caveats are load-bearing and dealt with in §self-adversarial.**

### (D) Compound/recursive per-container layout (ELK/yFiles done properly)

Lay out each container interior independently, then compose (ELK layered compound; top-down compound `openalex-10-48550-arxiv-2312-07319`).

- **Helps:** recursive layout naturally keeps a container's own sinks _inside_ it.
- **Doesn't fix the actual P3:** the P3 sinks are _legitimately region-level (outside vpc-5b587)_ while their sources are _inside_ the VPC. That is a **hierarchy-assignment** question (which container owns the SSM param?), not a layout question — recursive layout can't fix mis-scoped containment, and cross-account edges still need a global pass. So (D) is orthogonal to the root cause, not a replacement for it.

---

## 3. Scale × preserve-what-works × migration cost

| Construction | Scales to 100s + deep nesting? | Preserves upward flow? | Preserves columns? | Preserves determinism? | Fixes P1/P3/P4? | Fixes P5? | Migration cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **strata (today)** | yes | yes (hard) | yes | yes | no | no | — |
| **(a) NS-rank + BK coords** | yes | yes (hard) | yes | yes | **yes (NS)** | partial (BK; hull-pack still needed) | **LOW** (NS ranker in-repo) |
| **(b) constraint stress** | yes (GPU 10K, Wang'17) | soft only | **no** (unless heavy align) | **no** | **yes** | **yes** | HIGH (new engine) |
| **(c) orthogonal/HOLA** | sparse-biased | no | no | partial | routing-yes/layout-no | n/a | VERY HIGH |
| **(d) recursive compound** | yes | yes | yes | yes | no (hierarchy issue) | no | MED |

---

## 4. VERDICT (ranked)

1. **Fix the two bespoke stages (a).** Robustness HIGH (literature-standard, deterministic, drop-in to the existing rank→order→coord→pack pipeline). Fit HIGHEST (keeps columns, containment, hard upward-flow, reproducibility). Cost LOWEST — the NS ranker already exists in-repo as `pipelineColumnPacking:"shorten"` (Gansner-exact, default-off; confirmed via graphify). **This converges with the 13-agent synthesis reached from the opposite direction:** synthesis #1 (targeted guard-gated X-shift operator), #2 (NS candidate generator), #5 (BK-class Y-alignment). My construction-level read independently lands on the same prescription — strata is the right family, NS + BK are the minimal robust change, applied _targeted_ not blanket.
2. **Constraint layer (b).** The most _principled_ dissolution of P1–P5 and plausibly the most robust-of-_result_ (no fragile stage-ordering to create P5). Demoted only on fit/cost, not on correctness. A _targeted_ VPSC pass (place the over-ranked sinks under directional+separation constraints, freeze the rest) is the pragmatic middle path — and is essentially what synthesis #1 already approximates without a full cola engine.
3. **Different construction (c).** Avoids P1–P5 by discarding the column/flow metaphor strata is built on. Not worth it; harvest only the orthogonal _routing_ idea (synthesis #4).

**Single key citation for the verdict:** Gansner, Koutsofios, North, Vo, "A Technique for Drawing Directed Graphs," IEEE TSE 19(3):214–230, 1993 (`gansner-tse93`) — network-simplex rank is the exact edge-length-minimising replacement for rankSeparate's longest-path maximisation, and Brandes–Köpf GD 2001 (`elk-10-1007-3-540-45848-4-3`) is the coordinate stage.

---

## SELF-ADVERSARIAL — why my preferred (a) might be WORSE than strata in practice

1. **[RETRACTED / CORRECTED — see addendum.]** My original text here conflated three distinct measurements and mislabeled the built NS. Corrected: (i) `pipelineColumnPacking:"shorten"` IS rank-NS (§2.3), and its "−8.4% width, small crossings increase" figure is the **RCLL-view** result — modest, not harmful. (ii) The "+176…+215 cr, ×4.3 height" catastrophe is a _different_ thing: the **strata** view with rankSeparate turned OFF (blanket swap), i.e. losing the −42% height lever, not rank-NS-the-algorithm's fault. (iii) Decisively, the sophisticated targeted rank-NS — the **joint constrained NS** (Gansner's constraint-edge device, separation as zero-weight edges) — was **built and measured on the exact frozen preset** and is a **NO-GO** (`docs/strata-view-w5b-joint-ns-probe.md`): it hits its length objective (−6.4% real span), holds height, yet regresses every path-readability metric because span compression densifies columns. So my claim "targeted-NS is untested / nobody has demonstrated it" was **wrong** — it is tested and is a principled NO-GO. This does not rescue rank-NS; it _buries_ it, and correctly redirects the fix to the targeted X-shift OPERATOR (synthesis #1), which moves a single degree-1 sink without re-solving (and thus without densifying) any column.
2. **BK's core assumption is violated by strata's substrate.** BK assumes one vertex per layer-slot with alignment blocks. strata uses **shared Y-bands and packed hulls** — multiple units share rows, and hulls are packed by dropY. BK aligns _nodes_; it does **not pack hulls**, so it cannot replace dropY — it replaces only intra-rank X, leaving P5's hull-height problem unsolved and possibly worse (synthesis #5 flags BK-on-banded-rows as unverified, needing a spike). So (a) fixes P1/P3/P4 but P5 needs a _separate_ height-gated packing change regardless — (a) is not the whole fix it sounds like.
3. **(a) inherits the objective risk.** (a) assumes the objective is fine and only the stages/search are wrong (synthesis's thesis). But the prior objective-audit found the objective mis-specified (infinite exchange rate; penetration fungible 1:1 with crossings; scored on pre-A7 geometry). If that is right, NS+BK just hand a _broken objective_ higher-quality candidates to pick wrongly from — the silly layouts could persist for a different reason.
4. **The constraint layer (b) may be MORE robust than I ranked it — I could be demoting it wrongly.** P5 is a _pure artifact of stage sequencing_ (rank→pack derives Y from X). A single stress+constraint solve has **no stage coupling to go wrong**; it cannot produce a P5-class pathology at all. My placement of (b) below (a) is a cost/fit judgment (loses columns, non-deterministic), not a robustness-of-result judgment. On result-robustness alone, cola plausibly wins, and a reviewer who weights "never regress" over "keep the grid" should flip my ranking. I am reporting this as a genuine residual, not smoothing it.

**Net self-assessment (revised post-W5b):** (a) is the right first move, but its _rank-NS leg is already spent_ — the joint constrained NS spike has been run on this exact preset and is a NO-GO, so the surviving content of (a) is the **targeted X-shift operator + BK coords, keeping rankSeparate**. BK remains unverified on banded rows and the objective risk is still inherited (both real residuals). My earlier "escalate to constraint layer (b) if targeted-NS fails" is **retracted**: the constraint-inside-rank experiment (joint NS = separation as zero-weight constraints) has _already_ been the escalation, and it failed for a reason intrinsic to the rank-span objective, not to stage-coupling — so a full constraint layer optimizing the same objective is not the obvious exit. Point 4's stage-coupling argument (a joint X+Y solve cannot produce a P5-class pathology) still stands as the one genuine reason to keep (b) alive, but only in the specific form of a solve that exploits _perpendicular (Y) slack_ — which is what the X-shift operator already does surgically and cheaply. The honest ranking is now: X-shift operator (a′) ≫ BK coords ≫ everything else; rank-NS and blanket constraint-layer are both demoted below where I first put them.

---

## MISSING PAPERS (full citations; absence-from-rag checked)

Verified present (so NOT missing): Gansner TSE93 `gansner-tse93`; Brandes–Köpf GD 2001 `elk-10-1007-3-540-45848-4-3` + Erratum; IPSep-CoLa `dwyer-ipsep-cola`; Dig-CoLa `openalex-10-1109-infvis-2005-1532130`; SetCoLa `forward-10-1111-cgf-13440`; Topology-preserving cola `doi-10-1007-978-3-642-00219-9-22`; Wang'17 GPU stress `doi-10-1109-tvcg-2017-2745919`; ELK `s2-10-48550-arxiv-2311-00533`; Sugiyama 1981 (present); GLEE/Nachmanson (present); STRATISFIMAL `forward-10-31219-osf-io-qdyt9`.

Genuinely ABSENT (checked, not surfaced):

1. **Kieffer, S., Dwyer, T., Marriott, K., Wybrow, M. (2016). "HOLA: Human-like Orthogonal Network Layout." IEEE TVCG 22(1):349–358. DOI 10.1109/TVCG.2015.2467451.** — the charter's named HOLA reference. Confirmed absent: HOLA queries return only the 2026 successor ARCOL (`arxiv-2603-29618v1`) and the Hegemann–Wolff orthogonal pipeline (`arxiv-2309-01671v2`), never HOLA itself. Should be harvested to properly evaluate alternative (B).

2. **Wybrow, M., Marriott, K., Stuckey, P. (2006). "Incremental Connector Routing" / libavoid orthogonal connector routing.** Not surfaced. Relevant to synthesis #4 (penetration-by-routing) — the production-grade orthogonal edge router that would kill pierces without changing the construction. Worth harvesting as the concrete routing tool behind the "steal routing not layout" recommendation.

(Both are additive; neither changes the verdict, which rests on papers already in the corpus.)
