/**
 * Pinned paired bootstrap-CI comparison harness (rcll-v2 spec v3.1 §2.5 + §12,
 * WP-3d / M1b W3).
 *
 * Measurement-only: this module owns NO layout behavior. It compares one scalar
 * metric between a BASELINE arm and a CANDIDATE arm, paired per edge/unit by an
 * opaque string key (the caller supplies canonical terraform edge addresses per
 * §2.5 — see `canonicalEdgeKey`), then reports a percentile confidence interval
 * on the mean paired delta plus the frozen degenerate/void status flags.
 *
 * FROZEN PINS (v3.1 §2.5 + §12 — implemented EXACTLY, do not tune):
 *  - pairing key    = canonical terraform edge address (true direction + relKind)
 *  - unmatched keys = excluded from the delta vector AND counted (`nUnmatched`)
 *  - VOID rule      = unmatched > 20% of min(nBaseline, nCandidate) ⇒ voided
 *  - B              = 1000 resamples, n-out-of-n WITH replacement
 *  - CI             = percentile method, [2.5%, 97.5%]
 *  - PRNG           = mulberry32(SEED), SEED = 20260704 (the ONLY randomness)
 *  - degenerate     = CI upper bound equals the paired-delta sample max
 *                     (a degenerate CI voids a p90 gate even at n ≥ N_B_MIN)
 *  - N_B_MIN        = 30 (p90 gated only at n ≥ 30; below, gate p50, report p90)
 *  - nB < 10        ⇒ cell excluded from slice-B gating entirely (report-only)
 *
 * Determinism (C4′): the seed is fixed and the resample loop is the ONLY
 * consumer of randomness, so `pairedBootstrapCi` is a pure function of its
 * inputs — running it twice yields byte-identical output.
 *
 * v3.2 (round-8 R8-F1 repair): the CI can now be computed ON "mean" | "p50" |
 * "p90" via `options.statistic` — each bootstrap replicate computes the NAMED
 * statistic of its resample, so a result labelled p90 is a CI on p90 itself.
 * Default stays "mean" (byte-identical for all pre-v3.2 callers); the legacy
 * `bootstrapGatePolicy` keeps v3.1 semantics untouched, and the new v3.2
 * floors live in `statisticGateEligible` (p90 ⇒ n ≥ 31, p50 ⇒ n ≥ 10).
 */

/** Frozen §2.5/§12 constants — single source of truth. */
export const BOOTSTRAP_SEED = 20260704;
export const BOOTSTRAP_B = 1000;
/** N_B,min (v3.1 §12): p90 is only gated at n ≥ 30. */
export const BOOTSTRAP_N_B_MIN = 30;
/** Below this matched-pair count a slice-B cell is excluded from gating. */
export const BOOTSTRAP_N_B_FLOOR = 10;
/**
 * v3.2 statistic-gating floors (round-8 R8-F1 repair; gate-family proposal §3).
 * P90 floor is 31, NOT v3.1 §12.2's 30 — that pin's order-statistic rationale
 * ("27th order statistic with 3 points above") is off by one under the frozen
 * nearest-rank convention `sorted[floor(0.9·n)]`: at n=30 that index (27,
 * zero-based) is the 28th observation with only 2 above; n=31 (floor(27.9)=27)
 * is the first size where 3 observations sit above the selected statistic.
 * These floors gate the NEW per-statistic bootstrap below; the legacy
 * `bootstrapGatePolicy` (v3.1 semantics) is intentionally untouched.
 */
export const BOOTSTRAP_N_P90_MIN_V32 = 31;
export const BOOTSTRAP_N_P50_MIN_V32 = 10;
/** Unmatched-fraction VOID threshold (v3.1 §2.5). */
export const BOOTSTRAP_UNMATCHED_VOID_FRACTION = 0.2;

/** NUL delimiter for the pairing key — the repo's path-join convention (see
 * terraformPipelineSliceMetrics.ts's `path.join("\0")`). */
const KEY_DELIM = "\0";

/**
 * mulberry32 — the pinned PRNG (v3.1 §2.5). Standard reference implementation;
 * 32-bit state, returns a float in [0, 1). Reproduced in-file so the seed and
 * the algorithm are pinned together (a shared PRNG import could drift).
 *
 * Known answers for SEED = 20260704 (hand-recorded 2026-07-05, regenerate ONLY
 * if this function changes): first three outputs are
 *   0.12818326242268085, 0.33862593933008611, 0.35023983265273273
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canonical terraform edge address (v3.1 §2.5 pairing key): TRUE declared
 * direction (source→target, NEVER pre-swapped — mirrors StrataEdge.key) plus
 * relKind, NUL-joined. Code-unit-stable and collision-safe even when an address
 * contains spaces.
 */
export function canonicalEdgeKey(
  source: string,
  target: string,
  relKind = "",
): string {
  return [source, target, relKind].join(KEY_DELIM);
}

/** Lower nearest-rank percentile on an ascending array: index = ⌊q·len⌋
 * (clamped). Deterministic and hand-checkable; used for the CI bounds. */
function percentileFloor(sortedAsc: readonly number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) {
    return 0;
  }
  return sortedAsc[Math.min(n - 1, Math.max(0, Math.floor(q * n)))]!;
}

export type BootstrapStatistic = "mean" | "p50" | "p90";

export type BootstrapCiResult = {
  /** Which statistic this CI is ON (v3.2 R8-F1 repair — a result labelled
   * "p90" is a bootstrap CI on p90 itself, never a relabelled mean CI). */
  statistic: BootstrapStatistic;
  /** Matched pairs the CI is computed over (the paired-delta vector length). */
  n: number;
  nBaseline: number;
  nCandidate: number;
  /** Keys present in exactly one arm — excluded from the delta vector, counted
   * for honesty (never silently dropped). */
  nUnmatched: number;
  /** Observed `statistic` of the paired deltas (candidate − baseline). */
  point: number;
  /** Percentile CI on the named statistic of the paired deltas. */
  lo: number;
  hi: number;
  /** hi − lo (realized width, v3.1 §2.5). */
  width: number;
  /** hi equals the paired-delta sample max ⇒ voids a p90 gate (v3.1 §2.5). */
  degenerate: boolean;
  /** unmatched > 20% of min(nBaseline, nCandidate), OR n === 0. */
  voided: boolean;
  status: "ok" | "void";
};

export type PairedBootstrapInput = {
  /** key → metric value in the baseline arm. */
  baseline: ReadonlyMap<string, number>;
  /** key → metric value in the candidate arm. */
  candidate: ReadonlyMap<string, number>;
};

export type PairedBootstrapOptions = {
  seed?: number;
  B?: number;
  /** Statistic the CI is computed ON (v3.2, R8-F1). Default "mean" preserves
   * the exact pre-v3.2 behavior for existing callers. */
  statistic?: BootstrapStatistic;
};

/**
 * v3.2 per-statistic gating floor: may `statistic` be GATED at matched-pair
 * count `n`? (p90 ⇒ n ≥ 31; p50 ⇒ n ≥ 10 — see the *_V32 constants above.
 * "mean" is never a v3.2 gate statistic: it exists for reporting/back-compat.)
 */
export function statisticGateEligible(
  statistic: BootstrapStatistic,
  n: number,
): boolean {
  if (statistic === "p90") {
    return n >= BOOTSTRAP_N_P90_MIN_V32;
  }
  if (statistic === "p50") {
    return n >= BOOTSTRAP_N_P50_MIN_V32;
  }
  return false;
}

/**
 * Paired per-key bootstrap CI on the mean delta (candidate − baseline).
 *
 * Matching: intersect the two keyed maps; deltas taken over matched keys in
 * ascending code-unit key order (C4′ — deterministic, no Map-iteration
 * dependence). Resampling: B draws of n indices uniformly WITH replacement via
 * mulberry32(seed); each draw's mean forms the bootstrap distribution; the CI
 * is its [2.5%, 97.5%] percentiles.
 */
export function pairedBootstrapCi(
  input: PairedBootstrapInput,
  opts: PairedBootstrapOptions = {},
): BootstrapCiResult {
  const seed = opts.seed ?? BOOTSTRAP_SEED;
  const B = opts.B ?? BOOTSTRAP_B;
  const statistic = opts.statistic ?? "mean";
  const { baseline, candidate } = input;

  const nBaseline = baseline.size;
  const nCandidate = candidate.size;

  // Deterministic key order: sort the union code-unit, then split.
  const unionKeys = new Set<string>();
  for (const k of baseline.keys()) {
    unionKeys.add(k);
  }
  for (const k of candidate.keys()) {
    unionKeys.add(k);
  }
  const sortedKeys = [...unionKeys].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1,
  );

  const deltas: number[] = [];
  let nUnmatched = 0;
  for (const k of sortedKeys) {
    const hasB = baseline.has(k);
    const hasC = candidate.has(k);
    if (hasB && hasC) {
      deltas.push(candidate.get(k)! - baseline.get(k)!);
    } else {
      nUnmatched += 1;
    }
  }

  const n = deltas.length;
  const minArm = Math.min(nBaseline, nCandidate);
  const voided =
    n === 0 || nUnmatched > BOOTSTRAP_UNMATCHED_VOID_FRACTION * minArm;

  if (n === 0) {
    return {
      statistic,
      n: 0,
      nBaseline,
      nCandidate,
      nUnmatched,
      point: 0,
      lo: 0,
      hi: 0,
      width: 0,
      degenerate: true,
      voided: true,
      status: "void",
    };
  }

  const sortedDeltas = [...deltas].sort((a, b) => a - b);
  const observedStat = (): number => {
    if (statistic === "p50") {
      return percentileFloor(sortedDeltas, 0.5);
    }
    if (statistic === "p90") {
      return percentileFloor(sortedDeltas, 0.9);
    }
    return deltas.reduce((a, b) => a + b, 0) / n;
  };
  const point = observedStat();
  let sampleMax = -Infinity;
  for (const d of deltas) {
    sampleMax = Math.max(sampleMax, d);
  }

  // One resampled statistic per draw. The RNG is consumed IDENTICALLY (n draws
  // per replicate) for every statistic, and statistic:"mean" reproduces the
  // pre-v3.2 running-sum path exactly — existing callers are byte-identical.
  const rng = mulberry32(seed);
  const stats = new Array<number>(B);
  const resample = new Array<number>(n);
  for (let b = 0; b < B; b++) {
    if (statistic === "mean") {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * n);
        s += deltas[idx]!;
      }
      stats[b] = s / n;
    } else {
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * n);
        resample[i] = deltas[idx]!;
      }
      const sorted = [...resample].sort((a, b) => a - b);
      stats[b] = percentileFloor(sorted, statistic === "p50" ? 0.5 : 0.9);
    }
  }
  stats.sort((a, b) => a - b);

  const lo = percentileFloor(stats, 0.025);
  const hi = percentileFloor(stats, 0.975);
  const maxReplicate = stats[stats.length - 1]!;
  // Degeneracy per statistic (v3.2): for a quantile statistic the CI has
  // collapsed onto the extreme when the upper bound IS the largest replicate
  // AND that replicate is the sample max (the resampled quantile pinned to the
  // top of the data — nothing above it to bound the tail). For "mean" keep the
  // pre-v3.2 semantics verbatim: a bootstrap-of-the-mean upper bound can only
  // reach the sample max when the delta vector is (near-)constant.
  const degenerate =
    statistic === "mean"
      ? Math.abs(hi - sampleMax) < 1e-9
      : Math.abs(hi - maxReplicate) < 1e-9 &&
        Math.abs(maxReplicate - sampleMax) < 1e-9;

  return {
    statistic,
    n,
    nBaseline,
    nCandidate,
    nUnmatched,
    point,
    lo,
    hi,
    width: hi - lo,
    degenerate,
    voided,
    status: voided ? "void" : "ok",
  };
}

export type BootstrapGate = "p90" | "p50" | "none";

export type BootstrapGatePolicy = {
  /** Which percentile may be GATED for this slice-B cell (v3.1 §12). */
  gate: BootstrapGate;
  /** p90 is always REPORTED even when p50 is the gated statistic. */
  reportP90: boolean;
  /** nB < N_B_FLOOR (=10) ⇒ the cell is report-only, excluded from gating. */
  reportOnly: boolean;
};

/**
 * Slice-B gating policy from the matched-pair count and CI degeneracy
 * (v3.1 §12, frozen):
 *   nB < 10           ⇒ report-only (no gate)
 *   10 ≤ nB < 30      ⇒ gate p50, report p90
 *   nB ≥ 30           ⇒ gate p90 … UNLESS the CI is degenerate, which voids the
 *                       p90 gate (falls back to p50) even at n ≥ N_B_MIN.
 */
export function bootstrapGatePolicy(
  nB: number,
  degenerate: boolean,
): BootstrapGatePolicy {
  if (nB < BOOTSTRAP_N_B_FLOOR) {
    return { gate: "none", reportP90: true, reportOnly: true };
  }
  if (nB < BOOTSTRAP_N_B_MIN) {
    return { gate: "p50", reportP90: true, reportOnly: false };
  }
  // nB ≥ 30
  if (degenerate) {
    return { gate: "p50", reportP90: true, reportOnly: false };
  }
  return { gate: "p90", reportP90: true, reportOnly: false };
}
