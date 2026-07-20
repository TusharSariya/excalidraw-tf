/**
 * Unit fixtures for the v3.2 path-level impact-tracing metrics (M-RT) and the
 * crossing-angle capture — gate-family proposal minimal slice, round-8
 * follow-up. Hand-built frames + arrows following the
 * terraformPipelineSliceMetrics.test.ts adversarial-fixture convention: every
 * metric's true value is known by construction.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import {
  computeStrataPathMetrics,
  pairedPathMetricsCi,
  WARE_COEF_CONTINUITY,
  WARE_COEF_CROSSINGS_ON_PATH,
  WARE_COEF_HOPS,
} from "./terraformPipelineStrataPathMetrics";

// ── element factories (mirroring terraformPipelineSliceMetrics.test.ts) ─────

let idSeq = 0;
const nextId = () => `pm-${idSeq++}`;

function cluster(
  address: string,
  x: number,
  y: number,
  width = 40,
  height = 40,
): ExcalidrawElement {
  return {
    id: address,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
      terraformTopologyPath: ["aws", "acct", "region"],
    },
  } as unknown as ExcalidrawElement;
}

/** A TFD arrow with ABSOLUTE polyline points. */
function arrow(
  source: string,
  target: string,
  pts: Array<[number, number]>,
): ExcalidrawElement {
  const [ox, oy] = pts[0]!;
  return {
    id: nextId(),
    type: "arrow",
    x: ox,
    y: oy,
    width: 0,
    height: 0,
    angle: 0,
    points: pts.map(([px, py]) => [px - ox, py - oy]),
    isDeleted: false,
    customData: { relationship: { source, target, aggregated: false } },
  } as unknown as ExcalidrawElement;
}

/** a → b → c in a straight left-to-right line (con = 0 everywhere). */
const straightChain = (): ExcalidrawElement[] => [
  cluster("a", 0, 0),
  cluster("b", 200, 0),
  cluster("c", 400, 0),
  arrow("a", "b", [
    [40, 20],
    [200, 20],
  ]),
  arrow("b", "c", [
    [240, 20],
    [400, 20],
  ]),
];

/** Same chain, but b→c leaves b straight DOWN (90° turn at b). */
const bentChain = (): ExcalidrawElement[] => [
  cluster("a", 0, 0),
  cluster("b", 200, 0),
  cluster("c", 400, 0),
  arrow("a", "b", [
    [40, 20],
    [200, 20],
  ]),
  arrow("b", "c", [
    [240, 20],
    [240, 180],
    [400, 180],
  ]),
];

describe("computeStrataPathMetrics — population", () => {
  it("finds the unique-shortest 2-hop path and reports coverage", () => {
    const m = computeStrataPathMetrics(straightChain());
    expect(m.populationTotal).toBe(1);
    expect(m.sampled).toBe(1);
    expect(m.hopHistogram).toEqual({ 2: 1 });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.addresses).toEqual(["a", "b", "c"]);
    expect(m.rows[0]!.pathKey).toBe("a\u0000b\u0000c");
    // both arrows lie on the sampled path.
    expect(m.edgeCoverage).toBe(1);
    expect(m.unresolvedPathCount).toBe(0);
  });

  it("excludes pairs whose shortest path is not unique (diamond)", () => {
    const els = [
      cluster("a", 0, 0),
      cluster("b1", 200, -100),
      cluster("b2", 200, 100),
      cluster("c", 400, 0),
      arrow("a", "b1", [
        [40, 10],
        [200, -80],
      ]),
      arrow("a", "b2", [
        [40, 30],
        [200, 120],
      ]),
      arrow("b1", "c", [
        [240, -80],
        [400, 10],
      ]),
      arrow("b2", "c", [
        [240, 120],
        [400, 30],
      ]),
    ];
    const m = computeStrataPathMetrics(els);
    expect(m.populationTotal).toBe(0);
    expect(m.rows).toHaveLength(0);
  });

  it("is deterministic (two runs deep-equal)", () => {
    const els = bentChain();
    expect(computeStrataPathMetrics(els)).toEqual(
      computeStrataPathMetrics(els),
    );
  });
});

describe("computeStrataPathMetrics — hand-computed row values", () => {
  it("straight chain: con 0, cr 0, br 0 ⇒ rtHat = 2·1.390 = 2.78", () => {
    const row = computeStrataPathMetrics(straightChain()).rows[0]!;
    expect(row.k).toBe(2);
    expect(row.con).toBe(0);
    expect(row.cr).toBe(0);
    expect(row.br).toBe(0); // b has degree 2 (one in, one out)
    expect(row.tll).toBe(320); // 160 + 160
    expect(row.rtHat).toBeCloseTo(WARE_COEF_HOPS * 2, 10);
    expect(row.gdevMaxDeg).toBe(0);
  });

  it("90° turn at the intermediate node: con 90 ⇒ rtHat = 2.78 + 0.01699·90", () => {
    const row = computeStrataPathMetrics(bentChain()).rows[0]!;
    expect(row.con).toBe(90);
    expect(row.tll).toBe(480); // 160 + (160 + 160)
    expect(row.rtHat).toBeCloseTo(
      WARE_COEF_HOPS * 2 + WARE_COEF_CONTINUITY * 90,
      2,
    );
  });

  it("a foreign arrow crossing the path counts once in cr", () => {
    const els = [
      ...straightChain(),
      cluster("d", 80, -200),
      cluster("e", 80, 200),
      // vertical arrow through (100, 20) — properly crosses a→b, shares no
      // endpoint address with the path edges.
      arrow("d", "e", [
        [100, -160],
        [100, 160],
      ]),
    ];
    const m = computeStrataPathMetrics(els);
    // (d,e) is a 1-hop pair — not in the 2–5-hop population.
    expect(m.populationTotal).toBe(1);
    const row = m.rows[0]!;
    expect(row.cr).toBe(1);
    // row.rtHat is rounded to 2dp (3.43 vs raw 3.434).
    expect(row.rtHat).toBeCloseTo(
      WARE_COEF_HOPS * 2 + WARE_COEF_CROSSINGS_ON_PATH * 1,
      2,
    );
    // d→e is off-path: 2 of 3 arrows covered.
    expect(m.edgeCoverage).toBeCloseTo(2 / 3, 2);
  });
});

describe("pairedPathMetricsCi", () => {
  it("pairs by path key and bootstraps the named statistics", () => {
    const baseline = computeStrataPathMetrics(straightChain()).rows;
    const candidate = computeStrataPathMetrics(bentChain()).rows;
    const ci = pairedPathMetricsCi(baseline, candidate);
    expect(ci.conP90.statistic).toBe("p90");
    expect(ci.conP90.n).toBe(1);
    expect(ci.conP90.point).toBe(90); // 90 − 0
    expect(ci.rtHatP50.statistic).toBe("p50");
    expect(ci.rtHatP50.point).toBeCloseTo(WARE_COEF_CONTINUITY * 90, 2);
    expect(ci.tllP50.point).toBe(160); // 480 − 320
  });
});

// ── crossing-angle capture (collision diagnostics, v3.2) ─────────────────────

describe("diagnosePipelineScene crossingAngles", () => {
  it("perpendicular crossing: minDeg 90, sharpShare 0", () => {
    const els = [
      arrow("h1", "h2", [
        [0, 50],
        [200, 50],
      ]),
      arrow("v1", "v2", [
        [100, -50],
        [100, 150],
      ]),
    ];
    const d = diagnosePipelineScene(els);
    expect(d.dataflow.crossings).toBe(1);
    expect(d.crossingAngles).toEqual({
      nCross: 1,
      sharpShare: 0,
      p10Deg: 90,
      minDeg: 90,
    });
  });

  it("shallow crossing (<30°) is sharp", () => {
    // Directions (200, 10) and (200, −10) ⇒ θ ≈ 5.72°.
    const els = [
      arrow("s1", "s2", [
        [0, 0],
        [200, 10],
      ]),
      arrow("s3", "s4", [
        [0, 10],
        [200, 0],
      ]),
    ];
    const d = diagnosePipelineScene(els);
    expect(d.crossingAngles.nCross).toBe(1);
    expect(d.crossingAngles.sharpShare).toBe(1);
    expect(d.crossingAngles.minDeg).toBeCloseTo(5.72, 1);
  });

  it("no crossings ⇒ vacuous zeros", () => {
    const d = diagnosePipelineScene([
      arrow("q1", "q2", [
        [0, 0],
        [100, 0],
      ]),
    ]);
    expect(d.crossingAngles).toEqual({
      nCross: 0,
      sharpShare: 0,
      p10Deg: 0,
      minDeg: 0,
    });
  });
});
