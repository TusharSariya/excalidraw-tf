import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { repairTerraformEdgeBindings } from "./terraformVisibility";
import {
  getTerraformEdgeTripwireRecords,
  isTerraformEdgeTripwireEnabled,
  resetTerraformEdgeTripwireRecords,
  setTerraformEdgeTripwireEnabled,
} from "./terraformEdgeTripwire";

// ── fixtures (mirror terraformVisibility.routedPolyline.test.ts) ──────────────

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

const A = "aws_instance.a";
const B = "aws_instance.b";

/** Project to the geometry-relevant fields (drop version/versionNonce/updated
 * so the tripwire's log-only observation can be proven not to alter the scene). */
const stableProjection = (elements: readonly ExcalidrawElement[]) =>
  elements.map((e) => ({
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    isDeleted: e.isDeleted,
    points: (e as { points?: unknown }).points,
    startBinding: (e as { startBinding?: unknown }).startBinding,
    endBinding: (e as { endBinding?: unknown }).endBinding,
    customData: e.customData,
  }));

afterEach(() => {
  setTerraformEdgeTripwireEnabled(null);
  resetTerraformEdgeTripwireRecords();
  vi.restoreAllMocks();
});

describe("terraform edge tripwire", () => {
  it("is OFF by default (no env / global set)", () => {
    expect(isTerraformEdgeTripwireEnabled()).toBe(false);
  });

  it("fires a non-finite-point record when a connector materializes NaN, and does NOT alter the scene", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Rect A has a non-finite x → the center-clipped chord anchors go NaN,
    // reproducing the SDEC-34 const-frozen-NaN hazard on the connector path.
    const scene = [
      resourceRect("rectA", A, Number.NaN, 0),
      resourceRect("rectB", B, 400, 0),
      depEdge("edge1", A, B),
    ];

    // Baseline: tripwire OFF.
    setTerraformEdgeTripwireEnabled(false);
    const off = repairTerraformEdgeBindings(scene);
    expect(getTerraformEdgeTripwireRecords()).toHaveLength(0);

    // Observed: tripwire ON — same input.
    resetTerraformEdgeTripwireRecords();
    setTerraformEdgeTripwireEnabled(true);
    const on = repairTerraformEdgeBindings(scene);

    // The tripwire fired on the non-finite connector coordinate.
    const records = getTerraformEdgeTripwireRecords();
    const nonFinite = records.filter((r) => r.kind === "non-finite-point");
    expect(nonFinite.length).toBeGreaterThan(0);
    expect(nonFinite[0]).toMatchObject({
      kind: "non-finite-point",
      edgeId: "edge1",
      layer: "dependency",
      guard: "connector-endpoint",
      rawValue: "NaN",
    });

    // Byte-identity: the emitted geometry is unchanged by the observation.
    expect(stableProjection(on)).toEqual(stableProjection(off));
  });

  it("fires an edge-span-underflow record when a declared edge collapses to a single point", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Source and target rects coincide → the center-clipped chord collapses to a
    // zero-span (single distinct point) polyline: a per-edge collapse.
    const scene = [
      resourceRect("rectA", A, 100, 100),
      resourceRect("rectB", B, 100, 100),
      depEdge("edge1", A, B),
    ];

    setTerraformEdgeTripwireEnabled(true);
    repairTerraformEdgeBindings(scene);

    const underflow = getTerraformEdgeTripwireRecords().filter(
      (r) => r.kind === "edge-span-underflow",
    );
    expect(underflow.length).toBeGreaterThan(0);
    expect(underflow[0]).toMatchObject({
      kind: "edge-span-underflow",
      edgeId: "edge1",
      layer: "dependency",
    });
  });

  it("does NOT fire on a healthy edge (finite, spanning) and leaves the scene byte-identical vs OFF", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const scene = [
      resourceRect("rectA", A, 0, 0),
      resourceRect("rectB", B, 400, 0),
      depEdge("edge1", A, B),
    ];

    setTerraformEdgeTripwireEnabled(false);
    const off = repairTerraformEdgeBindings(scene);

    resetTerraformEdgeTripwireRecords();
    setTerraformEdgeTripwireEnabled(true);
    const on = repairTerraformEdgeBindings(scene);

    // No collapse / non-finite tripwires on a healthy scene.
    const fired = getTerraformEdgeTripwireRecords().filter(
      (r) => r.kind !== "finalize-summary",
    );
    expect(fired).toHaveLength(0);

    expect(stableProjection(on)).toEqual(stableProjection(off));
  });

  it("mirrors records onto globalThis.__terraformEdgeTripwire for headless capture", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const scene = [
      resourceRect("rectA", A, Number.NaN, 0),
      resourceRect("rectB", B, 400, 0),
      depEdge("edge1", A, B),
    ];

    setTerraformEdgeTripwireEnabled(true);
    repairTerraformEdgeBindings(scene);

    const surfaced = (
      globalThis as {
        __terraformEdgeTripwire?: { records: unknown[] };
      }
    ).__terraformEdgeTripwire;
    expect(surfaced).toBeTruthy();
    expect(surfaced!.records.length).toBeGreaterThan(0);

    // reset clears both the buffer and the global mirror.
    resetTerraformEdgeTripwireRecords();
    expect(
      (globalThis as { __terraformEdgeTripwire?: unknown })
        .__terraformEdgeTripwire,
    ).toBeUndefined();
  });
});
