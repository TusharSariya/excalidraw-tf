# W5 Track C — empirical effect matrix (option-surface simplification)

Generated 2026-07-17 12:26 against http://localhost:3001/api/terraform-layout.

Method: single-toggle A/B flips through the proof API; serial requests; geometry compared by visible-only `geometryHash` plus edge-inclusive `edgeGeometryHash`; rendered metrics measured over revealed dataflow edges (headless import pins edge layers off — fixed this run, commit 17bd203f3; before it crossings/pierce were structurally 0 for every request).

## Context P2-audit — preset `staging-extended-localstack-v2`

Baseline: crossings=71 pierce=28 topoFrames=14 h=16796 w=12783 elements=7962 arrows=207 wallMs=125848 deterministic-repeat=True

| flip | hash | edgeHash | dCross | dPierce | dTopoFr | dH | dW | dElems | dWallMs | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compact=1 | CHG | CHG | +20 | -2 | 0 | -944 | -1853 | -4063 | -6956 | MATERIAL |
| ancillary=0 | CHG | CHG | -6 | 0 | 0 | -8578 | 0 | -3141 | -5149 | MATERIAL |
| privateApiRegional=0 | CHG | CHG | +19 | -1 | 0 | -942 | +2051 | 0 | -15834 | MATERIAL |
| strataNsRank=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1510 | NO-EFFECT |
| strataCoordRefine=0 | CHG | CHG | +24 | +1 | 0 | -86 | 0 | 0 | +1283 | MATERIAL |
| strataRankSep=0 | CHG | CHG | -5 | -19 | 0 | +10180 | -2873 | 0 | -1655 | MATERIAL |
| strataPackedScoring=0 | CHG | CHG | +67 | -2 | 0 | -1985 | 0 | -1067 | -119152 | MATERIAL |
| strataEdgeRouting=1 | same | CHG | +18 | -13 | 0 | 0 | 0 | 0 | -1044 | MATERIAL |
| strataBorderRoute=1 | same | CHG | +2 | 0 | 0 | 0 | 0 | 0 | -488 | MATERIAL |
| strataSift=0 | CHG | CHG | +66 | -2 | 0 | +158 | 0 | 0 | -36673 | MATERIAL |
| strataPackedConverge=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -186 | NO-EFFECT |
| strataTransitiveAdopt=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -8580 | NO-EFFECT |
| strataBlockClamp=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -3229 | NO-EFFECT |
| strataTranspose=0 | CHG | CHG | +18 | 0 | 0 | 0 | 0 | 0 | -3698 | MATERIAL |
| strataHeightGate=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -5243 | NO-EFFECT |
| strataSweeps=0 | CHG | CHG | +50 | -2 | 0 | -2035 | 0 | -1067 | -119912 | MATERIAL |
| strataPackedEps=0 | CHG | CHG | -15 | -2 | 0 | 0 | 0 | 0 | -6839 | MATERIAL |
| strataPackedEps=2 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -6208 | NO-EFFECT |
| strataBandDepth=account | CHG | CHG | +12 | -18 | 0 | +9634 | 0 | -756 | -20133 | MATERIAL |
| strataDeBand=none | CHG | CHG | +67 | +25 | +19 | +3378 | +2226 | +19 | -93208 | MATERIAL |

## Context P2-default — preset `staging-extended-localstack-v2`

Baseline: crossings=273 pierce=226 topoFrames=38 h=19066 w=8038 elements=1333 arrows=169 wallMs=337 deterministic-repeat=True

| flip | hash | edgeHash | dCross | dPierce | dTopoFr | dH | dW | dElems | dWallMs | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compact=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -48 | NO-EFFECT |
| ancillary=1 | CHG | CHG | -26 | +9 | 0 | +17381 | 0 | +2590 | -30 | MATERIAL |
| privateApiRegional=1 | CHG | CHG | -21 | -87 | -5 | -1955 | 0 | -5 | -48 | MATERIAL |
| strataNsRank=1 | CHG | CHG | -78 | +13 | 0 | 0 | -28 | 0 | -66 | MATERIAL |
| strataCoordRefine=1 | CHG | CHG | -1 | 0 | 0 | 0 | 0 | 0 | -65 | MATERIAL |
| strataRankSep=1 | CHG | CHG | +49 | -86 | 0 | -5305 | +6860 | 0 | -78 | MATERIAL |
| strataPackedScoring=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -58 | NO-EFFECT |
| strataEdgeRouting=1 | same | CHG | +192 | -140 | 0 | 0 | 0 | 0 | -64 | MATERIAL |
| strataBorderRoute=1 | same | CHG | -3 | 0 | 0 | 0 | 0 | 0 | -55 | MATERIAL |
| strataSift=1 | CHG | CHG | -10 | 0 | 0 | 0 | 0 | 0 | -53 | MATERIAL |
| strataPackedConverge=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -61 | NO-EFFECT |
| strataTransitiveAdopt=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -76 | NO-EFFECT |
| strataBlockClamp=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -62 | NO-EFFECT |
| strataTranspose=1 | CHG | CHG | -143 | -166 | 0 | 0 | 0 | 0 | +29 | MATERIAL |
| strataHeightGate=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -59 | NO-EFFECT |
| privateApiRegional=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -76 | NO-EFFECT |
| strataSweeps=4 | CHG | CHG | -137 | -104 | 0 | 0 | 0 | 0 | -56 | MATERIAL |
| strataPackedEps=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -73 | NO-EFFECT |
| strataPackedEps=2 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -64 | NO-EFFECT |
| strataBandDepth=root | CHG | CHG | +6 | +2 | 0 | -627 | 0 | 0 | -82 | MATERIAL |
| strataDeBand=vpc | CHG | CHG | -84 | -180 | -24 | -7352 | -84 | -24 | -63 | MATERIAL |

## Context P1-default — preset `staging-localstack`

Baseline: crossings=39 pierce=69 topoFrames=22 h=12106 w=7046 elements=735 arrows=85 wallMs=1259 deterministic-repeat=True

| flip | hash | edgeHash | dCross | dPierce | dTopoFr | dH | dW | dElems | dWallMs | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compact=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1112 | NO-EFFECT |
| ancillary=1 | CHG | CHG | -6 | -6 | 0 | +7060 | 0 | +1316 | -1081 | MATERIAL |
| privateApiRegional=1 | CHG | CHG | -13 | -20 | -4 | -1261 | 0 | -4 | -1105 | MATERIAL |
| strataNsRank=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1100 | NO-EFFECT |
| strataCoordRefine=1 | CHG | CHG | 0 | 0 | 0 | 0 | 0 | 0 | -1108 | COSMETIC |
| strataRankSep=1 | CHG | CHG | +86 | -29 | 0 | -4491 | +1432 | 0 | -1089 | MATERIAL |
| strataPackedScoring=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1109 | NO-EFFECT |
| strataEdgeRouting=1 | same | CHG | +97 | -40 | 0 | 0 | 0 | 0 | -1106 | MATERIAL |
| strataBorderRoute=1 | same | CHG | -2 | 0 | 0 | 0 | 0 | 0 | -1111 | MATERIAL |
| strataSift=1 | CHG | CHG | 0 | 0 | 0 | 0 | 0 | 0 | -1093 | COSMETIC |
| strataPackedConverge=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1113 | NO-EFFECT |
| strataTransitiveAdopt=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1111 | NO-EFFECT |
| strataBlockClamp=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1115 | NO-EFFECT |
| strataTranspose=1 | CHG | CHG | -2 | -53 | 0 | 0 | 0 | 0 | -1088 | MATERIAL |
| strataHeightGate=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1114 | NO-EFFECT |
| privateApiRegional=0 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1110 | NO-EFFECT |
| strataSweeps=4 | CHG | CHG | 0 | -8 | 0 | 0 | 0 | 0 | -1097 | MATERIAL |
| strataPackedEps=1 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1094 | NO-EFFECT |
| strataPackedEps=2 | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1113 | NO-EFFECT |
| strataBandDepth=root | same | same | 0 | 0 | 0 | 0 | 0 | 0 | -1113 | NO-EFFECT |
| strataDeBand=vpc | CHG | CHG | -22 | -66 | -16 | -5515 | -84 | -16 | -1114 | MATERIAL |

## Shortlists

### (a) No measurable effect in BOTH contexts (removal/hide candidates)

- `strataBlockClamp`
- `strataHeightGate`
- `strataPackedConverge`
- `strataTransitiveAdopt`

### (b) Effect only in the audit context (merge/gate candidates — effect requires other toggles on)

- `compact` — inert alone (P2-default), active in audit config
- `strataPackedEps` — inert alone (P2-default), active in audit config
- `strataPackedScoring` — inert alone (P2-default), active in audit config

### Effect only in the DEFAULT context (audit config masks it)

- `strataNsRank`

### (c) Audit inert-toggle claims — empirical check

- heightGate-alone inert: CONFIRMED (P2-default `strataHeightGate=1`) — and STRONGER than claimed: heightGate is also inert inside the full audit config (P2-audit `strataHeightGate=0` — byte-identical geometry).
- converge@eps0 inert: CONFIRMED (P2-default `strataPackedConverge=1`) — and STRONGER: converge is inert even at eps=1 with packedScoring on (P2-audit `strataPackedConverge=0` — byte-identical geometry).
- Bonus: `strataBlockClamp` inert in both contexts (consistent with its documented null result) and `strataTransitiveAdopt` inert in both contexts while COSTING ~8.6s of compute in the audit config (pure overhead).

## Notable findings

- **Wall-time attribution (audit config, 125.8s baseline)**: disabling packedScoring −119.2s, sweeps 4→0 −119.9s (the packed-scoring sweep machinery is the entire budget; these two overlap), deBand vpc→none −93.2s, sift off −36.7s, bandDepth root→account −20.1s, privateApiRegional off −15.8s, transitiveAdopt off −8.6s (with zero geometry change), heightGate off −5.2s (zero change), blockClamp off −3.2s (zero change).
- **`strataPackedEps` is sharp**: in the audit config eps 1→2 is byte-identical, while eps 1→0 changes geometry and IMPROVES crossings (−15). The eps ladder above 1 does nothing here.
- **`compact` is gated on `ancillary`**: inert alone on both presets (nothing to collapse), −4063 elements inside the audit config.
- **`strataNsRank` (URL-only) is masked by the audit config**: alone on P2-default it is the single biggest crossing lever (−78), inert on P1-default, byte-identical inside the audit config.
- **`privateApiRegional` API default is OFF headless**: explicit `=0` is a no-op in default contexts, while `=1` is MATERIAL (−87 pierce on P2-default). Note the app/UI defaults it ON for strata — the proof-API default context is NOT the app default.
- **`strataEdgeRouting` trades crossings for pierce** (+192 crossings / −140 pierce on P2-default): box geometryHash unchanged — only the new edge-inclusive `edgeGeometryHash` catches it (same for borderRoute).
- **Surprising coupling**: flipping packedScoring or sweeps off in the audit config changes elementCount by −1067 — packed geometry feeds back into the ancillary allocator (right-slack placement), not just positions.
- **P1 spot-check divergences**: `strataCoordRefine` and `strataSift` are COSMETIC on P1-default (hash changes, all metric deltas 0); `strataBandDepth=root` is a full NO-EFFECT on P1-default but MATERIAL on P2 — several levers are preset-dependent, so removal decisions should weigh P2 (the extended preset) over P1.
- **Metrics blindness fixed this run**: before commit `17bd203f3` every crossings/pierce number the proof API returned was structurally 0 (edge layers pinned off headless ⇒ TFD arrows soft-deleted ⇒ diagnostics saw no arrows). Any earlier overnight conclusions drawn from proof-API crossings/pierce should be re-checked.
