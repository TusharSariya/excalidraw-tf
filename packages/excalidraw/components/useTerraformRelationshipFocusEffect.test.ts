import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { applyTerraformRelationshipFocus } from "./terraformRelationshipFocus";
import { buildTerraformRuntimeFocusUpdate } from "./useTerraformRelationshipFocusEffect";

import type { AppState } from "../types";

const VIEW_BG = "#ffffff";

const baseElement = (
  id: string,
  customData: Record<string, any>,
  overrides: Partial<ExcalidrawElement> = {},
) =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData,
    ...overrides,
  } as ExcalidrawElement);

const resource = (nodePath: string) =>
  baseElement(`node:${nodePath}`, {
    terraform: true,
    terraformVisibilityRole: "resource",
    nodePath,
  });

const edge = (id: string, source: string, target: string) =>
  baseElement(
    id,
    {
      terraformEdgeLayer: "dependency",
      relationship: { source, target },
    },
    { type: "arrow" },
  );

/** Chain a → b → c → d → e: `e` is 4 hops out, beyond the default 3-hop cap. */
const chainElements = () =>
  [
    resource("a"),
    resource("b"),
    resource("c"),
    resource("d"),
    resource("e"),
    edge("edge:a-b", "a", "b"),
    edge("edge:b-c", "b", "c"),
    edge("edge:c-d", "c", "d"),
    edge("edge:d-e", "d", "e"),
  ] as readonly NonDeletedExcalidrawElement[];

/** versionNonce/updated are freshly generated per newElementWith call. */
const strip = (elements: readonly ExcalidrawElement[]) =>
  elements.map(({ versionNonce, updated, ...rest }) => rest);

const runUpdate = (overrides: {
  focusDirection?: AppState["terraformFocusDirection"];
  focusMaxHops?: AppState["terraformFocusMaxHops"];
}) =>
  buildTerraformRuntimeFocusUpdate({
    allElements: chainElements(),
    activeFocusNodePath: "a",
    selectedElementIds: {},
    pins: null,
    viewBackgroundColor: VIEW_BG,
    skipBindingRepair: true,
    lastFocusInputsSig: null,
    lastFocusSceneSig: null,
    ...overrides,
  });

describe("buildTerraformRuntimeFocusUpdate — W11 F4 AppState ingress normalization", () => {
  it("maps the stored -1 sentinel to an Infinity hop cap in the traversal options", () => {
    const update = runUpdate({
      focusDirection: "dependencies",
      focusMaxHops: -1,
    });
    // Reference: the same scene pushed straight through the traversal with
    // an explicit Infinity cap. Byte-identical output proves -1 → Infinity
    // actually reached applyTerraformRelationshipFocus's options.
    const reference = applyTerraformRelationshipFocus(
      chainElements(),
      "a",
      VIEW_BG,
      { direction: "dependencies", maxHops: Infinity },
    );
    expect(strip(update.elements)).toEqual(strip(reference.elements));

    // And it differs from the default cap: `e` (4 hops) is inside the
    // unlimited cone but outside the default 3-hop cone.
    const capped = runUpdate({ focusDirection: "dependencies" });
    const uncappedE = update.elements.find((el) => el.id === "node:e");
    const cappedE = capped.elements.find((el) => el.id === "node:e");
    expect(uncappedE?.strokeColor).not.toBe(cappedE?.strokeColor);
  });

  it("tolerates a runtime Infinity (API misuse) identically to the -1 sentinel", () => {
    const viaSentinel = runUpdate({
      focusDirection: "dependencies",
      focusMaxHops: -1,
    });
    const viaInfinity = runUpdate({
      focusDirection: "dependencies",
      focusMaxHops: Infinity,
    });
    expect(viaInfinity.focusInputsSig).toBe(viaSentinel.focusInputsSig);
    expect(strip(viaInfinity.elements)).toEqual(strip(viaSentinel.elements));
  });

  it("junk direction + NaN hops normalize to the byte-identical default path", () => {
    const defaults = runUpdate({});
    const junk = runUpdate({
      focusDirection: "downstream" as AppState["terraformFocusDirection"],
      focusMaxHops: NaN,
    });
    // Normalization happens BEFORE the inputs sig is built, so junk and
    // defaults share a signature and produce identical elements.
    expect(junk.focusInputsSig).toBe(defaults.focusInputsSig);
    expect(strip(junk.elements)).toEqual(strip(defaults.elements));
  });

  it("ignores non-finite / negative / non-integer / unsafe-integer hop caps (legacy default path)", () => {
    const defaults = runUpdate({});
    // 1e21 passes Number.isInteger but NOT Number.isSafeInteger — the W13 F3
    // shared validator (isValidTerraformFocusHopCount) must reject it at the
    // AppState ingress so it falls back to the legacy default.
    for (const bad of [-2, -Infinity, 0.5, 2.5, 1e21, Number.MAX_VALUE]) {
      const update = runUpdate({ focusMaxHops: bad });
      expect(update.focusInputsSig).toBe(defaults.focusInputsSig);
      expect(strip(update.elements)).toEqual(strip(defaults.elements));
    }
  });

  it("passes a 0 hop cap through to the traversal (focused node only — W13 WP1)", () => {
    const update = runUpdate({ focusMaxHops: 0 });
    // Reference: the same scene pushed straight through the traversal with an
    // explicit 0 cap. Byte-identical output proves 0 survived normalization
    // and reached applyTerraformRelationshipFocus's options.
    const reference = applyTerraformRelationshipFocus(
      chainElements(),
      "a",
      VIEW_BG,
      { maxHops: 0 },
    );
    expect(strip(update.elements)).toEqual(strip(reference.elements));

    // And it differs from the default cap: `b` (1 hop) is inside the default
    // 3-hop cone but outside the hop-0 cone.
    const defaults = runUpdate({});
    expect(update.focusInputsSig).not.toBe(defaults.focusInputsSig);
    const hop0B = update.elements.find((el) => el.id === "node:b");
    const defaultB = defaults.elements.find((el) => el.id === "node:b");
    expect(hop0B?.strokeColor).not.toBe(defaultB?.strokeColor);
  });
});

describe("buildTerraformRuntimeFocusUpdate — E08 focus wash overlay", () => {
  it("returns no wash and leaves the legacy color path when overlay mode is OFF", () => {
    const update = buildTerraformRuntimeFocusUpdate({
      allElements: chainElements(),
      activeFocusNodePath: "a",
      selectedElementIds: {},
      pins: null,
      viewBackgroundColor: VIEW_BG,
      skipBindingRepair: true,
      lastFocusInputsSig: null,
      lastFocusSceneSig: null,
    });
    expect(update.wash).toBeNull();
  });

  it("engage: returns per-element wash levels + sweep origin and makes no color mutations", () => {
    const elements = chainElements();
    const update = buildTerraformRuntimeFocusUpdate({
      allElements: elements,
      activeFocusNodePath: "a",
      selectedElementIds: {},
      pins: null,
      viewBackgroundColor: VIEW_BG,
      skipBindingRepair: true,
      lastFocusInputsSig: null,
      lastFocusSceneSig: null,
      washOverlayMode: true,
      clickCenter: { x: 5, y: 5 },
    });

    expect(update.wash).not.toBeNull();
    expect(update.wash!.clickCenter).toEqual({ x: 5, y: 5 });
    expect(update.wash!.levelByElementId.size).toBeGreaterThan(0);
    expect(update.wash!.maxRadius).toBeGreaterThan(0);
    // No color churn: every element keeps its original identity (nothing dimmed
    // in the data model).
    update.elements.forEach((element, index) => {
      expect(element).toBe(elements[index]);
    });
  });

  it("clear: overlay mode still emits a (possibly empty) wash so the renderer resets", () => {
    const update = buildTerraformRuntimeFocusUpdate({
      allElements: chainElements(),
      activeFocusNodePath: null,
      selectedElementIds: {},
      pins: null,
      viewBackgroundColor: VIEW_BG,
      skipBindingRepair: true,
      lastFocusInputsSig: null,
      lastFocusSceneSig: null,
      washOverlayMode: true,
      clickCenter: null,
    });
    // Non-overview chain ⇒ nothing ambient-dimmed; the effect maps an empty
    // wash + null focus to a descriptor clear.
    expect(update.wash).not.toBeNull();
    expect(update.wash!.clickCenter).toBeNull();
  });

  it("wash inputs signature separates overlay ON from OFF for the same focus", () => {
    const common = {
      allElements: chainElements(),
      activeFocusNodePath: "a",
      selectedElementIds: {},
      pins: null,
      viewBackgroundColor: VIEW_BG,
      skipBindingRepair: true,
      lastFocusInputsSig: null,
      lastFocusSceneSig: null,
    } as const;
    const off = buildTerraformRuntimeFocusUpdate(common);
    const on = buildTerraformRuntimeFocusUpdate({
      ...common,
      washOverlayMode: true,
      clickCenter: { x: 0, y: 0 },
    });
    expect(off.focusInputsSig).not.toBe(on.focusInputsSig);
  });

  // Regression test for the binding-repair-skipped-on-dim-only-focus bug:
  // every OTHER wash test above hard-codes `skipBindingRepair: true`, which
  // means none of them exercise `repairTerraformEdgeBindings` at all. This
  // one deliberately does NOT set that crutch, and constructs a scene where
  // the focus change is dim-only (every resource/edge is already revealed —
  // `isDeleted: false` — with no preview flags, so nothing structurally
  // changes and `didChange` from `applyTerraformRelationshipFocus` stays
  // false). Before the fix, `shouldRepairBindings: didChange` was therefore
  // `false` in overlay mode and `repairTerraformEdgeBindings` never ran.
  it("still runs binding repair on a dim-only overlay focus change (no reveal, no skipBindingRepair crutch)", () => {
    // A legacy `line` edge (with a stale binding) is the observable proof
    // that `repairTerraformEdgeBindings` executed: repair unconditionally
    // normalizes any bound `line` edge on a terraform edge layer to `arrow`,
    // independent of the wash/dim levels. If repair is skipped, the element
    // stays a `line`.
    const staleLineEdge = baseElement(
      "edge:a-b",
      {
        terraformEdgeLayer: "dependency",
        relationship: { source: "a", target: "b" },
      },
      {
        type: "line",
        points: [
          [0, 0],
          [100, 40],
        ] as any,
        startBinding: { elementId: "node:a", focus: 0, gap: 4 } as any,
      },
    );
    // `repairTerraformEdgeBindings` requires `points.length >= 2` on every
    // bound edge it walks (see terraformVisibility.ts); the plain `edge()`
    // helper used elsewhere in this file never needs `points` because those
    // other tests all set `skipBindingRepair: true` and never reach repair.
    const edgeWithPoints = (id: string, source: string, target: string) =>
      baseElement(
        id,
        {
          terraformEdgeLayer: "dependency",
          relationship: { source, target },
        },
        {
          type: "arrow",
          points: [
            [0, 0],
            [100, 40],
          ] as any,
        },
      );
    const allElements = [
      resource("a"),
      resource("b"),
      resource("c"),
      resource("d"),
      resource("e"),
      staleLineEdge,
      edgeWithPoints("edge:b-c", "b", "c"),
      edgeWithPoints("edge:c-d", "c", "d"),
      edgeWithPoints("edge:d-e", "d", "e"),
    ] as readonly NonDeletedExcalidrawElement[];

    // Sanity check the premise: `applyTerraformRelationshipFocus` itself
    // reports no structural change (dim-only) but a non-empty wash — the
    // exact condition the fix's `shouldRepairBindings` OR-clause covers.
    const focusResult = applyTerraformRelationshipFocus(
      allElements,
      "a",
      VIEW_BG,
      undefined,
      { clickCenter: { x: 5, y: 5 } },
    );
    expect(focusResult.didChange).toBe(false);
    expect(focusResult.washLevelByElementId!.size).toBeGreaterThan(0);
    expect(focusResult.shouldRepairBindings).toBe(true);

    const update = buildTerraformRuntimeFocusUpdate({
      allElements,
      activeFocusNodePath: "a",
      selectedElementIds: {},
      pins: null,
      viewBackgroundColor: VIEW_BG,
      // Deliberately NOT `true` — this is the actual runtime default, and the
      // whole point of the test is to observe repair running without it.
      skipBindingRepair: false,
      lastFocusInputsSig: null,
      lastFocusSceneSig: null,
      washOverlayMode: true,
      clickCenter: { x: 5, y: 5 },
    });

    const repairedEdge = update.elements.find((el) => el.id === "edge:a-b");
    expect(repairedEdge?.type).toBe("arrow");
  });
});
