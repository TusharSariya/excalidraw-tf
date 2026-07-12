# Strata S0b frozen baselines

Canonical frozen Q2 audit JSON copies referenced by [`rcll-v2-spec-v3.1.md`](../rcll-v2-spec-v3.1.md) §12. The v2 substrate stays byte-identical under D2′, so these are re-derivable; the JSONs here are the canonical frozen copies.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current — frozen S0b baselines (C11) |
| Hub | [`../rcll-strata-doc-index.md`](../rcll-strata-doc-index.md) |
| Parent | [`../rcll-v2-spec-v3.1.md`](../rcll-v2-spec-v3.1.md) (§12) |
| Children | — |
| Sisters | — |
| Next (agent) | Use SHA-pinned JSONs for gate comparisons; do not re-derive from the engine under test. |

## Files

| File | Preset |
| --- | --- |
| `Q2_AUDIT_REPORT_P1.json` | staging-extended-localstack-v2 |
| `Q2_AUDIT_REPORT_P2.json` | staging-localstack |
| `Q2_AUDIT_REPORT_P3_MULTISTATE.json` | staging-multi-state-expanded |
| `Q2_AUDIT_REPORT_CYCLIC.json` | cyclic fixture |

## v3.2 frozen rows + gate register (R8-F3 repair)

Per [`rcll-v2-gate-family-v3.2-proposal.md`](../rcll-v2-gate-family-v3.2-proposal.md) §3: gate comparisons **load** frozen row artifacts — they never rebuild the baseline from current code.

| File | Contents |
| --- | --- |
| `V32_ROWS_P1_COMPACT.json` / `V32_ROWS_P2_COMPACT.json` | Per-arm frozen rows (A_v2_baseline + G/H/I/J candidate snapshots): slice-B per-edge extents, per-path M-RT rows (k/con/cr/tll/br/rtHat), scene scalars (crossings, crossing angles) |
| `V32_BASELINE_MANIFEST.json` | SHA-256 pin per artifact + provenance |
| `gateRegister.json` | Cell → claimed status ∈ PASS / PARITY / **FAIL-WAIVED** / REPORT, with adjudication + evidence refs (initial entries recorded from the W5 battery) |

**Semantics:** `FAIL-WAIVED` is a legal, auditable owner override of a computed FAIL (the SDEC-47/53-style arm-E overrides, made explicit). Relabeling a computed FAIL as PASS — or leaving a stale waiver on a cell that now passes — is a **red build**: `terraformPipelineStrataGateRegister.test.ts` (always-on, milliseconds — pure math over these JSONs) asserts every manifest SHA and recomputes every register cell's verdict from the frozen rows.

**Regen:** `STRATA_FREEZE_REGEN=1 yarn vitest run packages/excalidraw/components/terraformPipelineStrataFreezeBaselines.test.ts --exclude "**/.claude/**"`. Candidate arms are snapshots of the engine at the recorded revision, so after any engine change: regen the artifacts **and re-adjudicate `gateRegister.json`** in the same change.
