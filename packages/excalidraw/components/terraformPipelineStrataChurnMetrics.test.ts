/**
 * Unit fixtures for the A4 diff-stability metric family (WP-3d, rcll-v2 spec
 * v2.0 §6-A4 + v3.1 §3). Hand-built old/new element arrays; every metric's true
 * value is derived by construction in the comments. Element shapes mirror what
 * terraformPipelineSliceMetrics.test.ts builds (frames + arrows carrying the
 * customData that pipelineFrameCustomData stamps).
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  adjustedRandIndex,
  computeStrataChurnMetrics,
  sectorAreaFractions,
} from "./terraformPipelineStrataChurnMetrics";

// ── element factories ───────────────────────────────────────────────────────

let idSeq = 0;
const nid = () => `el-${idSeq++}`;

/** A primary-cluster frame. `stampPath` = its own terraformTopologyPath (the
 * stable SEMANTIC parent used in the content hash); null ⇒ omitted. */
function pcluster(
  address: string,
  stampPath: string[] | null,
  x: number,
  y: number,
  w = 20,
  h = 20,
): ExcalidrawElement {
  const customData: Record<string, unknown> = {
    terraformTopologyRole: "primaryCluster",
    terraformPrimaryAddress: address,
  };
  if (stampPath) {
    customData.terraformTopologyPath = stampPath;
  }
  return {
    id: address,
    type: "frame",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    isDeleted: false,
    customData,
  } as unknown as ExcalidrawElement;
}

/** A bare primary-cluster: no stamped path ⇒ hash parent resolves geometrically
 * (or root when no hull frame contains it). */
const bcluster = (address: string, x: number, y: number, w = 20, h = 20) =>
  pcluster(address, null, x, y, w, h);

/** A topology (hull) frame used only for M5 geometric containment. */
function hull(
  path: string[],
  x: number,
  y: number,
  w: number,
  h: number,
): ExcalidrawElement {
  return {
    id: `hull:${path.join("/")}`,
    type: "frame",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "region",
      terraformTopologyKey: path.join("/"),
      terraformTopologyPath: path,
    },
  } as unknown as ExcalidrawElement;
}

/** A TFD arrow (points are irrelevant to A4 — only the relationship matters). */
function edge(
  source: string,
  target: string,
  relKind?: string,
): ExcalidrawElement {
  const relationship: Record<string, unknown> = {
    source,
    target,
    aggregated: false,
  };
  if (relKind) {
    relationship.type = relKind;
  }
  return {
    id: nid(),
    type: "arrow",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    points: [
      [0, 0],
      [1, 1],
    ],
    angle: 0,
    isDeleted: false,
    customData: { relationship },
  } as unknown as ExcalidrawElement;
}

// ── M1_rel: Sondag 8-sector relative position ───────────────────────────────

describe("sectorAreaFractions (8-sector geometry, hand-verified)", () => {
  it("splits a box across S and SE by exact area fractions", () => {
    // ref = [0,0]-[10,10]; other = x5 y20 w20 h10 ⇒ [5,20]-[25,30].
    //   x-overlap: wW=0, wC=min(25,10)-max(5,0)=5, wE=25-max(5,10)=15
    //   y-overlap: hN=0, hC=0 (other is fully below ay1=10), hS=30-20=10
    //   S  = wC*hS = 5*10 = 50 ; SE = wE*hS = 15*10 = 150 ; area(other)=200
    //   ⇒ p^S = 0.25, p^SE = 0.75 (rest 0). Order [E,NE,N,NW,W,SW,S,SE].
    const p = sectorAreaFractions(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 20, width: 20, height: 10 },
    );
    expect(p).toHaveLength(8);
    expect(p[6]).toBeCloseTo(0.25, 12); // S
    expect(p[7]).toBeCloseTo(0.75, 12); // SE
    expect(p[0]! + p[1]! + p[2]! + p[3]! + p[4]! + p[5]!).toBeCloseTo(0, 12);
  });

  it("treats a zero-area 'other' as its center point (fraction ∈ {0,1})", () => {
    // point at (25,25) is East (x>10) and South (y>10) of ref ⇒ pure SE.
    const p = sectorAreaFractions(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 25, y: 25, width: 0, height: 0 },
    );
    expect(p[7]).toBe(1); // SE
    expect(p.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("M1_rel", () => {
  it("is 0 for identical layouts (invariance)", () => {
    const build = () => [
      bcluster("a", 0, 0),
      bcluster("b", 200, 0),
      bcluster("c", 0, 200),
    ];
    const m = computeStrataChurnMetrics(build(), build());
    expect(m.U.size).toBe(3);
    expect(m.m1Rel).toBe(0);
  });

  it("hand-verified value over an ordered U×U pair (a fixed, b moves)", () => {
    // a = [0,0]-[10,10] (unchanged). b moves [5,20]-[25,30] → [5,5]-[25,15].
    // D_rel(a,b): pOld{S:.25,SE:.75}; pNew{E:.375,S:.125,SE:.375}
    //   ½(|.375|+|.25-.125|+|.75-.375|) = ½(.375+.125+.375) = .4375
    // D_rel(b,a): pOld{N:.5,NW:.5}; pNew{N:.25,NW:.25,W:.25}
    //   ½(.25+.25+.25) = .375
    // M1_rel = (.4375 + .375)/2 = 0.40625
    const oldEls = [bcluster("a", 0, 0, 10, 10), bcluster("b", 5, 20, 20, 10)];
    const newEls = [bcluster("a", 0, 0, 10, 10), bcluster("b", 5, 5, 20, 10)];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(2);
    expect(m.m1Rel).toBeCloseTo(0.40625, 3);
    expect(m.m1Rel).toBeGreaterThanOrEqual(0);
    expect(m.m1Rel).toBeLessThanOrEqual(1);
  });
});

// ── M2_flip: within-column order-inversion rate ─────────────────────────────

describe("M2_flip", () => {
  it("hand-counted inversion rate over a shared column", () => {
    // Column x=0. old order A<B<C (y 0,100,200); new A between (y 100,0,200).
    // Only the A–B pair flips ⇒ 1 inversion of 3 compared pairs ⇒ 1/3.
    const oldEls = [
      bcluster("A", 0, 0),
      bcluster("B", 0, 100),
      bcluster("C", 0, 200),
    ];
    const newEls = [
      bcluster("A", 0, 100),
      bcluster("B", 0, 0),
      bcluster("C", 0, 200),
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.m2Flip.comparedPairs).toBe(3);
    expect(m.m2Flip.inversions).toBe(1);
    expect(m.m2Flip.value).toBeCloseTo(1 / 3, 4);
  });

  it("only counts pairs sharing a column in BOTH layouts", () => {
    // D shares column x=0 in old but moves to x=500 in new ⇒ its 3 pairs are
    // excluded; comparedPairs stays 3 (A,B,C) despite 6 total U pairs.
    const oldEls = [
      bcluster("A", 0, 0),
      bcluster("B", 0, 100),
      bcluster("C", 0, 200),
      bcluster("D", 0, 300),
    ];
    const newEls = [
      bcluster("A", 0, 100),
      bcluster("B", 0, 0),
      bcluster("C", 0, 200),
      bcluster("D", 500, 300),
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(4);
    expect(m.m2Flip.comparedPairs).toBe(3);
    expect(m.m2Flip.inversions).toBe(1);
  });
});

// ── M4_disp95: p95 residual after per-column rigid shift ─────────────────────

describe("M4_disp95 shift tiers", () => {
  it("TIER 1 (own column ≥3): a pure column translation ⇒ residual 0, coverage 1", () => {
    // 3 nodes in one column, all shifted by (0,+20).
    const oldEls = [
      bcluster("a", 0, 0),
      bcluster("b", 0, 50),
      bcluster("c", 0, 100),
    ];
    const newEls = [
      bcluster("a", 0, 20),
      bcluster("b", 0, 70),
      bcluster("c", 0, 120),
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.m4.value).toBe(0);
    expect(m.m4.coverageRatio).toBe(1);
    expect(m.m4.status).toBe("vacuous"); // |U|=3 < N_min(20)
  });

  it("TIER 2 (±1 rank-band) is used — and differs from the global median", () => {
    // ranks: 0(x0,1 node), 1(x100,3 nodes), 2(x200,5 nodes).
    // deltas dy: L=100 ; rank1=50 each ; rank2=10 each.
    // L own col size 1 <3 ⇒ ±1 band = {rank0,rank1} = [100,50,50,50] median 50
    //   (global median over all 9 = 10, so this proves the BAND was used).
    // residual L = |100-50| = 50 ; rank1/rank2 own≥3 ⇒ residual 0.
    // p95 of [0×8, 50] = 50. coverage = 8/9.
    const oldEls = [
      bcluster("L", 0, 0),
      bcluster("m1", 100, 0),
      bcluster("m2", 100, 50),
      bcluster("m3", 100, 100),
      bcluster("r1", 200, 0),
      bcluster("r2", 200, 50),
      bcluster("r3", 200, 100),
      bcluster("r4", 200, 150),
      bcluster("r5", 200, 200),
    ];
    const newEls = [
      bcluster("L", 0, 100), // +100
      bcluster("m1", 100, 50), // +50
      bcluster("m2", 100, 100),
      bcluster("m3", 100, 150),
      bcluster("r1", 200, 10), // +10
      bcluster("r2", 200, 60),
      bcluster("r3", 200, 110),
      bcluster("r4", 200, 160),
      bcluster("r5", 200, 210),
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.m4.value).toBe(50);
    expect(m.m4.coverageRatio).toBeCloseTo(8 / 9, 4);
  });

  it("TIER 3 (global) when own <3 AND ±1 band <3", () => {
    // ranks: 0(x0,1 node G), 1(x100,1 node), 2(x200,5 nodes).
    // G own 1<3; band {rank0,rank1}=2<3 ⇒ GLOBAL median (over 7) = 10.
    // deltas: G=100 ; rank1=20 ; rank2=10 each. residual G=|100-10|=90.
    const oldEls = [
      bcluster("G", 0, 0),
      bcluster("h1", 100, 0),
      bcluster("r1", 200, 0),
      bcluster("r2", 200, 50),
      bcluster("r3", 200, 100),
      bcluster("r4", 200, 150),
      bcluster("r5", 200, 200),
    ];
    const newEls = [
      bcluster("G", 0, 100), // +100
      bcluster("h1", 100, 20), // +20
      bcluster("r1", 200, 10), // +10
      bcluster("r2", 200, 60),
      bcluster("r3", 200, 110),
      bcluster("r4", 200, 160),
      bcluster("r5", 200, 210),
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.m4.value).toBe(90);
    expect(m.m4.coverageRatio).toBeCloseTo(5 / 7, 4);
  });

  it("INCONCLUSIVE: |U| ≥ N_min but coverage < 0.5 (all singleton columns)", () => {
    const oldEls: ExcalidrawElement[] = [];
    const newEls: ExcalidrawElement[] = [];
    for (let i = 0; i < 22; i++) {
      oldEls.push(bcluster(`n${i}`, i * 100, 0));
      newEls.push(bcluster(`n${i}`, i * 100, i)); // tiny move, own columns are singletons
    }
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(22);
    expect(m.U.gatable).toBe(true);
    expect(m.m4.coverageRatio).toBe(0);
    expect(m.m4.status).toBe("inconclusive");
  });

  it("OK: |U| ≥ N_min and coverage ≥ 0.5 (columns of 5)", () => {
    const oldEls: ExcalidrawElement[] = [];
    const newEls: ExcalidrawElement[] = [];
    for (let col = 0; col < 4; col++) {
      for (let r = 0; r < 5; r++) {
        const a = `c${col}_${r}`;
        oldEls.push(bcluster(a, col * 100, r * 40));
        newEls.push(bcluster(a, col * 100, r * 40 + 5)); // rigid +5 per column
      }
    }
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(20);
    expect(m.m4.coverageRatio).toBe(1);
    expect(m.m4.status).toBe("ok");
    expect(m.m4.value).toBe(0); // rigid per-column shift removed
  });
});

// ── M5_hull: 1 − ARI(geometric parent-hull partition old vs new) ────────────

/** Build the 6 stable nodes (stamped path ["S"] ⇒ all in U) inside the given
 * per-layout hull frames. `groups` maps each node to a hull rect placement. */
function m5Scene(
  groups: Array<{
    addr: string;
    hull: ExcalidrawElement;
    x: number;
    y: number;
  }>,
): ExcalidrawElement[] {
  const hulls = new Map<string, ExcalidrawElement>();
  const nodes: ExcalidrawElement[] = [];
  for (const g of groups) {
    hulls.set(g.hull.id, g.hull);
    nodes.push(pcluster(g.addr, ["S"], g.x, g.y, 10, 10));
  }
  return [...hulls.values(), ...nodes];
}

describe("M5_hull", () => {
  it("ARI known-answer on a hand-computed partition pair (M5 = 0.7576)", () => {
    // old hulls: R1{n1,n2,n3}, R2{n4,n5,n6}. new hulls: X{n1,n2}, Y{n3,n4}, Z{n5,n6}.
    // contingency A/X=2,A/Y=1,B/Y=1,B/Z=2 ⇒ ARI = 0.242424 ⇒ M5 = 0.757576.
    const R1 = hull(["r1"], 0, 0, 100, 100);
    const R2 = hull(["r2"], 0, 200, 100, 100);
    const oldEls = m5Scene([
      { addr: "n1", hull: R1, x: 10, y: 10 },
      { addr: "n2", hull: R1, x: 10, y: 30 },
      { addr: "n3", hull: R1, x: 10, y: 50 },
      { addr: "n4", hull: R2, x: 10, y: 210 },
      { addr: "n5", hull: R2, x: 10, y: 230 },
      { addr: "n6", hull: R2, x: 10, y: 250 },
    ]);
    const X = hull(["x"], 0, 0, 100, 50);
    const Y = hull(["y"], 0, 100, 100, 50);
    const Z = hull(["z"], 0, 200, 100, 50);
    const newEls = m5Scene([
      { addr: "n1", hull: X, x: 10, y: 10 },
      { addr: "n2", hull: X, x: 10, y: 30 },
      { addr: "n3", hull: Y, x: 10, y: 110 },
      { addr: "n4", hull: Y, x: 10, y: 130 },
      { addr: "n5", hull: Z, x: 10, y: 210 },
      { addr: "n6", hull: Z, x: 10, y: 230 },
    ]);
    // nMin=6 so this small fixture is gatable (status ok) — the frozen default
    // 20 would render it vacuous (tested separately below).
    const m = computeStrataChurnMetrics(oldEls, newEls, { nMin: 6 });
    expect(m.U.size).toBe(6);
    expect(m.m5.ari).toBeCloseTo(0.2424, 3);
    expect(m.m5.value).toBeCloseTo(0.7576, 3);
    expect(m.m5.distinctHullsOld).toBe(2);
    expect(m.m5.distinctHullsNew).toBe(3);
    expect(m.m5.status).toBe("ok");
  });

  it("identical single-cluster partitions ⇒ ARI 1 ⇒ M5 = 0", () => {
    // No hull frames ⇒ every U node is root ⇒ one cluster in both ⇒ ARI ≡ 1.
    const build = () => [
      bcluster("n1", 0, 0),
      bcluster("n2", 0, 50),
      bcluster("n3", 0, 100),
    ];
    const m = computeStrataChurnMetrics(build(), build(), { nMin: 3 });
    expect(m.m5.value).toBe(0);
    expect(m.m5.distinctHullsOld).toBe(1);
    // spans < 2 distinct hulls in both ⇒ vacuous even though gatable.
    expect(m.m5.status).toBe("vacuous");
  });

  it("does NOT clamp before comparison — anti-correlated partition ⇒ M5 > 1", () => {
    // old A{n1,n2,n3},B{n4,n5,n6}; new P{n1,n4},Q{n2,n5},R{n3,n6} ⇒ ARI −0.3636.
    const A = hull(["a"], 0, 0, 100, 100);
    const B = hull(["b"], 0, 200, 100, 100);
    const oldEls = m5Scene([
      { addr: "n1", hull: A, x: 10, y: 10 },
      { addr: "n2", hull: A, x: 10, y: 30 },
      { addr: "n3", hull: A, x: 10, y: 50 },
      { addr: "n4", hull: B, x: 10, y: 210 },
      { addr: "n5", hull: B, x: 10, y: 230 },
      { addr: "n6", hull: B, x: 10, y: 250 },
    ]);
    const P = hull(["p"], 0, 0, 100, 50);
    const Q = hull(["q"], 0, 100, 100, 50);
    const Rf = hull(["r"], 0, 200, 100, 50);
    const newEls = m5Scene([
      { addr: "n1", hull: P, x: 10, y: 10 },
      { addr: "n4", hull: P, x: 10, y: 30 },
      { addr: "n2", hull: Q, x: 10, y: 110 },
      { addr: "n5", hull: Q, x: 10, y: 130 },
      { addr: "n3", hull: Rf, x: 10, y: 210 },
      { addr: "n6", hull: Rf, x: 10, y: 230 },
    ]);
    const m = computeStrataChurnMetrics(oldEls, newEls, { nMin: 6 });
    expect(m.m5.value).toBeCloseTo(1.3636, 3);
    expect(m.m5.value).toBeGreaterThan(1); // proves no display clamp before gating
  });

  it("vacuous below N_min (frozen default 20) even with a real hull change", () => {
    const R1 = hull(["r1"], 0, 0, 100, 100);
    const R2 = hull(["r2"], 0, 200, 100, 100);
    const oldEls = m5Scene([
      { addr: "n1", hull: R1, x: 10, y: 10 },
      { addr: "n2", hull: R2, x: 10, y: 210 },
    ]);
    const X = hull(["x"], 0, 0, 100, 300);
    const newEls = m5Scene([
      { addr: "n1", hull: X, x: 10, y: 10 },
      { addr: "n2", hull: X, x: 10, y: 210 },
    ]);
    const m = computeStrataChurnMetrics(oldEls, newEls); // default nMin=20
    expect(m.U.size).toBe(2);
    expect(m.U.gatable).toBe(false);
    expect(m.m5.status).toBe("vacuous");
  });
});

describe("adjustedRandIndex (direct)", () => {
  it("matches the hand-computed ARI and honours sklearn degenerate conventions", () => {
    expect(
      adjustedRandIndex(
        ["A", "A", "A", "B", "B", "B"],
        ["X", "X", "Y", "Y", "Z", "Z"],
      ),
    ).toBeCloseTo(0.242424, 5);
    expect(adjustedRandIndex(["A", "A", "A"], ["A", "A", "A"])).toBe(1); // single
    expect(adjustedRandIndex(["a", "b", "c"], ["a", "b", "c"])).toBe(1); // singletons
  });
});

// ── U-set: content hash under the three edit types ──────────────────────────

describe("U-set (content hash) under the fixture triple", () => {
  it("identical layouts ⇒ every address is stable", () => {
    const build = () => [bcluster("a", 0, 0), bcluster("b", 100, 0)];
    const m = computeStrataChurnMetrics(build(), build());
    expect(m.U.size).toBe(2);
    expect(m.U.commonAddressCount).toBe(2);
    expect(m.U.unchangedRatio).toBe(1);
  });

  it("add-one-resource: the new node is not in U; others stay", () => {
    const oldEls = [bcluster("a", 0, 0), bcluster("b", 100, 0)];
    const newEls = [
      bcluster("a", 0, 0),
      bcluster("b", 100, 0),
      bcluster("c", 200, 0), // added
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(2); // a,b
    expect(m.U.oldAddressCount).toBe(2);
    expect(m.U.newAddressCount).toBe(3);
    expect(m.U.commonAddressCount).toBe(2);
  });

  it("add-one-edge: both endpoints leave U (incident hash changed)", () => {
    const oldEls = [
      bcluster("a", 0, 0),
      bcluster("b", 100, 0),
      bcluster("c", 200, 0),
    ];
    const newEls = [
      bcluster("a", 0, 0),
      bcluster("b", 100, 0),
      bcluster("c", 200, 0),
      edge("a", "b"), // new incident edge on a and b
    ];
    const m = computeStrataChurnMetrics(oldEls, newEls);
    expect(m.U.size).toBe(1); // only c is unchanged
    expect(m.U.commonAddressCount).toBe(3);
  });

  it("moved{}-rename: the renamed node stays in U via the renames map", () => {
    // old carries old_a with an edge old_a→b; new carries new_a→b.
    const oldEls = [
      bcluster("old_a", 0, 0),
      bcluster("b", 100, 0),
      edge("old_a", "b"),
    ];
    const newEls = [
      bcluster("new_a", 0, 0),
      bcluster("b", 100, 0),
      edge("new_a", "b"),
    ];
    // Without the rename map, old_a / new_a are distinct addresses ⇒ neither in
    // U; b's incident endpoint also differs (old_a vs new_a) ⇒ b drops too.
    const without = computeStrataChurnMetrics(oldEls, newEls);
    expect(without.U.size).toBe(0);

    // With the rename, old_a→new_a is applied BEFORE the intersection, and the
    // incident endpoint remap keeps b's hash stable as well ⇒ U = {new_a, b}.
    const withRename = computeStrataChurnMetrics(oldEls, newEls, {
      renames: { old_a: "new_a" },
    });
    expect(withRename.U.size).toBe(2);
  });

  // (FIX-5, codex-review WP-3f): a non-injective rename map (two distinct old
  // addresses folding onto the same canonical address) must throw, not
  // silently resolve to "later insertion wins".
  it("(FIX-5) a rename map folding two distinct old addresses onto one canonical address throws", () => {
    const oldEls = [bcluster("old_a", 0, 0), bcluster("old_b", 100, 0)];
    const newEls = [bcluster("merged", 0, 0)];
    expect(() =>
      computeStrataChurnMetrics(oldEls, newEls, {
        renames: { old_a: "merged", old_b: "merged" },
      }),
    ).toThrow(/Strata A4 churn: non-injective rename map/);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("same inputs → identical metrics on repeat", () => {
    const oldEls = [
      bcluster("a", 0, 0),
      bcluster("b", 0, 100),
      bcluster("c", 100, 0),
    ];
    const newEls = [
      bcluster("a", 0, 20),
      bcluster("b", 0, 90),
      bcluster("c", 100, 5),
    ];
    expect(computeStrataChurnMetrics(oldEls, newEls)).toEqual(
      computeStrataChurnMetrics(oldEls, newEls),
    );
  });
});
