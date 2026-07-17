# Owner decisions — strata overnight run (2026-07-17)

Resolved with the owner after the run. These drive a follow-up implementation round (not yet built).

## Default-config changes (the new strata default becomes)
| Option | Decision | Notes |
|---|---|---|
| `strataTranspose` | **default ON** | −24% crossings, envelope-preserving; owner accepted the ~13s rescore cost (B1 mitigates). |
| `strataSift` | **default ON** | −35% global crossings; owner's 3 named cases still need a tuning follow-up. |
| `strataPackedScoring` | **default ON** | B1 removed the cost objection. |
| `strataRankSeparate` | **default OFF** | Mutually exclusive with packedScoring (below); packedScoring is the chosen default. |
| **rankSeparate × packedScoring** | **MUTUAL EXCLUSION** | Enabling either auto-disables the other. Valid states: off/off, on/off, off/on — never on/on. Encode in the dependency-rule table; UI enforces. |
| `strataPackedScoringEpsilon` | **keep ε=1** | S1-1 fix (merged, A3) makes ε=1 behave correctly. |
| `pipelinePrivateApiRegional` | **always ON, REMOVE the toggle** | Private APIs are always regional. Delete the UI control; parser keeps accepting legacy param as inert. Re-freeze the measurement config at this default. |
| `strataTransitiveAdopt` + `strataPackedConverge` | **REMOVE both entirely** | Byte-identical no-ops (transitiveAdopt wastes ~8.6s/layout). Parser keeps accepting legacy values as inert no-ops for old URLs. |
| `strataEdgeRouting` | **advanced-only** | Niche +192cr/−140pierce trade (SDEC-61 closed-adverse); keep in advanced=1 disclosure. |

## UI
- **Approve hybrid A+B; WIRE the panel** to the registry/dependency-rule table. Declutter 18 controls → ~6–9 visible decisions + `advanced=1` escape hatch. (Track C shipped the backbone; this wires it.)

## Edge-collapse (Q11)
- **Guard + tripwires now.** Keep the merged P0 guard as the headless measurement filter; land `Number.isFinite` tripwires on the connector-point path (`repairTerraformEdgeBindings`/orbit-route) so the next occurrence is instantly localizable. Defer the full instrumented flip-hunt unless it recurs or blocks work.

## CRITICAL implementation caveat (must do before committing the default flips)
The owner flipped **transpose + sift + packedScoring all default-ON simultaneously**. These were measured largely independently and under collapse-contaminated conditions. Before committing the default changes:
1. Validate the **combined default-on stack** collapse-filtered headless (arm-eval, healthy-hash only) AND in the **browser** (source of truth) — flipping defaults is user-facing and the interactions were never jointly tested.
2. Confirm the mutual-exclusion + removals compose (legacy URLs still parse; canonical-URL pin updated deliberately since the DEFAULT geometry now changes — the pin + baselines get regenerated with justification).
3. Same rigor as the run: Opus implements, Fable + Codex adversarial judge pair, keep-if-green.
