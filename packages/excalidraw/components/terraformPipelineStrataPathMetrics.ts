/**
 * v3.2 path-level impact-tracing metrics (M-RT headline) — gate-family
 * proposal (docs/rcll-v2-gate-family-v3.2-proposal.md §1–§2, round-8 R8-F6).
 *
 * Measurement-only, scene-side (final Excalidraw elements only), mirroring
 * terraformPipelineSliceMetrics.ts's conventions: pure functions, no layout
 * behavior, deterministic output (C4′). The module computes, per sampled
 * dependency path, the layout factors Ware et al. 2002 ("Cognitive
 * Measurements of Graph Aesthetics", Information Visualization 1(2)) found to
 * predict human shortest-path tracing time, plus their published regression
 * as a composite predicted-cost score.
 *
 * Population: all ordered resource pairs with a UNIQUE shortest directed
 * dependency path of 2–5 hops (unique ⇒ the target trace is well-defined with
 * no human answer key; 2–5 mirrors Ware's stimulus path lengths). Sorted by
 * canonical path key; seeded-sampled to ≤ PATH_SAMPLE_MAX (mulberry32, the
 * frozen §2.5 seed) — deterministic, no cherry-picking.
 *
 * SDEC-34 gotcha honored: this module derives NO module-level values from
 * terraformPipelineLayoutShared (the terraformPlanParsing→terraformLayoutCore
 * import cycle makes such consts entry-order-dependent NaNs). All module-level
 * constants below are numeric/string literals.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  BOOTSTRAP_SEED,
  mulberry32,
  pairedBootstrapCi,
  type BootstrapCiResult,
} from "./terraformPipelineBootstrapCi";
import {
  segmentsCross,
  type Seg,
} from "./terraformPipelineCollisionDiagnostics";

/**
 * Ware et al. 2002 eq. (1) coefficients (seconds; 43 subjects, R² = .784):
 *   rt = −4.970 + 1.390·spl + 0.01699·con + 0.654·cr + 0.295·br
 * The intercept is deliberately OMITTED — rtHat is a paired-comparison score,
 * never a literal predicted time (their stimuli were 42-node spring layouts;
 * the coefficients are literature-derived engineering weights, and the
 * components are also gated individually so nothing rests on the exact
 * weights). hops (spl) and branches (br) are layout-invariant and cancel in
 * the paired delta — Δ rtHat isolates exactly what a layout A/B can change.
 */
export const WARE_COEF_HOPS = 1.39;
export const WARE_COEF_CONTINUITY = 0.01699;
export const WARE_COEF_CROSSINGS_ON_PATH = 0.654;
export const WARE_COEF_BRANCHES = 0.295;

/** Path population bounds (Ware's stimulus range; proposal §2). */
export const PATH_MIN_HOPS = 2;
export const PATH_MAX_HOPS = 5;
/** Seeded sample cap (proposal §2 — report the ratio, never truncate silently). */
export const PATH_SAMPLE_MAX = 500;

const KEY_DELIM = "\0";

/** Canonical path key: the full address chain, NUL-joined (code-unit stable —
 * the same convention as canonicalEdgeKey / the repo's path joins). */
export function canonicalPathKey(addresses: readonly string[]): string {
  return addresses.join(KEY_DELIM);
}

export type PathMetricsRow = {
  pathKey: string;
  addresses: string[];
  /** Hop count (edge count) — layout-invariant. */
  k: number;
  /** Path continuity: Σ over intermediate nodes of the angular deviation
   * (degrees) from straight-through (Ware's `con`; 0 = perfectly straight). */
  con: number;
  /** Crossings-on-path: DISTINCT TFD arrows not in the path properly crossing
   * any of the path's arrows (Ware's `cr` — per-arrow, not per-intersection). */
  cr: number;
  /** Total rendered polyline arc length over the path's arrows, px. */
  tll: number;
  /** Σ max(0, degree − 2) over intermediate nodes (dependency digraph degree,
   * parallel edges collapsed) — layout-invariant (Ware's `br`). */
  br: number;
  /** Ware composite: WARE_COEF_* · (k, con, cr, br). Relative use only. */
  rtHat: number;
  /** Report-only: worst per-edge angular deviation (degrees) between an
   * edge's rendered chord and the straight line from that edge's start node
   * center to the path's final node center (geodesic-tendency proxy —
   * Huang/Eades/Hong 2009). */
  gdevMaxDeg: number;
};

export type StrataPathMetrics = {
  /** Eligible unique-shortest 2–5-hop paths BEFORE sampling. */
  populationTotal: number;
  /** Paths measured (== populationTotal when ≤ PATH_SAMPLE_MAX). */
  sampled: number;
  /** Path count per hop count (2..5), over the SAMPLED set. */
  hopHistogram: Record<number, number>;
  /** Fraction of resolved TFD arrows appearing on ≥1 sampled path. */
  edgeCoverage: number;
  /** Sampled paths dropped because an arrow/cluster failed to resolve to
   * rendered geometry — counted for honesty, never silently dropped. */
  unresolvedPathCount: number;
  /** One row per measured path, ascending canonical path key. */
  rows: PathMetricsRow[];
};

// ── scene helpers (mirroring terraformPipelineSliceMetrics.ts's private
// conventions; duplicated so this module stays additive-only) ────────────────

type Frame = ExcalidrawElement & { customData?: Record<string, unknown> };

const relOf = (el: ExcalidrawElement) => {
  const r = (el.customData as { relationship?: unknown } | undefined)
    ?.relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

/** Same population as sliceMetrics/diagnostics: engine-emitted non-aggregated
 * TFD arrows. */
function tfdArrowsOf(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.filter((el) => {
    if (el.type !== "arrow") {
      return false;
    }
    const r = relOf(el);
    return (
      r != null &&
      typeof r.source === "string" &&
      typeof r.target === "string" &&
      r.aggregated !== true
    );
  });
}

type Pt = { x: number; y: number };

/** Absolute rendered polyline of an arrow (≥2 points) or null. */
function polylineOf(el: ExcalidrawElement): Pt[] | null {
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return null;
  }
  return pts.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
}

function segsOf(poly: readonly Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    out.push({
      x1: poly[i]!.x,
      y1: poly[i]!.y,
      x2: poly[i + 1]!.x,
      y2: poly[i + 1]!.y,
    });
  }
  return out;
}

/** First non-zero-length segment direction, traversal order. */
function firstDir(poly: readonly Pt[]): Pt | null {
  for (let i = 0; i < poly.length - 1; i++) {
    const dx = poly[i + 1]!.x - poly[i]!.x;
    const dy = poly[i + 1]!.y - poly[i]!.y;
    if (dx !== 0 || dy !== 0) {
      return { x: dx, y: dy };
    }
  }
  return null;
}

/** Last non-zero-length segment direction, traversal order. */
function lastDir(poly: readonly Pt[]): Pt | null {
  for (let i = poly.length - 1; i > 0; i--) {
    const dx = poly[i]!.x - poly[i - 1]!.x;
    const dy = poly[i]!.y - poly[i - 1]!.y;
    if (dx !== 0 || dy !== 0) {
      return { x: dx, y: dy };
    }
  }
  return null;
}

/** Angle between two direction vectors, degrees ∈ [0, 180]. */
function angleBetweenDeg(u: Pt, v: Pt): number {
  const nu = Math.hypot(u.x, u.y);
  const nv = Math.hypot(v.x, v.y);
  if (nu === 0 || nv === 0) {
    return 0;
  }
  const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function arcLength(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    s += Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y);
  }
  return s;
}

const dist2 = (a: Pt, b: Pt): number =>
  (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

// ── dependency digraph + unique-shortest-path population ─────────────────────

type Digraph = {
  /** address → distinct out-neighbour addresses, ascending. */
  out: Map<string, string[]>;
  /** address → distinct in+out neighbour count (parallel arrows collapsed,
   * self-loops ignored) — the `br` degree convention. */
  degree: Map<string, number>;
  nodes: string[];
};

function digraphOf(
  arrows: ReadonlyArray<{ source: string; target: string }>,
): Digraph {
  const outSets = new Map<string, Set<string>>();
  const inSets = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const { source, target } of arrows) {
    if (source === target) {
      continue;
    }
    nodes.add(source);
    nodes.add(target);
    let o = outSets.get(source);
    if (!o) {
      o = new Set();
      outSets.set(source, o);
    }
    o.add(target);
    let i = inSets.get(target);
    if (!i) {
      i = new Set();
      inSets.set(target, i);
    }
    i.add(source);
  }
  const out = new Map<string, string[]>();
  const degree = new Map<string, number>();
  const sortedNodes = [...nodes].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  for (const n of sortedNodes) {
    out.set(
      n,
      [...(outSets.get(n) ?? [])].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1)),
    );
    degree.set(n, (outSets.get(n)?.size ?? 0) + (inSets.get(n)?.size ?? 0));
  }
  return { out, degree, nodes: sortedNodes };
}

/**
 * From `source`, every target with a UNIQUE shortest directed path of
 * PATH_MIN_HOPS..PATH_MAX_HOPS hops, with the path reconstructed. BFS with
 * shortest-path counting (counts capped at 2 — only uniqueness matters);
 * uniqueness ⇒ every node on the path has exactly one shortest predecessor,
 * so the `pred` chain reconstructs it.
 */
function uniqueShortestPathsFrom(
  g: Digraph,
  source: string,
): Array<{ target: string; addresses: string[] }> {
  const dist = new Map<string, number>();
  const ways = new Map<string, number>();
  const pred = new Map<string, string>();
  dist.set(source, 0);
  ways.set(source, 1);
  let frontier = [source];
  let d = 0;
  while (frontier.length > 0 && d < PATH_MAX_HOPS) {
    const next: string[] = [];
    for (const u of frontier) {
      const wu = ways.get(u)!;
      for (const v of g.out.get(u) ?? []) {
        const dv = dist.get(v);
        if (dv === undefined) {
          dist.set(v, d + 1);
          ways.set(v, Math.min(2, wu));
          pred.set(v, u);
          next.push(v);
        } else if (dv === d + 1) {
          ways.set(v, Math.min(2, ways.get(v)! + wu));
        }
      }
    }
    frontier = next;
    d += 1;
  }
  const out: Array<{ target: string; addresses: string[] }> = [];
  for (const [target, dt] of dist) {
    if (dt < PATH_MIN_HOPS || dt > PATH_MAX_HOPS || ways.get(target) !== 1) {
      continue;
    }
    const chain: string[] = [target];
    let cur = target;
    while (cur !== source) {
      cur = pred.get(cur)!;
      chain.push(cur);
    }
    chain.reverse();
    out.push({ target, addresses: chain });
  }
  return out;
}

/** Deterministic uniform sample of `max` keys from the ascending-sorted list:
 * partial Fisher–Yates over indices driven by mulberry32(seed), then the
 * selected keys are re-sorted ascending. */
function sampleSorted<T>(sortedItems: readonly T[], max: number, seed: number): T[] {
  if (sortedItems.length <= max) {
    return [...sortedItems];
  }
  const idx = sortedItems.map((_, i) => i);
  const rng = mulberry32(seed);
  for (let i = 0; i < max; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx
    .slice(0, max)
    .sort((a, b) => a - b)
    .map((i) => sortedItems[i]!);
}

// ── main entry ───────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeStrataPathMetrics(
  elements: readonly ExcalidrawElement[],
): StrataPathMetrics {
  // Primary-cluster centers by address (same resolution the diagnostics'
  // semantic-edge gate uses) — for polyline orientation + gdev bearings.
  const centerByAddress = new Map<string, Pt>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = (el as Frame).customData;
    if (cd?.terraformTopologyRole !== "primaryCluster") {
      continue;
    }
    const addr = cd?.terraformPrimaryAddress;
    if (typeof addr === "string") {
      centerByAddress.set(addr, {
        x: el.x + el.width / 2,
        y: el.y + el.height / 2,
      });
    }
  }

  // Rendered arrow per directed edge. Multiple parallel arrows for one
  // (source, target): keep the FIRST in element-array order (deterministic).
  type ArrowInfo = { source: string; target: string; poly: Pt[]; segs: Seg[] };
  const arrows: ArrowInfo[] = [];
  const arrowByEdge = new Map<string, ArrowInfo>();
  for (const el of tfdArrowsOf(elements)) {
    const r = relOf(el)!;
    const poly = polylineOf(el);
    if (!poly) {
      continue;
    }
    const info: ArrowInfo = {
      source: r.source as string,
      target: r.target as string,
      poly,
      segs: segsOf(poly),
    };
    arrows.push(info);
    const edgeKey = info.source + KEY_DELIM + info.target;
    if (!arrowByEdge.has(edgeKey)) {
      arrowByEdge.set(edgeKey, info);
    }
  }

  const g = digraphOf(arrows);

  // Population: unique shortest 2–5-hop paths, canonical order, seeded sample.
  const allPaths: Array<{ key: string; addresses: string[] }> = [];
  for (const source of g.nodes) {
    for (const p of uniqueShortestPathsFrom(g, source)) {
      allPaths.push({ key: canonicalPathKey(p.addresses), addresses: p.addresses });
    }
  }
  allPaths.sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1));
  const populationTotal = allPaths.length;
  const sampledPaths = sampleSorted(allPaths, PATH_SAMPLE_MAX, BOOTSTRAP_SEED);

  /** Orient a path edge's polyline so it starts nearer the FROM node's center
   * (the engine draws source→target, but orientation is verified geometrically
   * so a builder that reverses point order cannot silently flip traversal). */
  const orientedPoly = (info: ArrowInfo, from: string): Pt[] => {
    const c = centerByAddress.get(from);
    if (!c) {
      return info.poly;
    }
    const start = info.poly[0]!;
    const end = info.poly[info.poly.length - 1]!;
    return dist2(start, c) <= dist2(end, c) ? info.poly : [...info.poly].reverse();
  };

  const rows: PathMetricsRow[] = [];
  const coveredEdges = new Set<string>();
  const hopHistogram: Record<number, number> = {};
  let unresolvedPathCount = 0;

  for (const path of sampledPaths) {
    const a = path.addresses;
    const k = a.length - 1;
    const edgeInfos: ArrowInfo[] = [];
    let resolved = true;
    for (let i = 0; i < k; i++) {
      const info = arrowByEdge.get(a[i]! + KEY_DELIM + a[i + 1]!);
      if (!info) {
        resolved = false;
        break;
      }
      edgeInfos.push(info);
    }
    if (!resolved) {
      unresolvedPathCount += 1;
      continue;
    }

    const polys = edgeInfos.map((info, i) => orientedPoly(info, a[i]!));

    // con — angular deviation from straight-through at intermediate nodes.
    let con = 0;
    for (let i = 0; i < k - 1; i++) {
      const din = lastDir(polys[i]!);
      const dout = firstDir(polys[i + 1]!);
      if (din && dout) {
        con += angleBetweenDeg(din, dout);
      }
    }

    // cr — distinct non-path arrows properly crossing any path arrow. An
    // arrow sharing a graph endpoint (address) with the path edge it would
    // cross is excluded for that pair (edges meeting at a shared node do not
    // "cross" — matches the segment kernel's endpoint-sharing rule at the
    // graph level).
    const pathArrowSet = new Set(edgeInfos);
    let cr = 0;
    for (const other of arrows) {
      if (pathArrowSet.has(other)) {
        continue;
      }
      let crosses = false;
      for (const pe of edgeInfos) {
        if (
          other.source === pe.source ||
          other.source === pe.target ||
          other.target === pe.source ||
          other.target === pe.target
        ) {
          continue;
        }
        for (const sa of other.segs) {
          for (const sb of pe.segs) {
            if (segmentsCross(sa, sb)) {
              crosses = true;
              break;
            }
          }
          if (crosses) {
            break;
          }
        }
        if (crosses) {
          break;
        }
      }
      if (crosses) {
        cr += 1;
      }
    }

    // tll — total rendered arc length.
    const tll = polys.reduce((s, p) => s + arcLength(p), 0);

    // br — Σ max(0, degree−2) over intermediate nodes (layout-invariant).
    let br = 0;
    for (let i = 1; i < a.length - 1; i++) {
      br += Math.max(0, (g.degree.get(a[i]!) ?? 0) - 2);
    }

    const rtHat =
      WARE_COEF_HOPS * k +
      WARE_COEF_CONTINUITY * con +
      WARE_COEF_CROSSINGS_ON_PATH * cr +
      WARE_COEF_BRANCHES * br;

    // gdev — per-edge deviation of the rendered chord from the straight
    // bearing to the path's final node (geodesic-tendency proxy, report-only).
    let gdevMaxDeg = 0;
    const targetCenter = centerByAddress.get(a[a.length - 1]!);
    if (targetCenter) {
      for (let i = 0; i < k; i++) {
        const startCenter = centerByAddress.get(a[i]!);
        const poly = polys[i]!;
        const chord: Pt = {
          x: poly[poly.length - 1]!.x - poly[0]!.x,
          y: poly[poly.length - 1]!.y - poly[0]!.y,
        };
        if (startCenter && (chord.x !== 0 || chord.y !== 0)) {
          const bearing: Pt = {
            x: targetCenter.x - startCenter.x,
            y: targetCenter.y - startCenter.y,
          };
          if (bearing.x !== 0 || bearing.y !== 0) {
            gdevMaxDeg = Math.max(gdevMaxDeg, angleBetweenDeg(chord, bearing));
          }
        }
      }
    }

    for (let i = 0; i < k; i++) {
      coveredEdges.add(a[i]! + KEY_DELIM + a[i + 1]!);
    }
    hopHistogram[k] = (hopHistogram[k] ?? 0) + 1;
    rows.push({
      pathKey: path.key,
      addresses: a,
      k,
      con: round2(con),
      cr,
      tll: round2(tll),
      br,
      rtHat: round2(rtHat),
      gdevMaxDeg: round2(gdevMaxDeg),
    });
  }

  return {
    populationTotal,
    sampled: sampledPaths.length,
    hopHistogram,
    edgeCoverage:
      arrowByEdge.size > 0
        ? round2(coveredEdges.size / arrowByEdge.size)
        : 0,
    unresolvedPathCount,
    rows,
  };
}

// ── paired comparison (proposal §3) ──────────────────────────────────────────

export type PairedPathMetricsCi = {
  /** Headline M-RT, both statistics — each bootstrapped ON its statistic. */
  rtHatP50: BootstrapCiResult;
  rtHatP90: BootstrapCiResult;
  /** Component no-regress gates. */
  conP90: BootstrapCiResult;
  crP90: BootstrapCiResult;
  tllP50: BootstrapCiResult;
};

/**
 * Pair baseline vs candidate path rows by canonical path key and bootstrap the
 * v3.2 gate statistics. The 20% unmatched-void rule is inherited from
 * `pairedBootstrapCi` (unmatched path keys void the cell exactly like
 * unmatched edge keys).
 */
export function pairedPathMetricsCi(
  baselineRows: readonly PathMetricsRow[],
  candidateRows: readonly PathMetricsRow[],
): PairedPathMetricsCi {
  const mapOf = (
    rows: readonly PathMetricsRow[],
    pick: (r: PathMetricsRow) => number,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.pathKey, pick(r));
    }
    return m;
  };
  const ci = (
    pick: (r: PathMetricsRow) => number,
    statistic: "p50" | "p90",
  ): BootstrapCiResult =>
    pairedBootstrapCi(
      {
        baseline: mapOf(baselineRows, pick),
        candidate: mapOf(candidateRows, pick),
      },
      { statistic },
    );
  return {
    rtHatP50: ci((r) => r.rtHat, "p50"),
    rtHatP90: ci((r) => r.rtHat, "p90"),
    conP90: ci((r) => r.con, "p90"),
    crP90: ci((r) => r.cr, "p90"),
    tllP50: ci((r) => r.tll, "p50"),
  };
}
