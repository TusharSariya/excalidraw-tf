/**
 * Edge-collapse TRIPWIRES (owner Q11, option (c): "land the Number.isFinite
 * tripwires only" — guard + observability now, the full flip-hunt is DEFERRED).
 *
 * Background (docs/strata-overnight-20260717/collapse-rootcause.md): the strata
 * engine nondeterministically emits scenes whose declared dataflow edges leave
 * NO spanning connector geometry (the ~1.18M-char routed polylines simply never
 * materialize), while every scalar metric stays blind to it. The root cause is
 * narrowed to the finalize / orbit-route point-materialization phase
 * (`convertPipelineSkeletonToElements` → `repairTerraformEdgeBindings`), with a
 * prime suspect being an SDEC-34-class import-cycle module-level const frozen to
 * `NaN` hitting a finite-guard on the connector-point path.
 *
 * These tripwires are STRICTLY LOG-ONLY observers. They NEVER throw, NEVER alter
 * the emitted scene, and NEVER touch a point value. When disabled (the default,
 * and always in prod) every entry point is a cheap early-return, so the healthy
 * path is byte-identical whether the tripwires are compiled in or not.
 *
 * They exist so the NEXT collapse is instantly localizable: enable them for a
 * headless flip-hunt run, then read `globalThis.__terraformEdgeTripwire` (or
 * {@link getTerraformEdgeTripwireRecords}) to see which edge / which guard /
 * what raw value fired.
 */

/** A single non-finite connector coordinate caught by a finite-guard. */
export type TerraformEdgeNonFiniteRecord = {
  kind: "non-finite-point";
  /** The linear element id whose materialized connector produced the value. */
  edgeId: string;
  /** The edge layer (dependency / dataFlow / …), for triage. */
  layer: string | null;
  /**
   * Which finite-guard rejected the value, e.g. "connector-endpoint" (the
   * center-clipped chord anchors) or "routed-polyline-point" (a detour vertex).
   */
  guard: string;
  /** Which coordinate, e.g. "startX" / "endY" / "point[2].x". */
  axis: string;
  /** The raw rejected value (NaN / Infinity / -Infinity), stringified. */
  rawValue: string;
};

/** A declared edge that materialized with < 2 spanning (distinct) points. */
export type TerraformEdgeSpanUnderflowRecord = {
  kind: "edge-span-underflow";
  edgeId: string;
  layer: string | null;
  /** Number of DISTINCT points in the materialized polyline. */
  distinctPointCount: number;
  /** Max horizontal/vertical extent of the materialized polyline, px. */
  span: number;
};

/** Scene-finalize census: how many edges materialized spanning routes. */
export type TerraformEdgeFinalizeSummaryRecord = {
  kind: "finalize-summary";
  /** Declared-edge population (edge-layer + relationship, deleted included). */
  declaredEdgeCount: number;
  /** Non-deleted visible linear elements whose polyline spans the threshold. */
  spanningVisibleLinearCount: number;
  /** `spanningVisibleLinearCount / declaredEdgeCount`, 3dp. */
  edgeSpanningFraction: number;
  /** `true` when the shipped collapse detector would fire on this scene. */
  edgeCollapseDetected: boolean;
};

export type TerraformEdgeTripwireRecord =
  | TerraformEdgeNonFiniteRecord
  | TerraformEdgeSpanUnderflowRecord
  | TerraformEdgeFinalizeSummaryRecord;

// ── enablement (default OFF → zero overhead + byte-identical healthy path) ────

/**
 * Test/programmatic override. `null` = defer to env / global (the shipped
 * behaviour); `true`/`false` = force. Kept module-local so prod never pays more
 * than one `??` per check.
 */
let forcedEnabled: boolean | null = null;

const readAmbientEnabled = (): boolean => {
  try {
    if (
      typeof process !== "undefined" &&
      process.env != null &&
      process.env.TERRAFORM_EDGE_TRIPWIRE === "1"
    ) {
      return true;
    }
  } catch {
    // `process` not defined in some browser bundles — fall through to global.
  }
  return (
    (globalThis as { __TERRAFORM_EDGE_TRIPWIRE_ENABLED__?: unknown })
      .__TERRAFORM_EDGE_TRIPWIRE_ENABLED__ === true
  );
};

/**
 * Whether the tripwires observe. OFF unless `TERRAFORM_EDGE_TRIPWIRE=1`,
 * `globalThis.__TERRAFORM_EDGE_TRIPWIRE_ENABLED__ = true`, or an explicit
 * {@link setTerraformEdgeTripwireEnabled} override is set.
 */
export const isTerraformEdgeTripwireEnabled = (): boolean =>
  forcedEnabled ?? readAmbientEnabled();

/** Force the tripwires on/off (tests, headless flip-hunt). `null` restores env. */
export const setTerraformEdgeTripwireEnabled = (
  value: boolean | null,
): void => {
  forcedEnabled = value;
};

// ── record buffer + surfacing ─────────────────────────────────────────────────

const records: TerraformEdgeTripwireRecord[] = [];

/** Cap so a pathological run can't grow the buffer without bound. */
const MAX_RECORDS = 5000;

const surface = (record: TerraformEdgeTripwireRecord): void => {
  if (records.length < MAX_RECORDS) {
    records.push(record);
  }
  // Mirror onto a global so a headless flip-hunt (or the browser console) can
  // read the tripwire trace without importing the module.
  const g = globalThis as {
    __terraformEdgeTripwire?: {
      records: TerraformEdgeTripwireRecord[];
      lastUpdated: number;
    };
  };
  g.__terraformEdgeTripwire = { records, lastUpdated: Date.now() };
  // eslint-disable-next-line no-console
  console.warn("[terraform-edge-tripwire]", record);
};

/** Snapshot of every record captured since the last reset. */
export const getTerraformEdgeTripwireRecords =
  (): ReadonlyArray<TerraformEdgeTripwireRecord> => records.slice();

/** Clear the buffer (call between flip-hunt runs / test cases). */
export const resetTerraformEdgeTripwireRecords = (): void => {
  records.length = 0;
  const g = globalThis as { __terraformEdgeTripwire?: unknown };
  delete g.__terraformEdgeTripwire;
};

// ── tripwire entry points ─────────────────────────────────────────────────────

/**
 * (a) SDEC-34 catch. Observe one materialized connector coordinate; if it is
 * non-finite (the const-frozen-NaN hypothesis), record which edge / guard /
 * value. Does NOT reject or replace the value — purely observes.
 */
export const tripwireCheckConnectorPointFinite = (params: {
  edgeId: string;
  layer: string | null;
  guard: string;
  axis: string;
  value: number;
}): void => {
  if (!isTerraformEdgeTripwireEnabled()) {
    return;
  }
  if (Number.isFinite(params.value)) {
    return;
  }
  surface({
    kind: "non-finite-point",
    edgeId: params.edgeId,
    layer: params.layer,
    guard: params.guard,
    axis: params.axis,
    rawValue: String(params.value),
  });
};

/** Distinct-point count of a local polyline (dedupes exactly-coincident points). */
const distinctPointCount = (
  points: ReadonlyArray<readonly [number, number]>,
): number => {
  const seen = new Set<string>();
  for (const p of points) {
    seen.add(`${p[0]}|${p[1]}`);
  }
  return seen.size;
};

/** Max horizontal/vertical extent of a local polyline, px. */
const polylineSpan = (
  points: ReadonlyArray<readonly [number, number]>,
): number => {
  if (points.length < 2) {
    return 0;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return Math.max(maxX - minX, maxY - minY);
};

/**
 * (b) Per-edge collapse. Observe the polyline a declared edge just materialized;
 * if it carries fewer than 2 distinct points (a degenerate / collapsed route),
 * record it. A legit edge always spans two distinct anchors, so a healthy scene
 * never fires this.
 */
export const tripwireCheckEdgeSpan = (params: {
  edgeId: string;
  layer: string | null;
  points: ReadonlyArray<readonly [number, number]>;
}): void => {
  if (!isTerraformEdgeTripwireEnabled()) {
    return;
  }
  const distinct = distinctPointCount(params.points);
  if (distinct >= 2) {
    return;
  }
  surface({
    kind: "edge-span-underflow",
    edgeId: params.edgeId,
    layer: params.layer,
    distinctPointCount: distinct,
    span: polylineSpan(params.points),
  });
};

/**
 * (c) Scene-finalize census. Record how many declared edges left spanning
 * visible geometry vs how many were declared, so a process-level collapse is
 * logged with the numbers even when no individual edge tripped (a) or (b).
 */
export const tripwireRecordFinalizeSummary = (
  summary: Omit<TerraformEdgeFinalizeSummaryRecord, "kind">,
): void => {
  if (!isTerraformEdgeTripwireEnabled()) {
    return;
  }
  surface({ kind: "finalize-summary", ...summary });
};
