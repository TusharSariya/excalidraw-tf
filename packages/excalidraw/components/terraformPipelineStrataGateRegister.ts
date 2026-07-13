/**
 * v3.2 gate register — pure verdict logic (R8-F3 repair; gate-family proposal
 * §3 "Frozen baselines loaded, not rebuilt").
 *
 * The register (docs/strata-baselines/gateRegister.json) maps gate cells to a
 * CLAIMED status; the always-on assertion test
 * (terraformPipelineStrataGateRegister.test.ts) recomputes each cell's verdict
 * from the frozen row artifacts and fails when a claim does not recompute.
 * Non-negotiable properties: a claim that doesn't recompute goes red, and
 * FAIL-WAIVED never renders as PASS — WAIVED is a legal, auditable owner
 * override of a computed FAIL, nothing more.
 *
 * This module is pure (no fs/crypto — the tests own I/O) so the verdict rules
 * are unit-testable and reusable by future battery harnesses.
 *
 * SDEC-34: all module-level constants are literals; nothing is derived from
 * terraformPipelineLayoutShared.
 */
import {
  pairedBootstrapCi,
  statisticGateEligible,
  type BootstrapCiResult,
  type BootstrapStatistic,
} from "./terraformPipelineBootstrapCi";

/** PARITY half-width for the M-RT composite (proposal §3: ε_rt = 0.25 s ≈ the
 * cost of ~15° continuity per Ware's equivalences). */
export const RT_PARITY_EPSILON = 0.25;

/** Frozen per-edge row (slice-B only): canonical edge key → extentPx. */
export type FrozenEdgeRow = { key: string; extentPx: number };

/** Frozen per-path row — PathMetricsRow minus `addresses` (reconstructable by
 * splitting pathKey on NUL) to keep artifacts small. */
export type FrozenPathRow = {
  pathKey: string;
  k: number;
  con: number;
  cr: number;
  tll: number;
  br: number;
  rtHat: number;
};

export type FrozenArmRows = {
  sliceB: FrozenEdgeRow[];
  paths: FrozenPathRow[];
  scalars: {
    crossings: number;
    nCross: number;
    sharpShare: number;
    p10Deg: number;
    minDeg: number;
    elementCount: number;
  };
};

export type FrozenRowsArtifact = {
  schemaVersion: 1;
  preset: string;
  cardMode: "compact";
  /** Arm label → rows. Always includes A_v2_baseline. Candidate arms are
   * frozen snapshots of the run recorded in the manifest's provenance — the
   * regen harness is the live-rebuild path. */
  arms: Record<string, FrozenArmRows>;
};

export type GateRegisterStatus = "PASS" | "PARITY" | "FAIL-WAIVED" | "REPORT";

export type GateRegisterCell = {
  id: string;
  /** Artifact file basename holding this cell's rows. */
  artifact: string;
  baselineArm: string;
  candidateArm: string;
  metric: "extentSliceB" | "rtHat" | "con" | "cr" | "tll";
  statistic: BootstrapStatistic;
  claimedStatus: GateRegisterStatus;
  /** How this entry was decided (e.g. "recorded-from-W5"). */
  adjudication: string;
  /** Doc/SDEC references backing the claim. */
  evidence: string;
  note?: string;
  /** REPORT-only refinement: "floorIneligible" additionally asserts the cell
   * is genuinely below the gating floor; "none" only asserts it recomputes. */
  reportAssert?: "none" | "floorIneligible";
};

/** Round-9 per-arm scalar metric families (docs/rcll-v2-shit-test-round9.md,
 * docs/strata-view-w7-packed-scoring-battery.md):
 *   hullPenetrations = M-H   (edge–hull-frame tunneling on final geometry)
 *   batteryCrossings = M-TCR (battery global edge crossings)
 *   sharpShare       = M-ANG (share of crossings below the sharp-angle floor)
 * Unlike the paired cells above, these are single per-arm scalars — the W7
 * `P_strata_k4_a7_packed` arm and the hull-penetration counter are NOT in the
 * frozen paired artifacts, so a scalar cell records the measured value (with the
 * evidence doc as its provenance) rather than recomputing a paired bootstrap. */
export type ScalarMetricId = "hullPenetrations" | "batteryCrossings" | "sharpShare";

export type GateRegisterScalarCell = {
  id: string;
  metric: ScalarMetricId;
  preset: string;
  /** Exact arm/configuration the claim names — v3.2 requires claims to name
   * their configuration (e.g. "strata K4+A7+packedScoring, P1 compact, W7"). */
  configuration: string;
  /** Measured scalar value recorded from the evidence doc. */
  value: number;
  /** Baseline (comparator) this claim is measured against, when comparative.
   * Absent = this cell is the reference arm (no gate verdict, REPORT only). */
  baseline?: { arm: string; value: number };
  /** true when a smaller value is better — all three round-9 scalars are
   * lower-is-better (fewer crossings / penetrations / sharp angles). */
  lowerIsBetter: boolean;
  claimedStatus: GateRegisterStatus;
  /** How this entry was decided (e.g. "recorded-from-W7"). */
  adjudication: string;
  /** Doc/SDEC references backing the measurement. */
  evidence: string;
  /** Required (non-empty) when claimedStatus === "FAIL-WAIVED". */
  sdec?: string;
  note?: string;
};

export type GateRegister = {
  schemaVersion: 1;
  cells: GateRegisterCell[];
  /** Round-9 scalar claim cells (M-H / M-TCR / M-ANG). Optional so older
   * registers stay valid; when present the test enforces the same label
   * discipline as the paired cells. */
  scalarCells?: GateRegisterScalarCell[];
};

const metricMap = (
  arm: FrozenArmRows,
  metric: GateRegisterCell["metric"],
): Map<string, number> => {
  const m = new Map<string, number>();
  if (metric === "extentSliceB") {
    for (const r of arm.sliceB) {
      if (!m.has(r.key)) {
        m.set(r.key, r.extentPx);
      }
    }
    return m;
  }
  for (const r of arm.paths) {
    m.set(r.pathKey, r[metric]);
  }
  return m;
};

export type CellRecompute = {
  ci: BootstrapCiResult;
  gateEligible: boolean;
  /** The categorical outcome the CI supports (before any waiver). */
  computed: "PASS" | "PARITY" | "FAIL" | "REPORT";
};

/** Recompute a cell's CI + categorical verdict from frozen rows.
 *  PASS   = eligible, non-void, CI hi < 0 (improving).
 *  PARITY = eligible, non-void, CI straddles 0 — and for rtHat additionally
 *           |point| ≤ RT_PARITY_EPSILON (proposal §3).
 *  FAIL   = eligible, non-void, neither of the above (includes lo > 0).
 *  REPORT = floor-ineligible or voided — no gate verdict exists.
 */
export function recomputeCell(
  cell: GateRegisterCell,
  artifact: FrozenRowsArtifact,
): CellRecompute {
  const base = artifact.arms[cell.baselineArm];
  const cand = artifact.arms[cell.candidateArm];
  if (!base || !cand) {
    throw new Error(
      `gateRegister cell ${cell.id}: arm missing from artifact ` +
        `(${cell.baselineArm} / ${cell.candidateArm})`,
    );
  }
  const ci = pairedBootstrapCi(
    {
      baseline: metricMap(base, cell.metric),
      candidate: metricMap(cand, cell.metric),
    },
    { statistic: cell.statistic },
  );
  const gateEligible = statisticGateEligible(cell.statistic, ci.n);
  let computed: CellRecompute["computed"];
  if (!gateEligible || ci.voided || ci.degenerate) {
    computed = "REPORT";
  } else if (ci.hi < 0) {
    computed = "PASS";
  } else if (
    ci.lo <= 0 &&
    ci.hi >= 0 &&
    (cell.metric !== "rtHat" || Math.abs(ci.point) <= RT_PARITY_EPSILON)
  ) {
    computed = "PARITY";
  } else {
    computed = "FAIL";
  }
  return { ci, gateEligible, computed };
}

/** null = claim consistent; string = human-readable mismatch (test fails). */
export function claimMismatch(
  cell: GateRegisterCell,
  rc: CellRecompute,
): string | null {
  const got = `computed=${rc.computed} ci=[${rc.ci.lo}, ${rc.ci.hi}] n=${rc.ci.n}`;
  switch (cell.claimedStatus) {
    case "PASS":
      return rc.computed === "PASS"
        ? null
        : `${cell.id}: claimed PASS but ${got}`;
    case "PARITY":
      return rc.computed === "PARITY"
        ? null
        : `${cell.id}: claimed PARITY but ${got}`;
    case "FAIL-WAIVED":
      // A waiver only ever covers a computed FAIL. If the cell now recomputes
      // as PASS/PARITY the waiver label is stale (and quietly flattering the
      // history); if it is REPORT the gate never existed to waive.
      return rc.computed === "FAIL"
        ? null
        : `${cell.id}: claimed FAIL-WAIVED but ${got} — waiver is stale`;
    case "REPORT":
      if (cell.reportAssert === "floorIneligible" && rc.gateEligible) {
        return `${cell.id}: claimed REPORT(floorIneligible) but n=${rc.ci.n} is gate-eligible`;
      }
      return null;
    default:
      return `${cell.id}: unknown claimedStatus ${String(cell.claimedStatus)}`;
  }
}

export type ScalarRecompute = {
  /** Improvement direction the recorded value+baseline support (before waiver):
   *  PASS   = comparative and strictly better than baseline.
   *  PARITY = comparative and equal to baseline.
   *  FAIL   = comparative and worse than baseline.
   *  REPORT = no comparator recorded — a pure measurement, no gate verdict. */
  computed: "PASS" | "PARITY" | "FAIL" | "REPORT";
  /** Signed candidate−baseline delta oriented so <0 is better (undefined when
   * there is no comparator). */
  orientedDelta?: number;
};

/** Recompute a scalar cell's categorical direction from its recorded value and
 * baseline. Mirrors recomputeCell()'s PASS/PARITY/FAIL semantics so the same
 * mismatch discipline (FAIL-WAIVED never renders as PASS) applies to the M-H /
 * M-TCR / M-ANG families. */
export function recomputeScalarCell(
  cell: GateRegisterScalarCell,
): ScalarRecompute {
  if (!cell.baseline) {
    return { computed: "REPORT" };
  }
  const delta = cell.value - cell.baseline.value;
  const oriented = cell.lowerIsBetter ? delta : -delta;
  let computed: ScalarRecompute["computed"];
  if (oriented < 0) {
    computed = "PASS";
  } else if (oriented === 0) {
    computed = "PARITY";
  } else {
    computed = "FAIL";
  }
  return { computed, orientedDelta: oriented };
}

/** null = claim consistent; string = human-readable mismatch (test fails). */
export function scalarClaimMismatch(
  cell: GateRegisterScalarCell,
  rc: ScalarRecompute,
): string | null {
  // Waiver discipline: a FAIL-WAIVED must cite an SDEC regardless of direction.
  if (
    cell.claimedStatus === "FAIL-WAIVED" &&
    (!cell.sdec || cell.sdec.trim() === "")
  ) {
    return `${cell.id}: claimed FAIL-WAIVED without an SDEC citation`;
  }
  const got = `computed=${rc.computed}${
    rc.orientedDelta === undefined ? "" : ` orientedDelta=${rc.orientedDelta}`
  }`;
  switch (cell.claimedStatus) {
    case "PASS":
      return rc.computed === "PASS"
        ? null
        : `${cell.id}: claimed PASS but ${got}`;
    case "PARITY":
      return rc.computed === "PARITY"
        ? null
        : `${cell.id}: claimed PARITY but ${got}`;
    case "FAIL-WAIVED":
      return rc.computed === "FAIL"
        ? null
        : `${cell.id}: claimed FAIL-WAIVED but ${got} — waiver is stale`;
    case "REPORT":
      // Measurement-only: asserts nothing about direction. Legitimate for the
      // W7 numbers (owner adjudication of the default posture pending).
      return null;
    default:
      return `${cell.id}: unknown claimedStatus ${String(cell.claimedStatus)}`;
  }
}
