/**
 * A4 diff-stability metric family (rcll-v2 spec v2.0 §6-A4 + v3.1 §3, WP-3d /
 * M1b W3). Measurement-only: this module owns NO layout behavior. It compares
 * two final Excalidraw element arrays (L_old, L_new) — typically the same graph
 * laid out before/after a one-resource / one-edge / moved{}-rename edit — and
 * reports how much the layout churned.
 *
 * Metrics (all over the STABLE set U, defined below):
 *   M1_rel   — mean Sondag relative-position distance over ordered U×U pairs
 *   M2_flip  — within-column order-inversion rate
 *   M3_disp  — median / p95 |Δpos| (SUPPLEMENTARY, never gated — v2.0 §6-A4)
 *   M4_disp95— p95 |Δpos − per-column rigid shift| (v3.1 §3, tiered shift)
 *   M5_hull  — 1 − ARI(parent-hull partition old vs new) (v3.1 §3)
 *
 * U (v2.0 §6-A4): addresses present in BOTH layouts with an unchanged interim
 * CONTENT HASH. The spec's hash is "address + sorted incident E′ endpoints +
 * parent path + collapse classification, computed inside S2". S2's disposition
 * is not stamped onto scene elements, so this scene-side computation uses these
 * faithful stand-ins (documented deviations):
 *   - incident E′ endpoints → incident RENDERED-TFD-arrow endpoints (the drawn
 *     edges are E′ as rendered); each token encodes direction-role + the OTHER
 *     endpoint's (rename-mapped) address + relKind, so a topology-preserving
 *     move keeps the hash stable while an added/removed edge changes it.
 *   - parent path → the 3-tier resolved cluster path (own topology path →
 *     terraformCompoundParentKey → geometric containment), MIRRORING
 *     terraformPipelineSliceMetrics.ts's `resolveClusterPath` (that file
 *     deliberately duplicates rather than exports these readers to stay
 *     additive; this module follows the same precedent).
 *   - collapse classification → `terraformCollapseClass` when a frame carries
 *     it, else the primary-cluster role string ("primaryCluster") as the
 *     stand-in (per WP-3d brief; effectively constant today — swap for the real
 *     S2 signal when S10 stamps it).
 *
 * moved{}-rename: an optional `renames` map (oldAddress → newAddress) is applied
 * to the OLD layout BEFORE the U intersection — both the node's own address and
 * the OTHER-endpoint addresses inside incident tokens are remapped; topology
 * path segments are NOT (renames are cluster-address renames only). The
 * mapping MUST be injective in effect: if two distinct original addresses
 * fold onto the same canonical address, `buildLayoutIndex` THROWS
 * ("Strata A4 churn: non-injective rename map …") rather than silently
 * picking a "later insertion wins" survivor — this is measurement code, so a
 * loud failure on an ill-formed rename map is correct.
 *
 * Column identity (M2/M4): a node's column is its bbox LEFT EDGE (el.x). The
 * engines pin cluster frames to a shared columnX, so equal x ⇒ same column —
 * the same convention terraformPipelineSliceMetrics.ts uses.
 *
 * Determinism (C4′): code-unit `<`/`>` comparators only (see
 * `compareStrataContentKeys`); no localeCompare, no Date/random.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type { Rect } from "./terraformPipelineTopologyGeometry";

// ── scene element readers (mirror terraformPipelineSliceMetrics.ts's private
// roleOf/pathOf/addressOf/resolveClusterPath; duplicated, not imported, so this
// stays additive-only w.r.t. that module — see file-header note) ─────────────

type Frame = ExcalidrawElement & { customData?: Record<string, unknown> };

const TOPOLOGY_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const roleOf = (el: Frame): string =>
  typeof el.customData?.terraformTopologyRole === "string"
    ? (el.customData.terraformTopologyRole as string)
    : "";

const pathOf = (el: Frame): string[] => {
  const p = el.customData?.terraformTopologyPath;
  return Array.isArray(p)
    ? (p.filter((s) => typeof s === "string") as string[])
    : [];
};

const addressOf = (el: Frame): string | null => {
  const a = el.customData?.terraformPrimaryAddress;
  return typeof a === "string" ? a : null;
};

const topologyKeyOf = (el: Frame): string | null => {
  const k = el.customData?.terraformTopologyKey;
  return typeof k === "string" ? k : typeof el.id === "string" ? el.id : null;
};

const compoundParentKeyOf = (el: Frame): string | null => {
  const k = el.customData?.terraformCompoundParentKey;
  return typeof k === "string" ? k : null;
};

const collapseClassOf = (el: Frame): string => {
  const c = el.customData?.terraformCollapseClass;
  if (typeof c === "string") {
    return c;
  }
  // Stand-in until S2's collapse classification is stamped on elements.
  return roleOf(el) || "unknown";
};

const rectOf = (el: ExcalidrawElement): Rect => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
});

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

const relOf = (el: ExcalidrawElement) => {
  const r = (el.customData as { relationship?: unknown } | undefined)
    ?.relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

/** TFD arrows regardless of isDeleted — MUST match diagnosePipelineScene's
 * tfdArrows filter (mirrors terraformPipelineSliceMetrics.ts). */
type TfdEdge = { source: string; target: string; relKind: string };

function tfdEdgesOf(elements: readonly ExcalidrawElement[]): TfdEdge[] {
  const out: TfdEdge[] = [];
  for (const el of elements) {
    if (el.type !== "arrow") {
      continue;
    }
    const r = relOf(el);
    if (
      r == null ||
      typeof r.source !== "string" ||
      typeof r.target !== "string" ||
      r.aggregated === true
    ) {
      continue;
    }
    out.push({
      source: r.source,
      target: r.target,
      // relKind = relationship.type (true direction, never swapped). "" when
      // absent so parallel edges of differing kinds still separate.
      relKind: typeof r.type === "string" ? r.type : "",
    });
  }
  return out;
}

const centerOf = (r: Rect): { x: number; y: number } => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

// ── rendered parent-hull identity (M5), geometric + per-layout ──────────────

type HullFrame = { path: string[]; rect: Rect };

function collectHullFrames(
  elements: readonly ExcalidrawElement[],
): HullFrame[] {
  const out: HullFrame[] = [];
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const f = el as Frame;
    if (!TOPOLOGY_ROLES.has(roleOf(f))) {
      continue;
    }
    out.push({ path: pathOf(f), rect: rectOf(f) });
  }
  return out;
}

/**
 * Deepest topology frame (by path length) whose rect contains `rect`; its
 * NUL-joined path is the RENDERED parent-hull identity ("" = root, no
 * containing hull). This is GEOMETRIC and computed independently within each
 * layout, so M5 varies only when the rendered hull grouping actually changes —
 * even though the hash's semantic parent path (used for U) is stable. Ties on
 * path length keep the first (deterministic given deterministic element order).
 */
function deepestHullLabel(rect: Rect, hulls: readonly HullFrame[]): string {
  let best: string[] | null = null;
  for (const h of hulls) {
    if (
      rectContains(h.rect, rect) &&
      (best === null || h.path.length > best.length)
    ) {
      best = h.path;
    }
  }
  return best === null ? "" : best.join("\0");
}

// ── U-set: content-hashed stable nodes ──────────────────────────────────────

type NodeRec = {
  /** Rename-mapped (canonical / new-space) address. */
  address: string;
  rect: Rect;
  path: string[];
  contentHash: string;
};

/**
 * Build the per-address node records for ONE layout, addresses+incident
 * endpoints mapped through `mapAddr` (identity for the new layout; renames for
 * the old layout, so both live in new-address space before the U intersection).
 */
function buildLayoutIndex(
  elements: readonly ExcalidrawElement[],
  mapAddr: (a: string) => string,
): Map<string, NodeRec> {
  const frames = elements.filter(
    (el): el is Frame => el.type === "frame" && !el.isDeleted,
  );

  // Topology frames for 3-tier path resolution.
  const topoByTopologyKey = new Map<string, { path: string[]; rect: Rect }>();
  const topoList: Array<{ path: string[]; rect: Rect }> = [];
  for (const f of frames) {
    if (!TOPOLOGY_ROLES.has(roleOf(f))) {
      continue;
    }
    const path = pathOf(f);
    const rect = rectOf(f);
    const tKey = topologyKeyOf(f);
    if (tKey) {
      topoByTopologyKey.set(tKey, { path, rect });
    }
    topoList.push({ path, rect });
  }

  const resolvePath = (f: Frame): string[] => {
    const own = pathOf(f);
    if (own.length > 0) {
      return own;
    }
    const parentKey = compoundParentKeyOf(f);
    if (parentKey) {
      const parent = topoByTopologyKey.get(parentKey);
      if (parent) {
        return [...parent.path];
      }
    }
    const rect = rectOf(f);
    let best: string[] = [];
    for (const t of topoList) {
      if (t.path.length > best.length && rectContains(t.rect, rect)) {
        best = t.path;
      }
    }
    return [...best];
  };

  // First pass: cluster frames by ORIGINAL address (for incident lookups).
  type Raw = {
    origAddress: string;
    address: string;
    rect: Rect;
    path: string[];
    collapseClass: string;
  };
  const rawByOrig = new Map<string, Raw>();
  for (const f of frames) {
    if (roleOf(f) !== "primaryCluster") {
      continue;
    }
    const orig = addressOf(f);
    if (!orig) {
      continue;
    }
    rawByOrig.set(orig, {
      origAddress: orig,
      address: mapAddr(orig),
      rect: rectOf(f),
      path: resolvePath(f),
      collapseClass: collapseClassOf(f),
    });
  }

  // Incident tokens per ORIGINAL address (endpoints mapped to canonical space).
  const incident = new Map<string, string[]>();
  const pushIncident = (orig: string, token: string) => {
    const arr = incident.get(orig);
    if (arr) {
      arr.push(token);
    } else {
      incident.set(orig, [token]);
    }
  };
  for (const e of tfdEdgesOf(elements)) {
    const sMapped = mapAddr(e.source);
    const tMapped = mapAddr(e.target);
    // Only tokens for endpoints that are actual clusters in THIS layout.
    if (rawByOrig.has(e.source)) {
      pushIncident(e.source, `out|${tMapped}|${e.relKind}`);
    }
    if (rawByOrig.has(e.target)) {
      pushIncident(e.target, `in|${sMapped}|${e.relKind}`);
    }
  }

  const out = new Map<string, NodeRec>();
  // Non-injective effective mapping guard (FIX-5, codex-review WP-3f): if two
  // DISTINCT original addresses fold onto the same canonical address (a
  // non-injective `renames` map on the old layout, or — degenerately — a
  // duplicate origAddress on the new/identity layout), throw rather than let
  // "later insertion wins" silently pick a winner. This is measurement code:
  // a loud failure here is correct, not a UX regression.
  const origByCanonical = new Map<string, string>();
  for (const raw of rawByOrig.values()) {
    const inc = (incident.get(raw.origAddress) ?? []).sort(
      compareStrataContentKeys,
    );
    const contentHash =
      `a=${raw.address}` +
      `|inc=${inc.join(",")}` +
      `|p=${raw.path.join("\0")}` +
      `|c=${raw.collapseClass}`;
    const priorOrig = origByCanonical.get(raw.address);
    if (priorOrig !== undefined) {
      throw new Error(
        `Strata A4 churn: non-injective rename map — original addresses "${priorOrig}" and "${raw.origAddress}" both fold onto canonical address "${raw.address}"`,
      );
    }
    origByCanonical.set(raw.address, raw.origAddress);
    out.set(raw.address, {
      address: raw.address,
      rect: raw.rect,
      path: raw.path,
      contentHash,
    });
  }
  return out;
}

// ── M1_rel: Sondag 8-sector relative position (v2.0 §6-A4, Fig 17) ──────────

/**
 * Area fractions of `other`'s bbox inside the 8 sectors formed by extending
 * `ref`'s four sides. Order: [E, NE, N, NW, W, SW, S, SE]. The CENTER cell
 * (overlap with ref's own column∩row band) is excluded, so the returned
 * fractions sum to ≤ 1. A degenerate (zero-area) `other` is treated as its
 * center POINT ⇒ each fraction ∈ {0,1} (v2.0 §6-A4). Screen coords: N = smaller
 * y (up); the labelling is cosmetic — the metric only differences matched
 * sectors, so orientation never affects M1_rel.
 */
export function sectorAreaFractions(ref: Rect, other: Rect): number[] {
  const ax0 = ref.x;
  const ax1 = ref.x + ref.width;
  const ay0 = ref.y;
  const ay1 = ref.y + ref.height;

  const otherArea = other.width * other.height;
  if (otherArea <= 0) {
    // Point-in-region: locate other's center, assign 1 to that sector (0 if it
    // lands in ref's own center cell).
    const cx = other.x + other.width / 2;
    const cy = other.y + other.height / 2;
    const col = cx < ax0 ? -1 : cx > ax1 ? 1 : 0; // W/-, C/0, E/+
    const row = cy < ay0 ? -1 : cy > ay1 ? 1 : 0; // N/-, C/0, S/+
    // [E, NE, N, NW, W, SW, S, SE]
    return [
      col === 1 && row === 0 ? 1 : 0, // E
      col === 1 && row === -1 ? 1 : 0, // NE
      col === 0 && row === -1 ? 1 : 0, // N
      col === -1 && row === -1 ? 1 : 0, // NW
      col === -1 && row === 0 ? 1 : 0, // W
      col === -1 && row === 1 ? 1 : 0, // SW
      col === 0 && row === 1 ? 1 : 0, // S
      col === 1 && row === 1 ? 1 : 0, // SE
    ];
  }

  const bx0 = other.x;
  const bx1 = other.x + other.width;
  const by0 = other.y;
  const by1 = other.y + other.height;

  const wW = Math.max(0, Math.min(bx1, ax0) - bx0);
  const wC = Math.max(0, Math.min(bx1, ax1) - Math.max(bx0, ax0));
  const wE = Math.max(0, bx1 - Math.max(bx0, ax1));
  const hN = Math.max(0, Math.min(by1, ay0) - by0);
  const hC = Math.max(0, Math.min(by1, ay1) - Math.max(by0, ay0));
  const hS = Math.max(0, by1 - Math.max(by0, ay1));

  // [E, NE, N, NW, W, SW, S, SE]
  return [
    (wE * hC) / otherArea, // E
    (wE * hN) / otherArea, // NE
    (wC * hN) / otherArea, // N
    (wW * hN) / otherArea, // NW
    (wW * hC) / otherArea, // W
    (wW * hS) / otherArea, // SW
    (wC * hS) / otherArea, // S
    (wE * hS) / otherArea, // SE
  ];
}

/** D_rel(a,b) = ½ Σ_{k=1..8} |p^k_old − p^k_new| ∈ [0,1]. */
function relativePositionDistance(
  aOld: Rect,
  bOld: Rect,
  aNew: Rect,
  bNew: Rect,
): number {
  const pOld = sectorAreaFractions(aOld, bOld);
  const pNew = sectorAreaFractions(aNew, bNew);
  let s = 0;
  for (let k = 0; k < 8; k++) {
    s += Math.abs(pOld[k]! - pNew[k]!);
  }
  return s / 2;
}

// ── ARI (M5) ────────────────────────────────────────────────────────────────

const comb2 = (x: number): number => (x * (x - 1)) / 2;

/**
 * sklearn adjusted_rand_score conventions: identical single-cluster (or
 * all-singleton) partitions ⇒ ARI ≡ 1. `labelsA`/`labelsB` are paired
 * per-element cluster labels (same index = same element).
 */
export function adjustedRandIndex(
  labelsA: readonly string[],
  labelsB: readonly string[],
): number {
  const n = labelsA.length;
  if (n < 2) {
    return 1;
  }
  const cont = new Map<string, number>();
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const a = labelsA[i]!;
    const b = labelsB[i]!;
    const key = `${a}\0${b}`;
    cont.set(key, (cont.get(key) ?? 0) + 1);
    rows.set(a, (rows.get(a) ?? 0) + 1);
    cols.set(b, (cols.get(b) ?? 0) + 1);
  }
  let sumCombC = 0;
  for (const v of cont.values()) {
    sumCombC += comb2(v);
  }
  let sumCombA = 0;
  for (const v of rows.values()) {
    sumCombA += comb2(v);
  }
  let sumCombB = 0;
  for (const v of cols.values()) {
    sumCombB += comb2(v);
  }
  const totalPairs = comb2(n);
  if (totalPairs === 0) {
    return 1;
  }
  const expectedIndex = (sumCombA * sumCombB) / totalPairs;
  const maxIndex = (sumCombA + sumCombB) / 2;
  const denom = maxIndex - expectedIndex;
  // Degenerate (both all-one-cluster or both all-singleton) ⇒ ARI ≡ 1.
  if (denom === 0) {
    return 1;
  }
  return (sumCombC - expectedIndex) / denom;
}

// ── percentiles ──────────────────────────────────────────────────────────────

function percentileAt(sortedAsc: readonly number[], fraction: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  return sortedAsc[
    Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * fraction))
  ]!;
}

function medianOf(xs: readonly number[]): number {
  return percentileAt(
    [...xs].sort((a, b) => a - b),
    0.5,
  );
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── result shape ─────────────────────────────────────────────────────────────

export type M4Status = "ok" | "inconclusive" | "vacuous";
export type M5Status = "ok" | "vacuous";

export type ChurnMetrics = {
  U: {
    size: number;
    oldAddressCount: number;
    newAddressCount: number;
    /** addresses present in both layouts REGARDLESS of hash. */
    commonAddressCount: number;
    /** size / commonAddressCount — fraction of common nodes that are stable. */
    unchangedRatio: number;
    nMin: number;
    /** |U| ≥ nMin — gate precondition for M4/M5. */
    gatable: boolean;
  };
  m1Rel: number;
  m2Flip: {
    value: number;
    inversions: number;
    /** pairs sharing a column in BOTH layouts with a defined order in both. */
    comparedPairs: number;
  };
  /** SUPPLEMENTARY — never gated (v2.0 §6-A4). */
  m3Disp: { median: number; p95: number };
  m4: {
    value: number;
    /** fraction of U estimated by its OWN column (≥3 same-column members). */
    coverageRatio: number;
    status: M4Status;
  };
  m5: {
    value: number;
    ari: number;
    distinctHullsOld: number;
    distinctHullsNew: number;
    status: M5Status;
  };
};

export type ChurnMetricsOptions = {
  /** moved{}-rename map (oldAddress → newAddress), applied to the OLD layout. */
  renames?: Record<string, string>;
  /** N_min (frozen v3.1 §12 = 20) — M4/M5 gate precondition. */
  nMin?: number;
  /** M4 coverage floor below which M4 = INCONCLUSIVE (frozen v3.1 §12 = 0.5). */
  m4CoverageFloor?: number;
};

const DEFAULT_N_MIN = 20;
const DEFAULT_M4_COVERAGE_FLOOR = 0.5;

// ── main ─────────────────────────────────────────────────────────────────────

export function computeStrataChurnMetrics(
  oldElements: readonly ExcalidrawElement[],
  newElements: readonly ExcalidrawElement[],
  opts: ChurnMetricsOptions = {},
): ChurnMetrics {
  const renames = opts.renames ?? {};
  const nMin = opts.nMin ?? DEFAULT_N_MIN;
  const m4Floor = opts.m4CoverageFloor ?? DEFAULT_M4_COVERAGE_FLOOR;

  const mapOld = (a: string): string =>
    Object.prototype.hasOwnProperty.call(renames, a) ? renames[a]! : a;
  const identity = (a: string): string => a;

  const oldIdx = buildLayoutIndex(oldElements, mapOld);
  const newIdx = buildLayoutIndex(newElements, identity);

  // U in deterministic (code-unit) address order.
  type UNode = {
    address: string;
    oldRect: Rect;
    newRect: Rect;
  };
  const uNodes: UNode[] = [];
  let commonAddressCount = 0;
  const sortedNewAddrs = [...newIdx.keys()].sort(compareStrataContentKeys);
  for (const addr of sortedNewAddrs) {
    const oldRec = oldIdx.get(addr);
    if (!oldRec) {
      continue;
    }
    commonAddressCount += 1;
    const newRec = newIdx.get(addr)!;
    if (oldRec.contentHash !== newRec.contentHash) {
      continue;
    }
    uNodes.push({
      address: addr,
      oldRect: oldRec.rect,
      newRect: newRec.rect,
    });
  }
  const uSize = uNodes.length;
  const gatable = uSize >= nMin;

  // ── M1_rel: mean over ordered U×U pairs ────────────────────────────────────
  let m1Sum = 0;
  let m1Pairs = 0;
  for (let i = 0; i < uNodes.length; i++) {
    for (let j = 0; j < uNodes.length; j++) {
      if (i === j) {
        continue;
      }
      m1Sum += relativePositionDistance(
        uNodes[i]!.oldRect,
        uNodes[j]!.oldRect,
        uNodes[i]!.newRect,
        uNodes[j]!.newRect,
      );
      m1Pairs += 1;
    }
  }
  const m1Rel = m1Pairs > 0 ? round4(m1Sum / m1Pairs) : 0;

  // ── M2_flip: within-column inversion rate (shared column in BOTH) ─────────
  let inversions = 0;
  let comparedPairs = 0;
  for (let i = 0; i < uNodes.length; i++) {
    for (let j = i + 1; j < uNodes.length; j++) {
      const a = uNodes[i]!;
      const b = uNodes[j]!;
      const sameColOld = a.oldRect.x === b.oldRect.x;
      const sameColNew = a.newRect.x === b.newRect.x;
      if (!sameColOld || !sameColNew) {
        continue;
      }
      const dyOld = centerOf(a.oldRect).y - centerOf(b.oldRect).y;
      const dyNew = centerOf(a.newRect).y - centerOf(b.newRect).y;
      if (dyOld === 0 || dyNew === 0) {
        // Undefined order in a layout — excluded (mirrors churn-probe policy).
        continue;
      }
      comparedPairs += 1;
      if (Math.sign(dyOld) !== Math.sign(dyNew)) {
        inversions += 1;
      }
    }
  }
  const m2Flip = comparedPairs > 0 ? round4(inversions / comparedPairs) : 0;

  // ── displacement vectors (M3 + M4) ─────────────────────────────────────────
  const disp = uNodes.map((u) => {
    const co = centerOf(u.oldRect);
    const cn = centerOf(u.newRect);
    return { dx: cn.x - co.x, dy: cn.y - co.y, oldColX: u.oldRect.x };
  });
  const absDisp = disp.map((d) => Math.hypot(d.dx, d.dy)).sort((a, b) => a - b);
  const m3Disp = {
    median: round4(percentileAt(absDisp, 0.5)),
    p95: round4(percentileAt(absDisp, 0.95)),
  };

  // ── M4_disp95: p95 residual after per-column rigid shift ────────────────────
  // Columns by OLD left edge; rank order = ascending x.
  const byOldCol = new Map<number, number[]>(); // colX → indices into disp
  for (let i = 0; i < disp.length; i++) {
    const x = disp[i]!.oldColX;
    const arr = byOldCol.get(x);
    if (arr) {
      arr.push(i);
    } else {
      byOldCol.set(x, [i]);
    }
  }
  const sortedColXs = [...byOldCol.keys()].sort((a, b) => a - b);
  const colRank = new Map<number, number>();
  sortedColXs.forEach((x, r) => colRank.set(x, r));

  const medianPair = (idxs: readonly number[]): { dx: number; dy: number } => ({
    dx: medianOf(idxs.map((i) => disp[i]!.dx)),
    dy: medianOf(idxs.map((i) => disp[i]!.dy)),
  });
  const globalShift =
    disp.length > 0 ? medianPair(disp.map((_, i) => i)) : { dx: 0, dy: 0 };

  let ownColumnCovered = 0;
  const residuals: number[] = [];
  for (let i = 0; i < disp.length; i++) {
    const x = disp[i]!.oldColX;
    const ownCol = byOldCol.get(x)!;
    let shift: { dx: number; dy: number };
    if (ownCol.length >= 3) {
      shift = medianPair(ownCol);
      ownColumnCovered += 1;
    } else {
      // ±1 rank-band neighbourhood.
      const r = colRank.get(x)!;
      const band: number[] = [];
      for (const [cx, idxs] of byOldCol) {
        const cr = colRank.get(cx)!;
        if (Math.abs(cr - r) <= 1) {
          band.push(...idxs);
        }
      }
      if (band.length >= 3) {
        shift = medianPair(band);
      } else {
        shift = globalShift;
      }
    }
    residuals.push(Math.hypot(disp[i]!.dx - shift.dx, disp[i]!.dy - shift.dy));
  }
  residuals.sort((a, b) => a - b);
  const m4Value = round4(percentileAt(residuals, 0.95));
  const coverageRatio =
    disp.length > 0 ? round4(ownColumnCovered / disp.length) : 0;
  const m4Status: M4Status = !gatable
    ? "vacuous"
    : coverageRatio < m4Floor
    ? "inconclusive"
    : "ok";

  // ── M5_hull: 1 − ARI(parent-hull partition old vs new) ─────────────────────
  // Partition by GEOMETRIC rendered-hull containment, independently per layout.
  const oldHulls = collectHullFrames(oldElements);
  const newHulls = collectHullFrames(newElements);
  const labelsOld = uNodes.map((u) => deepestHullLabel(u.oldRect, oldHulls));
  const labelsNew = uNodes.map((u) => deepestHullLabel(u.newRect, newHulls));
  const distinctHullsOld = new Set(labelsOld).size;
  const distinctHullsNew = new Set(labelsNew).size;
  const ari = adjustedRandIndex(labelsOld, labelsNew);
  // Range [0,1.5]; NOT clamped (clamp for display only, never before gating).
  const m5Value = round4(1 - ari);
  const m5Vacuous = !gatable || (distinctHullsOld < 2 && distinctHullsNew < 2);
  const m5Status: M5Status = m5Vacuous ? "vacuous" : "ok";

  return {
    U: {
      size: uSize,
      oldAddressCount: oldIdx.size,
      newAddressCount: newIdx.size,
      commonAddressCount,
      unchangedRatio:
        commonAddressCount > 0 ? round4(uSize / commonAddressCount) : 0,
      nMin,
      gatable,
    },
    m1Rel,
    m2Flip: { value: m2Flip, inversions, comparedPairs },
    m3Disp,
    m4: { value: m4Value, coverageRatio, status: m4Status },
    m5: {
      value: m5Value,
      ari: round4(ari),
      distinctHullsOld,
      distinctHullsNew,
      status: m5Status,
    },
  };
}
