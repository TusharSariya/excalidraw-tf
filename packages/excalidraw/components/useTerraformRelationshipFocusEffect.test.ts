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

  it("ignores non-finite / negative / non-integer hop caps (legacy default path)", () => {
    const defaults = runUpdate({});
    for (const bad of [-2, -Infinity, 0.5, 2.5]) {
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
