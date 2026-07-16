# Strata view — W15 band-depth slider (banded/packed generalized into one monotone cut)

**Date:** 2026-07-13/14 · **Status:** BUILT+RUN — a shipped feature milestone (not a battery/measurement report; no gate, no threshold). Scene output at the default cut (`"account"`) is **byte-identical** to the pre-change layout. Branch `strata-v3.2-w5-w10b`; unpushed pending owner push.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Companion |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-69; [`strata-view-w10b-band-compact-battery.md`](./strata-view-w10b-band-compact-battery.md) (this milestone generalizes the `strataBandCompact` lever that W10b shipped and battery-tested) |
| Sisters | [`strata-view-w14-browser-felt-cost.md`](./strata-view-w14-browser-felt-cost.md) |
| Next (agent) | None open in this doc; the three W10b adjudications (BC promotion / W7 waiver / ε default) remain the owner's next Strata decision, now informed by the two owner flags in §5 |

## 1. Context

The Strata layout engine places each nested container ("hull") using one of two policies for its direct children: `banded` (full-width stack, one row per child) or `packed` (skyline `dropY`, so X-disjoint siblings share a Y-row). Before this milestone the policy was a fixed role→map, `STRATA_HULL_POLICY` (`terraformPipelineStrataTypes.ts`): root/provider/account = banded, region/vpc/subnetZone = packed. That map was already a **monotone step function** — banded for the first three roles, packed for the last three — i.e. a single cut sitting between `account` and `region`. A separate default-off boolean, `strataBandCompact` (shipped W10/W10b, SDEC-63/64), moved that cut one notch left (provider/account → packed) but **only for placement geometry** — A7 coordinate refinement and slice-metrics diagnostics had their own independent `bandCompact`-aware special-cases that had to be kept in sync by hand.

`banded` and `packed` are the same skyline algorithm with the horizontal-overlap test toggled. So the two policies plus the boolean were really **one parameter**: where along the depth order root → provider → account → region → vpc → subnetZone does banding stop and packing begin. This milestone replaces the fixed map + the `strataBandCompact` boolean with a single monotone cut `strataBandDepth` (the deepest banded role), surfaced as a real slider ("banded ← … → packed"). Default `"account"` is byte-identical to the pre-change layout.

## 2. Owner decisions (this session, plan `alright-we-are-implementing-imperative-axolotl`)

- **Fully-generic model, no special-casing.** The cut resolves into `hull.policy` exactly once (`resolveStrataHullPolicy`, `terraformPipelineStrataTypes.ts`), and _every_ consumer — A0 placement, A7 coordinate refinement, A2 sibling ordering, packed-scoring eligibility, slice-metrics diagnostics — reads that one resolved policy. A packed level is packed for everything, exactly like region/vpc/subnetZone always were; there is no `usesLegacyPackedOrdering`-style predicate anywhere in the consumer set. The rejected alternative was parity-preserving: keep `bandCompact` as a narrow special-case boolean threaded alongside the map so provider/account "look packed" for placement only, without touching A2 ordering or packed-scoring eligibility. The owner chose to **delete** the special-casing rather than add a third policy value next to it.
- **Root pinned banded.** The one structural exception (multi-provider seam, spec v3.1 §1.4): packing root would collapse top-level providers side-by-side and destroy the seam. Root is banded like any banded level; the slider's leftmost stop is "only root banded," and all-packed is unrepresentable.
- **Real range slider, not segmented buttons.** `<input type="range" min=0 max=5 step=1>` with a "banded ← → packed" axis caption and a Root…Zone tick row. Codex's plan review flagged that a RadioGroup does not wrap gracefully at 6 stops; rather than work around the wrap, the owner chose a real slider, which also better matches the "one monotone cut" mental model than discrete buttons.
- **Accepted cost, registered before build:** `strataBandCompact=true` output _changes_ at the leftmost cut — provider/account gain packed A2 ordering and packed-scoring eligibility (SDEC-57/58), neither of which the old boolean touched. Acceptable because `bandCompact` is off-by-default (nothing shipped-by-default moves) and the real compatibility guarantee — default `"account"` byte-identical to today — holds by construction, not by parity-preservation of the legacy toggle's exact old behavior.

## 3. Data model

- `StrataHullRole` (already depth-ordered: root < provider < account < region < vpc < subnetZone) is reused as the cut type. `strataBandDepth?: StrataHullRole` was added to `StrataEngineOptions`.
- One resolver, one home (`terraformPipelineStrataTypes.ts`, importing the role enum — the defaults module cannot host it under the no-layout-import rule):
  ```ts
  const STRATA_ROLE_DEPTH: Record<StrataHullRole, number> = {
    root: 0,
    provider: 1,
    account: 2,
    region: 3,
    vpc: 4,
    subnetZone: 5,
  };
  export const resolveStrataHullPolicy = (role, bandDepth): StrataHullPolicy =>
    STRATA_ROLE_DEPTH[role] <= STRATA_ROLE_DEPTH[bandDepth]
      ? "banded"
      : "packed";
  ```
  `resolveStrataHullPolicy(role, "account")` reproduces `STRATA_HULL_POLICY` element-for-element (the map stays exported as the default-cut constant and the slice-metrics fallback; a dev test pins map ≡ resolver at `"account"`).
- **Alias fold-in:** `strataBandCompact === true ⇒ strataBandDepth: "root"`, but only when the enum is absent — an explicit `strataBandDepth` always wins. Encoded once in `resolveStrataDemoOptions` and once in the app-layer extraction in `terraformPipelineStrata.ts`.

## 4. Build (dependency order, 9 commits `a79028054`..`25fc2eb0a`)

Built by 5 sequential subagents, Fable-orchestrated: opus for engine-correctness work packages, sonnet for foundation/threading/UI/docs. **Codex gpt-5.6-sol (medium effort) adversarially reviewed after every agent's commit**, not batched at the end.

1. **`a79028054` WP1 — resolver + option field.** `resolveStrataHullPolicy` + `STRATA_ROLE_DEPTH` in `terraformPipelineStrataTypes.ts`; `strataBandDepth` added to `StrataEngineOptions` as optional (absent ⇒ treated as `"account"`, so existing engine-test literals stay byte-identical). Codex: **CLEAN**.
2. **`4694b8ea2` WP2 — cut drives hull policy end-to-end; collapse bandCompact special-cases.** `terraformPipelineStrataModel.ts`: the cut threads into `buildStrataHullTree`, and both static-map stamps (root, and all other roles) are replaced by `resolveStrataHullPolicy(role, bandDepth)`. The static-map equality throw is deleted; in its place, a cut-driven monotonicity invariant asserts root always resolves banded and no banded hull nests under a packed ancestor. `terraformPipelineStrataPlacement.ts` (A0): the `bandCompactHull` predicate and its reclaim-diagnostic plumbing are removed — the skyline branch now fires on `hull.policy === "packed"` alone, and the packed-scoring candidate gate (already keyed on `hull.policy === "packed"`) now legitimately covers deep-cut provider/account, which is the intended fully-generic behavior. `terraformPipelineStrataCoordRefine.ts` (A7): `policy === "packed" || (bandCompact && role !== "root")` collapses to `policy === "packed"`; the `bandCompact` param is dropped from `buildRefHull` and its entry point. A2 sibling ordering already selected its objective from `hull.policy`, so it needed no change — it inherits the fully-generic behavior automatically. Alias fold-in encoded once each in `resolveStrataDemoOptions` and the `terraformPipelineStrata.ts` extraction. Codex: **2 findings** — P2 test-circularity (folded as `c4eb4a586`, WP2-P2, below), P3 stale help copy (deferred to the WP5 UI pass, where it was addressed).
3. **`c4eb4a586` WP2-P2 — pin default-cut byte-identity guard.** A spyOn test asserts the default engine options object carries **no** `strataBandDepth` key, closing the circularity codex flagged (a naive test could compare the resolver's output against itself rather than against the pre-change static map).
4. **`af0030860` WP3 — slice-metrics reads resolved policy via a conditional frame stamp; fixes two static-map desyncs.** `terraformPipelineSliceMetrics.ts` runs on the built scene's `elements`, so it has no `hull.policy` to read directly. Two desyncs existed: the A/B slice classification read `STRATA_HULL_POLICY[roleForPathLength(...)]` directly, and the stacked-band-height computation hardcoded depths 0–2 (root/provider/account) instead of consulting policy at all — this second one is the desync codex's plan review found, not the original plan author. Fix: `customData.terraformHullPolicy = hull.policy` is stamped on emitted hull frames in `terraformPipelineStrataSceneBuild.ts`, but **only when `bandDepth !== "account"`**, so default-cut frame customData stays byte-identical. Both slice-metrics readers prefer the stamp when present and fall back to the static map when it's absent (i.e., at the default cut). Codex: **1 finding**, P3 (stamp-absence test), folded in the WP2-adjacent hardening pass.
5. **`d74a1a75a` WP4 — thread `strataBandDepth` through url/session/scene seams + alias.** Following the `strataSweeps` threading template (not the focus-hops template — string enum, not a domain-validated integer): demo-URL enum parse+emit (explicit emission, never truthy-gated, keeping the legacy `strataBandCompact` key readable for old links), `LayoutSceneContext` field plus **both** the `sceneContext` literal and the `builderOptions` literal in `terraformLayoutCore.ts` (the two required hops — this is the seam where an earlier milestone's option got silently dropped, see `docs/rcll-strata-doc-index.md`'s "RCLL option threading boundary" precedent), `terraformSceneApply.ts`, `terraformImportSession.ts`, `terraformPresetImport.ts`, `terraformPlanParsing.tsx`, `terraformCanvasShareUrl.ts`, and the `terraformPipelineStrata.ts` extraction/alias/flagMeta/engineOptions mapping.
6. **`387131235` WP4-P1/P2 — forward strataBandDepth raw so the alias fires on all paths; no default key.** Codex's diff review on WP4 found two issues: (P1) forwarding the resolved/aliased value instead of the raw `strataBandDepth` at one seam meant the `bandCompact` alias silently didn't fire on that path; (P2) the byte-identity trap named in the plan — `"account"` is a truthy string, so a `&&`-truthy spread would still spread it into engine options and change the object's shape at the default cut, breaking the parity test. Both fixed: raw forwarding restored on the affected path, and the spread condition changed to `!== "account"`. Codex seam-completeness re-check: **CLEAN**.
7. **`aaecc0aa6` WP5 — band-depth slider UI replaces the compact-bands toggle.** `TerraformStrataSettings.tsx`: the 2-button `strataBandCompact` segmented control is replaced by a native `<input type="range" min=0 max=5 step=1>` mapped to the role at that depth, a Root…Zone tick row, and a "banded ← → packed" axis caption. `useTerraformImportDialog.ts`: the `strataBandCompact` `useState` is replaced by a `strataBandDepth` state seeded from `TERRAFORM_STRATA_LAYOUT_DEFAULTS`, with the forwarding call sites, session writer, and hook return/deps all updated. `TerraformImportDialog.tsx` pass-through and settings-panel prop types updated. All 6 stops are selectable (URL/session reproducibility); the deep three (region/vpc/subnetZone) carry an "experimental — usually wider" annotation. The reclaim note (attaches to deeper cuts, RS-coupled but not fully inert without RS) is relocated under the slider and reworded; one help line is mirrored into `TerraformImportPipelineSettings.tsx`. Codex: **1 finding**, P3 (slider clamp for out-of-range persisted values), folded in hardening.
8. **`2594253ae` — slider value guard + e2e default-cut stamp-absence test.** Clamps the slider's controlled value against the 6 valid stops (closing the WP5 P3 finding), and adds an app-path test that imports at the default cut and asserts no `terraformHullPolicy` frame stamp is present — the threading silent-drop guard for this milestone (mirrors the W14/W13 precedent of an app-path test as the only layer that catches an omission at the `sceneContext` literal).
9. **`25fc2eb0a` — bandCompact battery: slice-B-empty is expected for BC/root-cut arms.** The W10b `strataBandCompact` battery's slice-B-empty guard is updated to treat slice-B emptying for `_BC`/root-cut arms as an **expected characterized delta** of the fully-generic model (§5), not a regression to investigate.

## 5. Owner flags (recorded prominently — consequences of the fully-generic choice)

1. **`strataBandCompact=true` output CHANGED.** Under the fully-generic model, the legacy boolean now aliases to the root cut, so provider/account become genuinely packed for every consumer — not just placement. Their A2 sibling ordering switches to the packed objective, and they become eligible for the packed-scoring optimizer (SDEC-57/58, whose W7 default-on-vs-off waiver is itself still an open owner adjudication). The lever is off-by-default, so nothing shipped-by-default moved as a result of this milestone. But anyone (or any battery) invoking `strataBandCompact=true` gets materially different geometry than before this milestone landed.
2. **The bandCompact battery's slice-B measurement EMPTIES for the `_BC` arms.** Provider/account edges reclassify from slice-B to slice-A once those roles resolve to `"packed"` under the alias — this is a direct, mechanical consequence of flag 1. Confirmed via the battery re-run that **only** the `_BC` arms empty (on both P1 and P2), no default arm is affected. The battery is report-only (SDEC-63/64), so this doesn't break a gate, but the W10b battery's slice-B statistic for `_BC` arms is now **definitionally empty** under the new semantics — the guard (commit 9, above) was updated to expect this rather than flag it as a new finding. This interacts directly with the still-open W10b bandCompact-promotion adjudication (does `strataBandCompact` get promoted from off-default, and if so under which semantics): the slice-B evidence that adjudication would have leaned on for `_BC` arms no longer exists in the same form. Flagged for owner ruling; not resolved by this milestone.

## 6. Verification

- `yarn test:typecheck` green.
- Full strata + coordRefine + model + placement + ordering + threading + UI suite: **476 passed / 2 skipped**.
- BandCompact (W10b) battery green after the commit-9 characterized-delta update to its slice-B-empty guard.
- `yarn lint:arch` clean — no new import cycle (the plan's NaN-gotcha constraint, no module-level const imports from `terraformPipelineLayoutShared` in test-adjacent modules, was respected throughout).
- **Default byte-identity, pinned five independent ways:**
  1. `resolveStrataHullPolicy(role, "account")` ≡ old `STRATA_HULL_POLICY` element-for-element (codex-verified, commit 1/2).
  2. A spyOn test proving the default engine options object carries **no** `strataBandDepth` key (commit 3).
  3. An app-path e2e test proving **no** `terraformHullPolicy` frame stamp fires at the default cut (commit 8).
  4. A dialog test proving "back to Account" omits the key on the demo-URL/session round trip (commit 7/8 area).
  5. The gate-register and extent-gate real-build suites green with zero churn.

## 7. NOT changed / NOT in scope

The default layout (`"account"` cut ≡ prior `STRATA_HULL_POLICY` output, byte-identical). The M3 ancillary port (owner/Q7-gated). Q7 labeling. The three open W10b adjudications (BC promotion, W7 packedScoring default waiver, ε default) — this slider is an independent, default-`"account"` generalization of a previously off-by-default lever; it does not itself resolve any of the three, though flag 1/2 above bear directly on the BC-promotion adjudication's evidence base. Unpushed on `strata-v3.2-w5-w10b`; owner pushes with `git push origin strata-v3.2-w5-w10b --no-verify` (submodule first, per the standing push gotcha).

## Provenance

Dual research — Claude Plan agent + codex gpt-5.6-sol — converged independently on the fully-generic-vs-parity-preserving architectural fork; the owner chose fully-generic plus a real slider. Codex additionally found the second slice-metrics desync (the stacked-band-height hardcode, commit 4) and the RadioGroup non-wrap constraint at 6 stops, resolved here by using a range slider instead of engineering around the wrap. Both slice-metrics readers plus the model stamp/invariant are the only production readers of `STRATA_HULL_POLICY` (grep-confirmed in the source plan); `topologyRoleAndKeyFromPath` and `policyForContainer` are unrelated/RCLL-v1-only and were not touched.
