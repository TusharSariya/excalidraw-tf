import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  EDGE_COLLAPSE_MIN_POPULATION,
  EDGE_SPAN_MIN_PX,
  detectEdgeCollapse,
} from "./terraformEdgeCollapse";

// Minimal element factory — only the fields detectEdgeCollapse reads.
const linear = (
  type: "arrow" | "line",
  points: ReadonlyArray<readonly [number, number]>,
  opts: { isDeleted?: boolean; relationship?: unknown } = {},
): ExcalidrawElement =>
  ({
    type,
    points,
    isDeleted: opts.isDeleted ?? false,
    customData:
      opts.relationship !== undefined
        ? { relationship: opts.relationship }
        : undefined,
  } as unknown as ExcalidrawElement);

const box = (type: "rectangle" | "frame" | "text"): ExcalidrawElement =>
  ({
    type,
    points: undefined,
    isDeleted: false,
  } as unknown as ExcalidrawElement);

/** A spanning routed connector (well above the 64px threshold). */
const routedConnector = (n: number): ExcalidrawElement[] =>
  Array.from({ length: n }, (_, i) =>
    linear("arrow", [
      [0, 0],
      [500 + i, 900 + i],
    ]),
  );

/**
 * The reproduced collapsed scene: declared edges present only as soft-deleted
 * 2-point skeletons (they span by construction but are `isDeleted`), plus icon
 * strokes whose max span is 53px. No non-deleted linear element spans >= 64px.
 */
const collapsedSkeletons = (n: number): ExcalidrawElement[] =>
  Array.from({ length: n }, () =>
    linear(
      "arrow",
      [
        [0, 0],
        [4000, 8000],
      ],
      { isDeleted: true, relationship: { source: "a", target: "b" } },
    ),
  );

const iconStrokes = (n: number): ExcalidrawElement[] =>
  Array.from({ length: n }, () =>
    linear("line", [
      [0, 0],
      [53, 40],
    ]),
  );

describe("detectEdgeCollapse", () => {
  it("FIRES on the reproduced collapsed scene (numerator 0 against a full population)", () => {
    const declaredEdgeCount = 145;
    const scene = [
      ...collapsedSkeletons(declaredEdgeCount),
      ...iconStrokes(3707),
      box("rectangle"),
      box("frame"),
    ];
    const r = detectEdgeCollapse(scene, declaredEdgeCount);
    expect(r.spanningVisibleLinearCount).toBe(0);
    expect(r.edgeSpanningFraction).toBe(0);
    expect(r.edgeCollapseDetected).toBe(true);
  });

  it("PASSES on the healthy scene where visible routed connectors span", () => {
    const declaredEdgeCount = 145;
    const scene = [
      // healthy branch: the routed connectors are non-deleted, spanning linear
      // geometry (this is the ~1.18M-char delta the collapsed scene lacks)
      ...routedConnector(declaredEdgeCount),
      ...collapsedSkeletons(declaredEdgeCount), // soft-deleted skeletons also present
      ...iconStrokes(3707),
    ];
    const r = detectEdgeCollapse(scene, declaredEdgeCount);
    expect(r.spanningVisibleLinearCount).toBe(declaredEdgeCount);
    expect(r.edgeCollapseDetected).toBe(false);
  });

  it("does NOT false-positive on a sparse valid scene (single short connector)", () => {
    // One legitimate relationship whose connected nodes sit close together, so
    // its connector is under 64px. Population is below the floor → never fires.
    const scene = [
      linear("arrow", [
        [0, 0],
        [40, 20],
      ]),
      ...iconStrokes(20),
    ];
    const r = detectEdgeCollapse(scene, 1);
    expect(r.spanningVisibleLinearCount).toBe(0);
    expect(r.edgeCollapseDetected).toBe(false);
  });

  it("does NOT fire when the declared population is below the floor even at 0 spanning", () => {
    const belowFloor = EDGE_COLLAPSE_MIN_POPULATION - 1;
    const r = detectEdgeCollapse(iconStrokes(belowFloor), belowFloor);
    expect(r.edgeCollapseDetected).toBe(false);
  });

  it("counts a non-deleted LINE (not just arrow) as spanning geometry", () => {
    const scene = [
      ...Array.from({ length: 40 }, () =>
        linear("line", [
          [0, 0],
          [EDGE_SPAN_MIN_PX, 0],
        ]),
      ),
    ];
    const r = detectEdgeCollapse(scene, 40);
    expect(r.spanningVisibleLinearCount).toBe(40);
    expect(r.edgeCollapseDetected).toBe(false);
  });

  it("reports 0 fraction and no collapse for an empty declared population", () => {
    const r = detectEdgeCollapse(iconStrokes(10), 0);
    expect(r.edgeSpanningFraction).toBe(0);
    expect(r.edgeCollapseDetected).toBe(false);
  });

  // Round-2 regression: the proof-API dev-plugin seam originally measured the
  // numerator over `elements.concat(revealedEdges)` — the soft-deleted skeletons
  // are REVEALED (isDeleted stripped to false) for the endpoint-based
  // crossings/pierce metrics, and they span [[0,0],[dx,dy]] BY CONSTRUCTION. On
  // the reproduced collapsed scene (judge2-edge-collapse.json) that read
  // spanningVisibleLinearCount=155 / edgeCollapseDetected=false while the probe
  // seam (visible-only) read 0 / true. This test pins the invariant: the SAME
  // helper must FIRE on the visible-only set and would NOT fire on the revealed
  // set — so the plugin seam must call it over visible-only `elements`.
  it("FIRES on visible-only but NOT over the revealed set (round-2 plugin-seam defect)", () => {
    const declaredEdgeCount = 145;
    // Visible-only: only icon strokes (<= 53px). No routed connector geometry.
    const visibleOnly = [...iconStrokes(3707), box("rectangle"), box("frame")];
    // The 155 revealed skeletons: isDeleted stripped to false, span by
    // construction — exactly what the plugin's `revealedEdges` map produces.
    const revealed = Array.from({ length: 155 }, () =>
      linear("arrow", [
        [0, 0],
        [4000, 8000],
      ]),
    );

    const visibleSeam = detectEdgeCollapse(visibleOnly, declaredEdgeCount);
    expect(visibleSeam.spanningVisibleLinearCount).toBe(0);
    expect(visibleSeam.edgeCollapseDetected).toBe(true);

    // Guard against a regression back to the revealed-set measurement: that
    // reproduces the exact 155/false false-negative the judge caught.
    const revealedSeam = detectEdgeCollapse(
      [...visibleOnly, ...revealed],
      declaredEdgeCount,
    );
    expect(revealedSeam.spanningVisibleLinearCount).toBe(155);
    expect(revealedSeam.edgeCollapseDetected).toBe(false);
  });
});
