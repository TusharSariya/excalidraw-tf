/**
 * v3.1 §2.5 SLICE-B EXTENT GATE harness (WP-3e scope extension, M1b W3).
 * Report-emitting, Q2-style. Measurement/harness ONLY — this file owns NO
 * layout behavior and NEVER asserts gate outcomes; it emits the paired
 * per-edge bootstrap-CI table the orchestrator reads §12 gate decisions from.
 *
 * For each §12 gate cell it builds the baseline arm's scene and the candidate
 * arm's scene (clearTerraformImportPrepCache between builds), takes the
 * slice-B rows from computeSliceMetrics's ADDITIVE `perEdge` export, keys
 * them with the frozen §2.5 pairing key `canonicalEdgeKey(source, target,
 * relKind)` (true direction + relKind), and runs the pinned
 * `pairedBootstrapCi` (SEED 20260704, B=1000, percentile [2.5%, 97.5%]) on
 * the extent values, plus `bootstrapGatePolicy(n, degenerate)` and the paired
 * (matched-key) p50/p90 per arm.
 *
 * Cells (§12):
 *   P1 compact: A_v2_baseline        vs H_strata_k4 / I_strata_k4_a7
 *   P1 full:    F_v2_full_ancillary  vs H2_strata_k4_full / I2_strata_k4_a7_full
 *   P2 full:    F_v2_full_ancillary  vs H2 / I2
 *   P2 compact: EXCLUDED from gating (frozen §12 pin, nB=4) — computed and
 *               reported with reportOnly: true.
 *
 * IMPROVEMENT direction: extent DECREASE ⇒ paired delta (candidate−baseline)
 * < 0 ⇒ the gate passes iff the CI upper bound < 0
 * (`ciExcludesZeroImproving`). Reported, never asserted.
 *
 * Duplicate pairing keys (parallel edges with identical source/target/
 * relKind) collapse first-wins in perEdge-row order (deterministic) so a
 * keyed map can be built at all, and are counted per arm (`nDuplicateKeys*`)
 * — never silently dropped. FIX-2 (codex-review WP-3f) makes this a HARD
 * guarantee: if any duplicate pairing key appears in either arm's rows
 * feeding a comparison, that comparison's cell is forced `voided: true,
 * voidReason: "duplicate-pairing-keys"` with the offending `duplicateKeys`
 * listed — collapsing is still how the map gets built, but it can never
 * silently pass as a valid paired comparison.
 *
 * TEST ASSERTIONS = harness health only: per-arm perEdge/slice-B rows
 * nonempty, pairing n > 0 for every cell, unmatched fraction reported, NO
 * rcllV2Degraded on any strata arm (the full-mode arms REQUIRE the A6
 * satellite fix — hard fail if degraded), and determinism (the report cells
 * recomputed from the same arm data are byte-identical; one arm rebuilt from
 * scratch yields an identical keyed slice-B map).
 *
 * Run:
 *   Q2_REPORT_DIR=/tmp/a4 yarn vitest run packages/excalidraw/components/terraformPipelineStrataExtentGate.test.ts
 *
 * Writes EXTENT_GATE_REPORT.json to $Q2_REPORT_DIR (default: os tmpdir) —
 * same env convention as terraformPipelineQ2Audit.test.ts.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  BOOTSTRAP_B,
  BOOTSTRAP_N_B_FLOOR,
  BOOTSTRAP_N_B_MIN,
  BOOTSTRAP_SEED,
  BOOTSTRAP_UNMATCHED_VOID_FRACTION,
  bootstrapGatePolicy,
  canonicalEdgeKey,
  pairedBootstrapCi,
} from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  computeSliceMetrics,
  type SliceEdgeRow,
} from "./terraformPipelineSliceMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q2_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function emitReport(name: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(`${REPORT_DIR}/${name}.json`, json);
  // eslint-disable-next-line no-console -- probe output IS the deliverable
  console.log(`${name} written (${json.length} bytes)`);
}

// ── arms (same option bundles as the Q2 / A4-triple harnesses) ──────────────

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2_baseline: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  H_strata_k4: { layoutMode: "strata", pipelineCompact: true, strataSweeps: 4 },
  I_strata_k4_a7: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
  F_v2_full_ancillary: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: false,
    pipelineIncludeAncillary: true,
  },
  H2_strata_k4_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
  },
  I2_strata_k4_a7_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
};

const STRATA_ARMS: ReadonlySet<string> = new Set([
  "H_strata_k4",
  "I_strata_k4_a7",
  "H2_strata_k4_full",
  "I2_strata_k4_a7_full",
]);

/** §12 gate cells. `reportOnly` = the frozen P2-compact exclusion pin (nB=4);
 * the per-cell gatePolicy additionally derives its own reportOnly from n. */
type CellSpec = {
  preset: string;
  presetLabel: "P1" | "P2";
  mode: "compact" | "full";
  baselineArm: string;
  candidateArm: string;
  reportOnly: boolean;
};

const CELL_SPECS: CellSpec[] = [
  // P1 compact (gated)
  ...["H_strata_k4", "I_strata_k4_a7"].map((c) => ({
    preset: PRESET_1,
    presetLabel: "P1" as const,
    mode: "compact" as const,
    baselineArm: "A_v2_baseline",
    candidateArm: c,
    reportOnly: false,
  })),
  // P1 full (gated; strata full arms REQUIRE the A6 satellite fix)
  ...["H2_strata_k4_full", "I2_strata_k4_a7_full"].map((c) => ({
    preset: PRESET_1,
    presetLabel: "P1" as const,
    mode: "full" as const,
    baselineArm: "F_v2_full_ancillary",
    candidateArm: c,
    reportOnly: false,
  })),
  // P2 full (gated)
  ...["H2_strata_k4_full", "I2_strata_k4_a7_full"].map((c) => ({
    preset: PRESET_2,
    presetLabel: "P2" as const,
    mode: "full" as const,
    baselineArm: "F_v2_full_ancillary",
    candidateArm: c,
    reportOnly: false,
  })),
  // P2 compact — EXCLUDED from gating (frozen §12 pin, nB=4); report-only.
  ...["H_strata_k4", "I_strata_k4_a7"].map((c) => ({
    preset: PRESET_2,
    presetLabel: "P2" as const,
    mode: "compact" as const,
    baselineArm: "A_v2_baseline",
    candidateArm: c,
    reportOnly: true,
  })),
];

// ── per-arm scene build + slice-B extraction ─────────────────────────────────

type ArmData = {
  /** canonicalEdgeKey → extentPx, slice-B rows only (first-wins on duplicates). */
  sliceB: Map<string, number>;
  /** canonicalEdgeKey → extentPx over ALL resolved rows (any slice) — feeds
   * the SUPPLEMENTARY baseline-sliceB-vs-candidate-all pairing (see
   * computeCell): when the two engines disagree on slice classification the
   * primary slice-B∩slice-B pairing voids, and this variant answers "did the
   * SUBSTRATE's cross-band edges get shorter, wherever the candidate put
   * them". Report-only, never the frozen §2.5 primary. */
  allEdges: Map<string, number>;
  nPerEdge: number;
  nSliceB: number;
  nDuplicateKeys: number;
  nDuplicateKeysAll: number;
  /** Duplicate canonical keys within the slice-B rows (FIX-2). */
  duplicateKeysSliceB: string[];
  /** Duplicate canonical keys within the ALL-slice rows (FIX-2). */
  duplicateKeysAll: string[];
  unresolvedEdgeCount: number;
  rcllV2Degraded: unknown;
  elementCount: number;
};

function keyedExtents(
  perEdge: readonly SliceEdgeRow[],
  sliceFilter: "B" | "all",
): {
  map: Map<string, number>;
  duplicates: number;
  /** The distinct canonical keys that recurred (FIX-2, codex-review WP-3f):
   * collapsing stays first-wins (a keyed map needs SOME resolution), but the
   * offending keys are surfaced here so the cell computation can turn a
   * duplicate pairing key into a HARD void instead of a silent collapse. */
  duplicateKeys: string[];
  nRows: number;
} {
  const map = new Map<string, number>();
  const duplicateKeySet = new Set<string>();
  let duplicates = 0;
  let nRows = 0;
  for (const row of perEdge) {
    if (sliceFilter === "B" && row.slice !== "B") {
      continue;
    }
    nRows += 1;
    const key = canonicalEdgeKey(row.source, row.target, row.relKind);
    if (map.has(key)) {
      duplicates += 1; // first-wins, counted (never silently dropped)
      duplicateKeySet.add(key);
      continue;
    }
    map.set(key, row.extentPx);
  }
  return {
    map,
    duplicates,
    duplicateKeys: [...duplicateKeySet].sort((a, b) =>
      a === b ? 0 : a < b ? -1 : 1,
    ),
    nRows,
  };
}

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<ArmData> {
  clearTerraformImportPrepCache();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const slices = computeSliceMetrics(elements);
  const b = keyedExtents(slices.perEdge, "B");
  const all = keyedExtents(slices.perEdge, "all");
  return {
    sliceB: b.map,
    allEdges: all.map,
    nPerEdge: slices.perEdge.length,
    nSliceB: b.nRows,
    nDuplicateKeys: b.duplicates,
    nDuplicateKeysAll: all.duplicates,
    duplicateKeysSliceB: b.duplicateKeys,
    duplicateKeysAll: all.duplicateKeys,
    unresolvedEdgeCount: slices.populations.unresolvedEdgeCount,
    rcllV2Degraded: meta.rcllV2Degraded,
    elementCount: elements.filter((e) => !e.isDeleted).length,
  };
}

// ── cell computation (pure — determinism is checked by double-run) ──────────

/** Nearest-rank percentile (floor(n·q), clamped) — the slice-metrics family's
 * pinned convention. */
function percentileAt(sortedAsc: readonly number[], fraction: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  return sortedAsc[
    Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * fraction))
  ]!;
}

/** One paired comparison (CI + policy + matched-key percentiles) between two
 * keyed extent maps. Used for the frozen §2.5 PRIMARY (slice-B ∩ slice-B) and
 * for the SUPPLEMENTARY baseline-sliceB-vs-candidate-all variant.
 *
 * FIX-2 (codex-review WP-3f): `duplicatePairingKeys` is the union of any
 * canonical edge keys that recurred in EITHER arm's rows feeding this specific
 * comparison. A first-wins collapse is still needed to build a keyed map at
 * all, but a nonempty list here is now a HARD, visible void — never a silent
 * collapse — because a duplicate pairing key means the paired bootstrap CI is
 * being computed over an under-determined (key → value) resolution. */
function pairedComparison(
  baseline: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
  duplicatePairingKeys: readonly string[] = [],
) {
  const ci = pairedBootstrapCi({ baseline, candidate });
  const policy = bootstrapGatePolicy(ci.n, ci.degenerate);
  const hasDuplicates = duplicatePairingKeys.length > 0;

  // Paired (matched-key) per-arm percentiles, keys in code-unit order (C4′).
  const matchedKeys = [...baseline.keys()]
    .filter((k) => candidate.has(k))
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const baseVals = matchedKeys
    .map((k) => baseline.get(k)!)
    .sort((a, b) => a - b);
  const candVals = matchedKeys
    .map((k) => candidate.get(k)!)
    .sort((a, b) => a - b);
  const baseP50 = round2(percentileAt(baseVals, 0.5));
  const candP50 = round2(percentileAt(candVals, 0.5));
  const baseP90 = round2(percentileAt(baseVals, 0.9));
  const candP90 = round2(percentileAt(candVals, 0.9));

  return {
    nBaseline: ci.nBaseline,
    nCandidate: ci.nCandidate,
    n: ci.n,
    nUnmatched: ci.nUnmatched,
    unmatchedFraction:
      Math.min(ci.nBaseline, ci.nCandidate) > 0
        ? round4(ci.nUnmatched / Math.min(ci.nBaseline, ci.nCandidate))
        : 0,
    // FIX-2 hard guarantee: any duplicate pairing key forces this comparison
    // voided, regardless of what the bootstrap CI itself computed — never a
    // silent first-wins collapse.
    voided: hasDuplicates ? true : ci.voided,
    degenerate: ci.degenerate,
    status: hasDuplicates ? "void" : ci.status,
    ci: {
      point: round4(ci.point),
      lo: round4(ci.lo),
      hi: round4(ci.hi),
      width: round4(ci.width),
    },
    gatePolicy: policy,
    baseP50,
    candP50,
    baseP90,
    candP90,
    deltaP50: round2(candP50 - baseP50),
    deltaP90: round2(candP90 - baseP90),
    /** Improvement = extent decrease ⇒ gate passes iff CI hi < 0 (and the CI
     * is valid). Reported for the orchestrator — NEVER asserted here. */
    ciExcludesZeroImproving: !hasDuplicates && !ci.voided && ci.hi < 0,
    // Only present when a duplicate pairing key was found (preserves the
    // report shape for the zero-duplicate case, which is every cell today).
    ...(hasDuplicates
      ? {
          voidReason: "duplicate-pairing-keys" as const,
          duplicateKeys: [...duplicatePairingKeys],
        }
      : {}),
  };
}

function computeCell(spec: CellSpec, base: ArmData, cand: ArmData) {
  return {
    preset: spec.preset,
    mode: spec.mode,
    baselineArm: spec.baselineArm,
    candidateArm: spec.candidateArm,
    /** Frozen §12 pin (P2 compact excluded from gating) — independent of the
     * n-derived gatePolicy.reportOnly, both reported. */
    reportOnly: spec.reportOnly,
    nDuplicateKeysBaseline: base.nDuplicateKeys,
    nDuplicateKeysCandidate: cand.nDuplicateKeys,
    // The frozen §2.5 PRIMARY: baseline slice-B vs candidate slice-B.
    ...pairedComparison(base.sliceB, cand.sliceB, [
      ...base.duplicateKeysSliceB,
      ...cand.duplicateKeysSliceB,
    ]),
    /** SUPPLEMENTARY (report-only, NOT the frozen §2.5 primary): baseline
     * slice-B keys paired against the SAME edges' extents in the candidate
     * regardless of the candidate's slice classification. When the engines
     * disagree on classification (observed: v2 full+ancillary reclassifies
     * many edges to banded LCAs that strata keeps packed), the primary voids
     * on unmatched keys; this variant still answers whether the SUBSTRATE's
     * cross-band edges got shorter in the candidate layout. The candidate map
     * is RESTRICTED to the baseline's keyset so nUnmatched counts only
     * baseline slice-B edges genuinely absent from the candidate scene (not
     * the candidate's slice-A population). */
    supplementaryBaselineSliceBVsCandidateAll: pairedComparison(
      base.sliceB,
      restrictToKeys(cand.allEdges, base.sliceB),
      [...base.duplicateKeysSliceB, ...cand.duplicateKeysAll],
    ),
  };
}

/** `map` restricted to `keySource`'s keyset (deterministic insertion order —
 * code-unit-sorted keys). */
function restrictToKeys(
  map: ReadonlyMap<string, number>,
  keySource: ReadonlyMap<string, number>,
): Map<string, number> {
  const keys = [...keySource.keys()].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  const out = new Map<string, number>();
  for (const k of keys) {
    const v = map.get(k);
    if (v !== undefined) {
      out.set(k, v);
    }
  }
  return out;
}

const cellKeyOf = (spec: CellSpec): string =>
  `${spec.presetLabel}_${spec.mode}__${spec.baselineArm}__vs__${spec.candidateArm}`;

/** Cells object with code-unit-sorted keys (C4′ deterministic report). */
function computeAllCells(
  armData: ReadonlyMap<string, ArmData>,
): Record<string, ReturnType<typeof computeCell>> {
  const entries = CELL_SPECS.map((spec) => {
    const base = armData.get(`${spec.preset}\0${spec.baselineArm}`)!;
    const cand = armData.get(`${spec.preset}\0${spec.candidateArm}`)!;
    return [cellKeyOf(spec), computeCell(spec, base, cand)] as const;
  }).sort((a, b) => (a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1));
  const out: Record<string, ReturnType<typeof computeCell>> = {};
  for (const [k, v] of entries) {
    out[k] = v;
  }
  return out;
}

// ── FIX-2 unit check: a synthetic duplicate pairing key hard-voids the cell ──
// (codex-review WP-3f). The full battery has empirically ZERO duplicate keys
// today (nDuplicateKeys* are always 0 in the emitted report), so this proves
// the guarantee holds without waiting for a real preset to ever produce one.

describe("FIX-2: duplicate pairing keys are a hard void, never a silent collapse", () => {
  it("keyedExtents collapses first-wins but surfaces the recurring key in duplicateKeys", () => {
    const rows: SliceEdgeRow[] = [
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 10 },
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 999 }, // synthetic dup
      { source: "c", target: "d", relKind: "tfd", slice: "B", extentPx: 5 },
    ];
    const { map, duplicates, duplicateKeys } = keyedExtents(rows, "B");
    expect(duplicates).toBe(1);
    expect(duplicateKeys).toEqual([canonicalEdgeKey("a", "b", "tfd")]);
    // first-wins: the FIRST row's value survives in the collapsed map.
    expect(map.get(canonicalEdgeKey("a", "b", "tfd"))).toBe(10);
  });

  it("a duplicate pairing key in either arm forces the comparison voided with voidReason + duplicateKeys listed", () => {
    const baseRows: SliceEdgeRow[] = [
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 10 },
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 999 }, // synthetic dup
      { source: "c", target: "d", relKind: "tfd", slice: "B", extentPx: 5 },
    ];
    const candRows: SliceEdgeRow[] = [
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 8 },
      { source: "c", target: "d", relKind: "tfd", slice: "B", extentPx: 4 },
    ];
    const base = keyedExtents(baseRows, "B");
    const cand = keyedExtents(candRows, "B");
    expect(base.duplicateKeys.length).toBe(1);
    expect(cand.duplicateKeys.length).toBe(0);

    const cell = pairedComparison(base.map, cand.map, [
      ...base.duplicateKeys,
      ...cand.duplicateKeys,
    ]) as Record<string, unknown>;
    expect(cell.voided).toBe(true);
    expect(cell.status).toBe("void");
    expect(cell.voidReason).toBe("duplicate-pairing-keys");
    expect(cell.duplicateKeys).toEqual(base.duplicateKeys);
    // an under-determined comparison must never read as a passing gate.
    expect(cell.ciExcludesZeroImproving).toBe(false);
  });

  it("zero duplicates (today's real state) leaves the report shape unchanged — no voidReason/duplicateKeys fields", () => {
    const rows: SliceEdgeRow[] = [
      { source: "a", target: "b", relKind: "tfd", slice: "B", extentPx: 10 },
      { source: "c", target: "d", relKind: "tfd", slice: "B", extentPx: 5 },
    ];
    const clean = keyedExtents(rows, "B");
    expect(clean.duplicateKeys).toEqual([]);
    const cell = pairedComparison(
      clean.map,
      clean.map,
      clean.duplicateKeys,
    ) as Record<string, unknown>;
    expect("voidReason" in cell).toBe(false);
    expect("duplicateKeys" in cell).toBe(false);
  });
});

// ── harness ──────────────────────────────────────────────────────────────────

describe("§2.5 slice-B extent gate harness (report-emitting)", () => {
  it(
    "P1 + P2, compact + full — paired bootstrap CI per §12 gate cell",
    async () => {
      const softFailures: string[] = [];
      const armData = new Map<string, ArmData>();
      const armsReport: Record<string, Record<string, unknown>> = {};

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );
        const presetArms: Record<string, unknown> = {};
        for (const armLabel of Object.keys(ARM_OPTIONS).sort((a, b) =>
          a === b ? 0 : a < b ? -1 : 1,
        )) {
          const data = await buildArm(sources, ARM_OPTIONS[armLabel]!);
          armData.set(`${preset}\0${armLabel}`, data);
          presetArms[armLabel] = {
            elementCount: data.elementCount,
            nPerEdge: data.nPerEdge,
            nSliceB: data.nSliceB,
            nDuplicateKeys: data.nDuplicateKeys,
            unresolvedEdgeCount: data.unresolvedEdgeCount,
            rcllV2Degraded: data.rcllV2Degraded ?? null,
          };
          if (data.nPerEdge === 0) {
            softFailures.push(
              `${preset}/${armLabel}: perEdge rows EMPTY (vacuous arm)`,
            );
          }
          if (data.nSliceB === 0) {
            softFailures.push(
              `${preset}/${armLabel}: slice-B rows EMPTY (no cross-band edges)`,
            );
          }
          if (
            STRATA_ARMS.has(armLabel) &&
            data.rcllV2Degraded !== undefined &&
            data.rcllV2Degraded !== false
          ) {
            softFailures.push(
              `${preset}/${armLabel}: rcllV2Degraded present (${JSON.stringify(
                data.rcllV2Degraded,
              )}) — full-mode strata arms require the A6 satellite fix; HARD FAIL`,
            );
          }
        }
        armsReport[presetLabel] = presetArms;
      }

      // Cells — computed twice from the same arm data; byte-identical or the
      // harness itself is nondeterministic (the pinned bootstrap must be pure).
      const cells = computeAllCells(armData);
      const cellsAgain = computeAllCells(armData);
      const cellsDeterministic =
        JSON.stringify(cells) === JSON.stringify(cellsAgain);
      if (!cellsDeterministic) {
        softFailures.push(
          "determinism: computeAllCells twice on identical arm data produced different reports",
        );
      }

      for (const [key, cell] of Object.entries(cells)) {
        if (cell.n === 0) {
          softFailures.push(`${key}: pairing produced n=0 (nothing matched)`);
        }
      }

      // Scene-level determinism: rebuild the cheapest arm from scratch; its
      // keyed slice-B map must be identical (sorted-entry compare).
      const detPreset = PRESET_2;
      const detArm = "A_v2_baseline";
      const rawDet = getTerraformImportPresetSourcesFromDb(detPreset);
      const detSources = resolveSourcesWithTfdComposition(
        rawDet! as TerraformImportPresetSources,
      );
      const rebuilt = await buildArm(detSources, ARM_OPTIONS[detArm]!);
      const mapAsSortedJson = (m: ReadonlyMap<string, number>): string =>
        JSON.stringify(
          [...m.entries()].sort((a, b) =>
            a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1,
          ),
        );
      const firstBuild = armData.get(`${detPreset}\0${detArm}`)!;
      const sceneDeterministic =
        mapAsSortedJson(rebuilt.sliceB) === mapAsSortedJson(firstBuild.sliceB);
      if (!sceneDeterministic) {
        softFailures.push(
          `determinism: ${detPreset}/${detArm} rebuilt from scratch produced a different keyed slice-B map`,
        );
      }

      const report = {
        pins: {
          seed: BOOTSTRAP_SEED,
          B: BOOTSTRAP_B,
          nBMin: BOOTSTRAP_N_B_MIN,
          nBFloor: BOOTSTRAP_N_B_FLOOR,
          unmatchedVoidFraction: BOOTSTRAP_UNMATCHED_VOID_FRACTION,
          improvementDirection:
            "extent decrease; gate passes iff CI hi < 0 (ciExcludesZeroImproving)",
        },
        arms: armsReport,
        cells,
        determinism: {
          cellsDoubleComputeIdentical: cellsDeterministic,
          sceneRebuild: {
            preset: detPreset,
            arm: detArm,
            identicalKeyedSliceB: sceneDeterministic,
          },
        },
        softFailures,
      };
      // Emit BEFORE asserting so the orchestrator gets the report even on a
      // health failure.
      emitReport("EXTENT_GATE_REPORT", report);

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
