import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  createTerraformEdgeRepairStats,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";

// ── fixtures ────────────────────────────────────────────────────────────────
// Follows terraformVisibility.routedPolyline.test.ts' idiom: minimal synthetic
// elements cast through `unknown`, exercising ONLY what repair reads.

const depEdge = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<ExcalidrawElement> = {},
): ExcalidrawElement =>
  ({
    id,
    type: "arrow",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [10, 10],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    customData: {
      terraformEdgeLayer: "dependency",
      relationship: { source, target },
    },
    ...overrides,
  } as unknown as ExcalidrawElement);

const resourceRect = (
  id: string,
  key: string,
  x: number,
  y: number,
): ExcalidrawElement =>
  ({
    id,
    type: "rectangle",
    x,
    y,
    width: 40,
    height: 20,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "#fff",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: {
      terraform: true,
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: key,
      nodePath: key,
    },
  } as unknown as ExcalidrawElement);

/** A leaf-cluster frame the clip gate resolves live rects from: `type:"frame"`
 * + `terraformTopologyRole:"primaryCluster"` + `terraformPrimaryAddress`. */
const clusterFrame = (
  id: string,
  address: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ExcalidrawElement =>
  ({
    id,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    name: null,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
    },
  } as unknown as ExcalidrawElement);

const A = "aws_instance.a";
const B = "aws_instance.b";

// Card A (0,0,40,20) inside frame FA (-20,-20,120,100); card B (400,300,40,20)
// inside frame FB (380,280,120,100).
const cardA = () => resourceRect("r-a", A, 0, 0);
const cardB = () => resourceRect("r-b", B, 400, 300);
const frameA = () => clusterFrame("f-a", A, -20, -20, 120, 100);
const frameB = () => clusterFrame("f-b", B, 380, 280, 120, 100);

/** Exact on-face points of frame FA / FB (mid-face on the parallel axis). */
const FA_FACE: Record<string, [number, number]> = {
  left: [-20, 30],
  right: [100, 30],
  top: [30, -20],
  bottom: [30, 80],
};
const FB_FACE: Record<string, [number, number]> = {
  left: [380, 330],
  right: [500, 330],
  top: [440, 280],
  bottom: [440, 380],
};

type ClipAnchorEndFixture = { frameKey: string; side: string };

/** A "clip"-provenance 3-point polyline between two ABSOLUTE endpoints,
 * stamped the way the box-endpoints pass would: routed marker + provenance +
 * serialized per-end anchors. */
const clipEdge = (
  startAbs: readonly [number, number],
  endAbs: readonly [number, number],
  anchor: { start: ClipAnchorEndFixture; end: ClipAnchorEndFixture },
): ExcalidrawElement => {
  const mid: [number, number] = [
    (startAbs[0] + endAbs[0]) / 2,
    (startAbs[1] + endAbs[1]) / 2 - 40, // waypoint off the chord → 3 points
  ];
  const rel = (p: readonly [number, number]): [number, number] => [
    p[0] - startAbs[0],
    p[1] - startAbs[1],
  ];
  const points = [rel(startAbs), rel(mid), rel(endAbs)];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return depEdge("clip-edge", A, B, {
    x: startAbs[0],
    y: startAbs[1],
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points,
    customData: {
      terraformEdgeLayer: "dependency",
      relationship: { source: A, target: B },
      terraformRoutedPolyline: true,
      terraformRoutedBy: "clip",
      terraformClipAnchor: anchor,
    },
  } as unknown as Partial<ExcalidrawElement>);
};

type RepairedArrow = ExcalidrawElement & {
  points: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};

/** One repair pass with stats; returns the clip edge + the accumulator. */
const repairClip = (elements: readonly ExcalidrawElement[]) => {
  const stats = createTerraformEdgeRepairStats();
  const out = repairTerraformEdgeBindings(elements, stats).find(
    (e) => e.id === "clip-edge",
  )! as unknown as RepairedArrow;
  return { out, stats };
};

const expectKept = (out: RepairedArrow, stats: ReturnType<typeof createTerraformEdgeRepairStats>) => {
  expect(out.points.length).toBe(3); // detour geometry preserved
  expect(out.customData?.terraformRoutedPolyline).toBe(true);
  expect(out.customData?.terraformRoutedBy).toBe("clip");
  expect(out.customData?.terraformClipAnchor).toBeDefined();
  expect(out.startBinding?.elementId).toBe("r-a");
  expect(out.endBinding?.elementId).toBe("r-b");
  expect(stats.keptBy.clip).toBe(1);
  expect(stats.flattenedBy.clip).toBeUndefined();
};

const expectFlattened = (out: RepairedArrow, stats: ReturnType<typeof createTerraformEdgeRepairStats>) => {
  expect(out.points.length).toBe(2); // flattened to the straight chord
  expect(out.customData?.terraformRoutedPolyline).toBeUndefined();
  expect(out.customData?.terraformRoutedBy).toBeUndefined();
  expect(out.customData?.terraformClipAnchor).toBeUndefined(); // self-heals
  expect(out.customData?.terraformEdgeLayer).toBe("dependency"); // others kept
  expect(out.startBinding?.elementId).toBe("r-a");
  expect(out.endBinding?.elementId).toBe("r-b");
  expect(stats.flattenedBy.clip).toBe(1);
  expect(stats.keptBy.clip).toBeUndefined();
};

// ── tests ───────────────────────────────────────────────────────────────────

describe("repairTerraformEdgeBindings — typed clip gate (4 faces + card fallback)", () => {
  // Any parsed side combination is legal (the old start:"right"/end:"left"
  // hardcode is gone) — the four cases below cover every face on BOTH ends.
  it.each([
    ["left", "left"],
    ["right", "top"],
    ["top", "bottom"],
    ["bottom", "right"],
  ] as const)(
    "keeps a clip polyline with start on the %s face and end on the %s face",
    (startSide, endSide) => {
      const edge = clipEdge(FA_FACE[startSide]!, FB_FACE[endSide]!, {
        start: { frameKey: A, side: startSide },
        end: { frameKey: B, side: endSide },
      });
      const { out, stats } = repairClip([
        frameA(),
        frameB(),
        cardA(),
        cardB(),
        edge,
      ]);
      expectKept(out, stats);
    },
  );

  it("flattens + strips when the frame moved 5px in X (rigid-X face failure)", () => {
    // Start stamped on FA's ORIGINAL left face x=-20; the live frame now sits
    // 5px right → |px − faceX| = 5 > 2. End stays valid so the failure is
    // attributable to the moved start frame.
    const movedFrameA = clusterFrame("f-a", A, -15, -20, 120, 100);
    const edge = clipEdge(FA_FACE.left!, FB_FACE.left!, {
      start: { frameKey: A, side: "left" },
      end: { frameKey: B, side: "left" },
    });
    const { out, stats } = repairClip([
      movedFrameA,
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectFlattened(out, stats);
  });

  it("flattens + strips when the frame moved 5px in Y (rigid-Y face failure)", () => {
    // Start stamped on FA's ORIGINAL top face y=-20; the live frame now sits
    // 5px down → |py − faceY| = 5 > 2 (the top face's rigid axis is Y).
    const movedFrameA = clusterFrame("f-a", A, -20, -15, 120, 100);
    const edge = clipEdge(FA_FACE.top!, FB_FACE.left!, {
      start: { frameKey: A, side: "top" },
      end: { frameKey: B, side: "left" },
    });
    const { out, stats } = repairClip([
      movedFrameA,
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectFlattened(out, stats);
  });

  it("keeps a mixed edge: frame-face start + \"card\" end within 48px of its card", () => {
    // End declared "card": validates against card B (400,300,40,20) with the
    // generic 48px chebyshev rule — here 10px off the card's right edge.
    const edge = clipEdge(FA_FACE.right!, [450, 310], {
      start: { frameKey: A, side: "right" },
      end: { frameKey: B, side: "card" },
    });
    const { out, stats } = repairClip([
      frameA(),
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectKept(out, stats);
  });

  it("flattens + strips a \"card\" end 60px away from its card", () => {
    // (500,310) is 60px (chebyshev) off card B's right edge — beyond the 48px
    // tolerance. It also happens to lie EXACTLY on frame FB's right face,
    // proving the "card" side validates against the CARD rule, never the
    // frame-face rule.
    const edge = clipEdge(FA_FACE.right!, [500, 310], {
      start: { frameKey: A, side: "right" },
      end: { frameKey: B, side: "card" },
    });
    const { out, stats } = repairClip([
      frameA(),
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectFlattened(out, stats);
  });

  it("flattens + strips on a malformed side value", () => {
    // "diagonal" is not a face: parseClipAnchor rejects the whole anchor and
    // the gate fails closed even though the endpoint sits exactly on a face.
    const edge = clipEdge(FA_FACE.left!, FB_FACE.left!, {
      start: { frameKey: A, side: "diagonal" },
      end: { frameKey: B, side: "left" },
    });
    const { out, stats } = repairClip([
      frameA(),
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectFlattened(out, stats);
  });

  it("flattens + strips when frameKey does not equal the relationship endpoint address", () => {
    // Foreign anchor naming a different cluster: the ancestry equality check
    // fails closed even though the endpoint sits exactly on FA's left face.
    const edge = clipEdge(FA_FACE.left!, FB_FACE.left!, {
      start: { frameKey: "aws_instance.zzz", side: "left" },
      end: { frameKey: B, side: "left" },
    });
    const { out, stats } = repairClip([
      frameA(),
      frameB(),
      cardA(),
      cardB(),
      edge,
    ]);
    expectFlattened(out, stats);
  });
});
