/**
 * Unit fixtures for the A5 pierce / contiguity structural metrics (WP-3d,
 * rcll-v2 spec v2.0 §6-A5). Hand-built frames + arrows; the normative boundary
 * semantics are each pinned as a separate case.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  computePierceMetrics,
  segmentIntersectsRectInterior,
} from "./terraformPipelineStrataPierceMetrics";

let idSeq = 0;
const nid = () => `el-${idSeq++}`;

function pcluster(
  address: string,
  path: string[] | null,
  x: number,
  y: number,
  w = 20,
  h = 20,
): ExcalidrawElement {
  const customData: Record<string, unknown> = {
    terraformTopologyRole: "primaryCluster",
    terraformPrimaryAddress: address,
  };
  if (path) {
    customData.terraformTopologyPath = path;
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

function hull(
  path: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  role: "region" | "vpc" | "subnetZone" | "provider" | "account" = "region",
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
      terraformTopologyRole: role,
      terraformTopologyKey: path.join("/"),
      terraformTopologyPath: path,
    },
  } as unknown as ExcalidrawElement;
}

/** TFD arrow with ABSOLUTE polyline points. */
function arrow(
  source: string,
  target: string,
  pts: Array<[number, number]>,
): ExcalidrawElement {
  const [ox, oy] = pts[0]!;
  return {
    id: nid(),
    type: "arrow",
    x: ox,
    y: oy,
    width: 1,
    height: 1,
    angle: 0,
    points: pts.map(([px, py]) => [px - ox, py - oy]),
    isDeleted: false,
    customData: { relationship: { source, target, aggregated: false } },
  } as unknown as ExcalidrawElement;
}

// ── boundary semantics (normative, v2.0 §6-A5) ──────────────────────────────

describe("segmentIntersectsRectInterior boundary semantics", () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };

  it("case 1: touching a CORNER without interior entry does NOT count", () => {
    // From (-5,5) to (5,-5): passes exactly through corner (0,0), never enters.
    expect(segmentIntersectsRectInterior([-5, 5], [5, -5], rect)).toBe(false);
  });

  it("case 1b: an endpoint ON the border NOT entering does NOT count", () => {
    // Ends exactly at (0,5) on the left border, approaching from outside.
    expect(segmentIntersectsRectInterior([-5, 5], [0, 5], rect)).toBe(false);
  });

  it("case 2: collinear overlap ALONG a border does NOT count", () => {
    // Runs along the left border x=0 from (0,2) to (0,8) — never interior.
    expect(segmentIntersectsRectInterior([0, 2], [0, 8], rect)).toBe(false);
  });

  it("case 3: an endpoint ON the border with the chord ENTERING DOES count", () => {
    // Starts at (0,5) on the left border and runs to (8,5) inside.
    expect(segmentIntersectsRectInterior([0, 5], [8, 5], rect)).toBe(true);
  });

  it("a chord passing clean through the interior counts; a degenerate rect never does", () => {
    expect(segmentIntersectsRectInterior([-5, 5], [15, 5], rect)).toBe(true);
    expect(
      segmentIntersectsRectInterior([-5, 5], [15, 5], {
        x: 0,
        y: 0,
        width: 0,
        height: 10,
      }),
    ).toBe(false);
  });
});

// ── pierce ───────────────────────────────────────────────────────────────────

describe("pierce (non-ancestor hull crossings)", () => {
  it("counts a middle hull the chord crosses, and SKIPS the endpoints' own hulls", () => {
    const Hsrc = hull(["hs"], 0, 0, 100, 400);
    const Hmid = hull(["hm"], 200, 0, 100, 400);
    const Htgt = hull(["ht"], 400, 0, 100, 400);
    const els = [
      Hsrc,
      Hmid,
      Htgt,
      pcluster("src", null, 40, 190, 20, 20), // geometric parent = Hsrc
      pcluster("tgt", null, 440, 190, 20, 20), // geometric parent = Htgt
      arrow("src", "tgt", [
        [50, 200],
        [450, 200], // horizontal line crosses Hmid's interior
      ]),
    ];
    const m = computePierceMetrics(els);
    expect(m.pierce.edgeCount).toBe(1);
    expect(m.pierce.total).toBe(1);
    expect(m.pierce.perEdge[0]!.pierces).toBe(1);
    expect(m.pierce.perEdge[0]!.piercedHulls).toEqual(["hm"]);
    // Hsrc and Htgt are ancestors of the endpoints ⇒ never counted even though
    // the chord's endpoints sit inside them.
  });

  it("an edge that crosses no foreign hull pierces nothing", () => {
    const H = hull(["h"], 0, 0, 200, 200);
    const els = [
      H,
      pcluster("a", null, 20, 20, 20, 20),
      pcluster("b", null, 120, 20, 20, 20),
      arrow("a", "b", [
        [40, 30],
        [120, 30],
      ]),
    ];
    const m = computePierceMetrics(els);
    expect(m.pierce.total).toBe(0);
  });

  it("an arrow with an unresolved endpoint is counted as unresolved, not pierced", () => {
    const els = [
      pcluster("a", null, 0, 0),
      arrow("a", "ghost", [
        [10, 10],
        [200, 10],
      ]),
    ];
    const m = computePierceMetrics(els);
    expect(m.pierce.edgeCount).toBe(0);
    expect(m.pierce.unresolvedEdgeCount).toBe(1);
  });
});

// ── contiguity ────────────────────────────────────────────────────────────────

describe("contiguity (per hull, per column)", () => {
  it("counts a break when a foreign cluster splits a hull's column run", () => {
    // Column x=0, Y order: A(0), B(50), A(100) ⇒ hull A is broken into 2 runs.
    const els = [
      pcluster("c1", ["A"], 0, 0),
      pcluster("c2", ["B"], 0, 50),
      pcluster("c3", ["A"], 0, 100),
    ];
    const m = computePierceMetrics(els);
    expect(m.contiguity.totalViolations).toBe(1);
    expect(m.contiguity.violations).toEqual([
      { hullPath: "A", columnX: 0, runs: 2 },
    ]);
  });

  it("no violation when each hull's clusters are contiguous in the column", () => {
    // Column x=0, Y order: A(0), A(50), B(100) ⇒ both hulls contiguous.
    const els = [
      pcluster("c1", ["A"], 0, 0),
      pcluster("c2", ["A"], 0, 50),
      pcluster("c3", ["B"], 0, 100),
    ];
    const m = computePierceMetrics(els);
    expect(m.contiguity.totalViolations).toBe(0);
    expect(m.contiguity.violations).toEqual([]);
  });

  it("is scoped per column — the same hull split across two columns is fine", () => {
    // A in column 0, B in column 100 — neither column interleaves.
    const els = [
      pcluster("a1", ["A"], 0, 0),
      pcluster("a2", ["A"], 0, 50),
      pcluster("b1", ["B"], 100, 0),
      pcluster("b2", ["B"], 100, 50),
    ];
    const m = computePierceMetrics(els);
    expect(m.contiguity.totalViolations).toBe(0);
  });
});

describe("determinism", () => {
  it("same elements → identical pierce metrics on repeat", () => {
    const build = () => [
      hull(["hm"], 200, 0, 100, 400),
      pcluster("src", ["hs"], 40, 190),
      pcluster("tgt", ["ht"], 440, 190),
      arrow("src", "tgt", [
        [50, 200],
        [450, 200],
      ]),
    ];
    expect(computePierceMetrics(build())).toEqual(
      computePierceMetrics(build()),
    );
  });
});
