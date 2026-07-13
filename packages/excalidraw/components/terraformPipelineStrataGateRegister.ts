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

/** Round-9 per-arm scalar metric probes (docs/rcll-v2-shit-test-round9.md,
 * docs/strata-view-w7-packed-scoring-battery.md):
 *   hullPenetrationsProbe = NON-NORMATIVE M-H probe — the W7 battery's
 *       edge-vs-hull-frame tunneling counter (2px pad, hull frames only). It is
 *       NOT the normative M-H hard gate: that gate is an exact-zero vector over
 *       leaf-outside-hull, sibling-hull overlap, interleaved band Y-intervals,
 *       arrows crossing an UNRELATED CARD INTERIOR, and left-of-source targets
 *       (rcll-v2-gate-family-v3.2-proposal.md:42), which this counter does not
 *       cover. The normative M-H counter remains OUTSTANDING (round-9 prereq).
 *   batteryCrossings = M-TCR probe (battery global edge-crossing count)
 *   sharpShare       = M-ANG probe (share of crossings below the sharp-angle
 *       floor). Lower is better.
 * These are battery-scalar probes seeded REPORT, NOT accepted gates. Unlike the
 * paired cells above, they are single per-arm scalars — the W7
 * `P_strata_k4_a7_packed` arm and the hull-penetration counter are NOT in any
 * frozen paired artifact. */
export type ScalarMetricId =
  | "hullPenetrationsProbe"
  | "batteryCrossings"
  | "sharpShare";

/** Improvement direction is hard-coded PER METRIC in code — never read from the
 * cell — so editing the JSON cannot flip a regression's polarity to mint a PASS.
 * All three round-9 probes are lower-is-better (fewer crossings / penetrations /
 * sharp-angle crossings), verified against the W7 battery semantics. */
export const SCALAR_METRIC_LOWER_IS_BETTER: Record<ScalarMetricId, boolean> = {
  hullPenetrationsProbe: true,
  batteryCrossings: true,
  sharpShare: true,
};

export function scalarLowerIsBetter(metric: ScalarMetricId): boolean {
  return SCALAR_METRIC_LOWER_IS_BETTER[metric];
}

/** SDEC citation must be a well-formed decision-log token. The always-on test
 * additionally greps docs/strata-view-decision-log.md so a nonexistent token
 * (e.g. SDEC-99999) still fails. */
export const SDEC_TOKEN_RE = /^SDEC-[0-9]+$/;

/**
 * A scalar cell is one of two honest classes:
 *
 *  - "report-observation": a provenance-recorded MEASUREMENT that asserts
 *    NOTHING. Its claimedStatus MUST be REPORT (the test enforces it). All 18
 *    current W7 scalar cells are this class. This is what kills the
 *    "edit the JSON value to mint PASS" hole — a recorded number can never claim
 *    an improvement.
 *
 *  - "comparative": MAY (in future) claim PASS/PARITY/FAIL-WAIVED, but only by
 *    recomputing value+baseline from a PINNED ARTIFACT (path + sha256, the same
 *    discipline as the frozen-baseline manifest). No scalar pinned artifacts
 *    exist yet, so the test REJECTS every comparative cell today: the schema is
 *    ready but unmintable. Any upgrade path therefore runs through a pinned
 *    artifact, never through an editable literal.
 */
export type ScalarCellKind = "report-observation" | "comparative";

/** Pinned-artifact reference (mirrors the frozen-baseline SHA-256 manifest). */
export type PinnedArtifactRef = { path: string; sha256: string };

export type GateRegisterScalarCell = {
  id: string;
  /** Honest cell class — see ScalarCellKind. */
  kind: ScalarCellKind;
  metric: ScalarMetricId;
  preset: string;
  /** Exact arm/configuration the claim names — v3.2 requires claims to name
   * their configuration (e.g. "strata K4+A7+packedScoring, P1 compact, W7"). */
  configuration: string;
  /** Measured scalar value recorded from the evidence doc. */
  value: number;
  /** Comparator: the `id` of ANOTHER scalar cell in this register (the v2→I→P
   * chain). The comparator value is resolved from that cell — never a duplicated
   * number baked into this cell. Absent = reference arm (no comparator). */
  baselineRef?: string;
  claimedStatus: GateRegisterStatus;
  /** How this entry was decided (e.g. "recorded-from-W7"). */
  adjudication: string;
  /** Doc/SDEC references backing the measurement. */
  evidence: string;
  /** Required for kind==="comparative": the pinned artifact whose bytes the
   * value+baseline recompute from. */
  pinnedArtifact?: PinnedArtifactRef;
  /** Required (must match SDEC_TOKEN_RE) when claimedStatus === "FAIL-WAIVED". */
  sdec?: string;
  note?: string;
};

export type GateRegister = {
  schemaVersion: 1;
  cells: GateRegisterCell[];
  /** Round-9 scalar probe cells (hullPenetrationsProbe / batteryCrossings /
   * sharpShare) — report-observations, not accepted M-H/M-TCR/M-ANG gates
   * (the normative M-H exact-zero vector remains outstanding). Optional so
   * older registers stay valid; when present the test enforces the same
   * label discipline as the paired cells. */
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
  /** Improvement direction the recorded value + RESOLVED baseline support, using
   * the hard-coded per-metric direction (never the cell's own field):
   *  PASS   = comparative and strictly better than baseline.
   *  PARITY = comparative and equal to baseline.
   *  FAIL   = comparative and worse than baseline.
   *  REPORT = no comparator (or unresolved) — a pure measurement, no verdict. */
  computed: "PASS" | "PARITY" | "FAIL" | "REPORT";
  /** Signed candidate−baseline delta oriented so <0 is better (undefined when
   * there is no comparator). */
  orientedDelta?: number;
  /** Comparator value resolved from the referenced cell (undefined when absent
   * or unresolved). */
  baselineValue?: number;
};

/** Resolver: cell id → cell (typically backed by the register's own cells). */
export type ScalarCellLookup = (
  id: string,
) => GateRegisterScalarCell | undefined;

/** Recompute a scalar cell's categorical direction from its recorded value and
 * the value RESOLVED from its baselineRef, using the hard-coded per-metric
 * direction. This is provenance/reporting only — scalarClaimMismatch() gates on
 * the cell KIND, not on this direction, so no computed direction can mint a PASS
 * from an editable literal. */
export function recomputeScalarCell(
  cell: GateRegisterScalarCell,
  resolve?: ScalarCellLookup,
): ScalarRecompute {
  if (cell.baselineRef === undefined) {
    return { computed: "REPORT" };
  }
  const base = resolve?.(cell.baselineRef);
  if (!base) {
    // Unresolved reference — no verdict here; scalarClaimMismatch() reports it.
    return { computed: "REPORT" };
  }
  const delta = cell.value - base.value;
  const oriented = scalarLowerIsBetter(cell.metric) ? delta : -delta;
  let computed: ScalarRecompute["computed"];
  if (oriented < 0) {
    computed = "PASS";
  } else if (oriented === 0) {
    computed = "PARITY";
  } else {
    computed = "FAIL";
  }
  return { computed, orientedDelta: oriented, baselineValue: base.value };
}

/**
 * null = claim consistent; string = human-readable mismatch (test fails).
 *
 * The verdict gates on the cell KIND, which is what makes the register honest:
 *  - report-observation → MUST be REPORT (asserts nothing).
 *  - comparative        → schema-ready but UNMINTABLE (no pinned scalar
 *    artifact exists), so it is always rejected today.
 * Plus cross-cutting discipline: a well-formed SDEC for every FAIL-WAIVED, and a
 * baselineRef that resolves to a real cell.
 */
export function scalarClaimMismatch(
  cell: GateRegisterScalarCell,
  resolve?: ScalarCellLookup,
): string | null {
  if (cell.kind !== "report-observation" && cell.kind !== "comparative") {
    return `${cell.id}: unknown cell kind ${String(cell.kind)}`;
  }
  // Waiver discipline: FAIL-WAIVED must cite a well-formed SDEC token. (The
  // test additionally greps the decision log so a nonexistent token fails.)
  if (cell.claimedStatus === "FAIL-WAIVED") {
    if (!cell.sdec || !SDEC_TOKEN_RE.test(cell.sdec.trim())) {
      return `${cell.id}: claimed FAIL-WAIVED without a well-formed SDEC citation (^SDEC-[0-9]+$)`;
    }
  }
  // A baselineRef, when present, must resolve to a real register cell — a
  // dangling reference can no longer masquerade as a comparator.
  if (cell.baselineRef !== undefined && !resolve?.(cell.baselineRef)) {
    return `${cell.id}: baselineRef ${cell.baselineRef} does not resolve to a register cell`;
  }

  if (cell.kind === "report-observation") {
    // A recorded measurement asserts NOTHING — it may only be REPORT.
    if (cell.claimedStatus !== "REPORT") {
      return `${cell.id}: report-observation cells must claim REPORT, got ${cell.claimedStatus}`;
    }
    return null;
  }

  // kind === "comparative": schema-ready but UNMINTABLE today. A comparative
  // claim must recompute value+baseline from a pinned artifact (path + sha256);
  // no scalar pinned artifacts exist yet, so every comparative cell is rejected.
  // This is what forbids "edit the JSON to mint PASS" on the upgrade path: the
  // only mint route runs through a pinned artifact that does not yet exist.
  if (
    !cell.pinnedArtifact ||
    !cell.pinnedArtifact.path ||
    !cell.pinnedArtifact.sha256
  ) {
    return `${cell.id}: comparative scalar cell requires a pinned artifact (path + sha256)`;
  }
  return `${cell.id}: comparative scalar cells are not yet mintable — no pinned scalar artifact exists (schema-ready only)`;
}
