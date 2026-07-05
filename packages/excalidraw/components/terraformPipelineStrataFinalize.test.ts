/**
 * Strata A6 deterministic finalize (WP-3c) — spec rcll-v2-spec-v2 §6-A6 +
 * v3.1 §6 (group role, groupIds rewrite).
 *
 * Mandated coverage:
 *  (a) T1 run-twice byte-equal on a real preset (same G) — DEEP-EQUAL element
 *      arrays including ids/seeds/versionNonces
 *  (b) G monotonicity — same scene at G and G+1: versions strictly increase,
 *      nonces change, ids/geometry identical
 *  (c) id stability under semantic no-op — same inputs ⇒ same ids
 *  (d) uniqueness + no-dangling-ref dev-asserts (violating inputs throw)
 *  (e) tombstones (unit level here; apply-path integration lives in
 *      terraformSceneApply.test.ts)
 *  (f) frameId sanitization injective where stripping would collide
 *  (g) static scan — no Date.now / Math.random / new Date( in the strata
 *      module family
 *  (h) groupIds rewrite + dangling group ref throws
 * Plus: geometry invariance of the finalize (the committed Q2 strata
 * baselines' geometry is byte-identical through the pass) and the OD-8
 * empirical check (`repairTerraformEdgeBindings` is a no-op on a finalized
 * scene).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataFinalize.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { convertPipelineSkeletonToElements } from "./terraformPipelineLayoutFinalize";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import { assembleStrataSceneSkeleton } from "./terraformPipelineStrataSceneBuild";
import {
  computeStrataTombstones,
  finalizeStrataScene,
  fnv1a32,
  isStrataCanonicalId,
  sanitizeStrataFrameId,
  strataEdgeStableId,
  strataGroupId,
  strataSeed,
  strataStableId,
  strataVersionNonce,
  STRATA_TOMBSTONE_CUSTOM_DATA_KEY,
} from "./terraformPipelineStrataFinalize";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { repairTerraformEdgeBindings } from "./terraformVisibility";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

const PRESET = "staging-localstack";

function loadNodes(preset: string): {
  nodes: TerraformPlanNodesMap;
  plan: unknown;
} {
  const raw = getTerraformImportPresetSourcesFromDb(preset);
  const sources = resolveSourcesWithTfdComposition(
    raw! as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  return { nodes, plan: bundle.plan };
}

/** Runs the engine phases up to (but excluding) the finalize — the exact
 * pre-A6 element array the Q2 strata baselines were built from. */
async function buildConvertedUnfinalized(): Promise<ExcalidrawElement[]> {
  const { nodes, plan } = loadNodes(PRESET);
  const prep = preparePipelineLayout(nodes, plan, true);
  const engineOptions = {
    compact: true,
    includeAncillary: false,
    networkSimplexRank: false,
    sweeps: 0,
    coordinateRefine: false,
  };
  const model = buildStrataModel(prep, engineOptions);
  const repair = repairStrataCycles(model.edges, model.addressOf);
  const rank = rankStrataClusters([...model.clusters.keys()], repair, {
    networkSimplexRank: false,
    unitWidthOf: (id) => {
      const cluster = model.clusters.get(id);
      return cluster ? clusterFrameLocalRect(cluster).width : 0;
    },
  });
  const placement = placeStrataHulls(model, repair.edgesPrime, rank, {
    compact: true,
    includeAncillary: false,
    networkSimplexRank: false,
    sweeps: 0,
    coordinateRefine: false,
  });
  const { skeleton } = assembleStrataSceneSkeleton({
    prep,
    model,
    placement,
    nodes,
  });
  return convertPipelineSkeletonToElements(skeleton);
}

// ── handcrafted element helpers (violating-input + tombstone fixtures) ────────

type AnyEl = Record<string, unknown>;

const fakeEl = (overrides: AnyEl): ExcalidrawElement =>
  ({
    id: "raw-id",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "#fff",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: 42,
    version: 5,
    versionNonce: 42,
    isDeleted: false,
    boundElements: null,
    updated: 999,
    link: null,
    locked: false,
    customData: {},
    ...overrides,
  } as unknown as ExcalidrawElement);

const fakeNode = (address: string, overrides: AnyEl = {}): ExcalidrawElement =>
  fakeEl({
    id: `raw-${address}`,
    type: "rectangle",
    customData: {
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: address,
    },
    ...overrides,
  });

const fakeHullFrame = (
  role: string,
  pathSegments: string[],
  overrides: AnyEl = {},
): ExcalidrawElement =>
  fakeEl({
    id: `raw-frame-${role}-${pathSegments.join("+")}`,
    type: "frame",
    customData: {
      terraformTopologyRole: role,
      terraformTopologyPath: pathSegments,
    },
    ...overrides,
  });

const fakeEdge = (
  source: string,
  target: string,
  relKind: string,
  relExtras: AnyEl = {},
  overrides: AnyEl = {},
): ExcalidrawElement =>
  fakeEl({
    id: `raw-edge-${source}-${target}-${JSON.stringify(relExtras)}`,
    type: "arrow",
    customData: {
      terraformEdgeLayer: relKind,
      relationship: { source, target, ...relExtras },
    },
    ...overrides,
  });

// ── formulas ──────────────────────────────────────────────────────────────────

describe("A6 formulas", () => {
  it("seed = (FNV-1a(stableId) & 0x7fffffff) || 1, nonce keyed by generation", () => {
    const id = strataStableId("node", "aws_lb.ecs");
    expect(id).toBe("tf:node:aws_lb.ecs");
    expect(strataSeed(id)).toBe(fnv1a32(id) & 0x7fffffff || 1);
    expect(strataVersionNonce(id, 3)).toBe(
      fnv1a32(`${id}:3`) & 0x7fffffff || 1,
    );
    // nonzero clamps hold on the whole 31-bit range by construction
    expect(strataSeed(id)).toBeGreaterThan(0);
    expect(strataVersionNonce(id, 1)).toBeGreaterThan(0);
    expect(strataVersionNonce(id, 1)).not.toBe(strataVersionNonce(id, 2));
  });

  it("edgeId is length-prefixed and ordinal-suffixed", () => {
    expect(strataEdgeStableId("a.b", "c", "declaredDataFlow")).toBe(
      "tf:edge:3:a.b→1:c:declaredDataFlow",
    );
    expect(strataEdgeStableId("a.b", "c", "declaredDataFlow", 2)).toBe(
      "tf:edge:3:a.b→1:c:declaredDataFlow:#2",
    );
  });

  it("groupId(stableGroupKey) = tfg: + key (v3.1 §6)", () => {
    expect(strataGroupId("pin:aws_lb.ecs")).toBe("tfg:pin:aws_lb.ecs");
  });

  // (f) frameId sanitization — injective where stripping would collide.
  it("(f) frame-id sanitization percent-encodes (never strips) — two stripping-collision addresses stay distinct", () => {
    // Under a strip-unsafe-chars scheme both become "tfframevpcab" — R8 violation.
    const withSlash = sanitizeStrataFrameId("tf:frame:vpc:a/b");
    const without = sanitizeStrataFrameId("tf:frame:vpc:ab");
    expect(withSlash).not.toBe(without);
    expect(withSlash).toBe("tf%3Aframe%3Avpc%3Aa%2Fb");
    // '%' itself is escaped, so pre-encoded input cannot alias raw input.
    expect(sanitizeStrataFrameId("a%2F")).toBe("a%252F");
    expect(sanitizeStrataFrameId("a%2F")).not.toBe(sanitizeStrataFrameId("a/"));
    // encodeURIComponent's unreserved extras are NOT safe here.
    expect(sanitizeStrataFrameId("a!*'()~b")).toBe("a%21%2A%27%28%29%7Eb");
    // sanitized output uses only [A-Za-z0-9_.-%]
    expect(withSlash).toMatch(/^[A-Za-z0-9_.%-]+$/);
  });

  it("isStrataCanonicalId matches canonical node/edge ids and sanitized frame ids only", () => {
    expect(isStrataCanonicalId("tf:node:aws_lb.ecs")).toBe(true);
    expect(isStrataCanonicalId(sanitizeStrataFrameId("tf:frame:x"))).toBe(true);
    expect(isStrataCanonicalId("tf-pipeline:provider:aws")).toBe(false);
    expect(isStrataCanonicalId("id42")).toBe(false);
  });

  // (FIX-1, codex-review WP-3f): tighten the grammar to the exact known-role
  // set — a foreign tf:-prefixed id must NOT pass (it could otherwise wrongly
  // activate the apply-layer tombstone pass on a pasted/foreign element).
  it("(FIX-1) rejects tf:-prefixed ids that are not the exact canonical grammar", () => {
    expect(isStrataCanonicalId("tf:garbage")).toBe(false);
    expect(isStrataCanonicalId("tf:garbage:aws_lb.ecs")).toBe(false);
    expect(isStrataCanonicalId("tf:")).toBe(false);
    // every known role IS accepted (grammar is role-exhaustive, not a subset)
    for (const role of [
      "node",
      "frame",
      "label",
      "icon",
      "edge",
      "dup",
      "group",
    ]) {
      expect(isStrataCanonicalId(`tf:${role}:x`)).toBe(true);
    }
  });
});

// ── pure-pass behavior on handcrafted scenes ──────────────────────────────────

describe("finalizeStrataScene — pure pass", () => {
  it("rewrites ids, references and version fields; geometry untouched", () => {
    const frame = fakeHullFrame("vpc", ["aws", "1", "us-east-1", "vpc-1"]);
    const node = fakeNode("aws_lb.ecs", {
      frameId: frame.id,
      boundElements: [{ id: "raw-edge", type: "arrow" }],
      x: 12.34,
      y: 56.78,
    });
    const edge = fakeEdge(
      "aws_lb.ecs",
      "aws_ecs_service.x",
      "declaredDataFlow",
      {
        terraformPipelineOriginalSource: "aws_lb.ecs",
        terraformPipelineOriginalTarget: "aws_ecs_service.x",
      },
    );
    Object.assign(edge, {
      id: "raw-edge",
      startBinding: { elementId: node.id, fixedPoint: [1, 0.5], mode: "orbit" },
      endBinding: {
        elementId: "raw-target",
        fixedPoint: [0, 0.5],
        mode: "orbit",
      },
    });
    const target = fakeNode("aws_ecs_service.x", { id: "raw-target" });

    const out = finalizeStrataScene([frame, node, edge, target], {
      generation: 4,
    });
    const [fFrame, fNode, fEdge, fTarget] = out as (ExcalidrawElement & {
      startBinding?: { elementId: string };
      endBinding?: { elementId: string };
    })[];

    expect(fFrame!.id).toBe(
      sanitizeStrataFrameId(
        strataStableId("frame", "vpc:aws/1/us-east-1/vpc-1"),
      ),
    );
    expect(fNode!.id).toBe("tf:node:aws_lb.ecs");
    expect(fEdge!.id).toBe(
      strataEdgeStableId("aws_lb.ecs", "aws_ecs_service.x", "declaredDataFlow"),
    );
    // references rewritten through the map
    expect(fNode!.frameId).toBe(fFrame!.id);
    expect(fNode!.boundElements).toEqual([{ id: fEdge!.id, type: "arrow" }]);
    expect(fEdge!.startBinding!.elementId).toBe(fNode!.id);
    expect(fEdge!.endBinding!.elementId).toBe(fTarget!.id);
    // version scheme
    for (const el of out) {
      expect(el.version).toBe(4);
      expect(el.seed).toBe(strataSeed(el.id));
      expect(el.versionNonce).toBe(strataVersionNonce(el.id, 4));
      expect(el.updated).toBe(1);
    }
    // geometry byte-untouched
    expect([fNode!.x, fNode!.y, fNode!.width, fNode!.height]).toEqual([
      12.34, 56.78, 10, 10,
    ]);
    // input not mutated
    expect(node.id).toBe("raw-aws_lb.ecs");
    expect(node.version).toBe(5);
  });

  it("parallel-edge ordinals are content-comparator ranks, independent of scene order (never positional)", () => {
    const mk = (orig: string) =>
      fakeEdge("u.a", "v.b", "declaredDataFlow", {
        terraformPipelineOriginalSource: orig,
        terraformPipelineOriginalTarget: "v.b",
      });
    const eZ = mk("z.orig");
    const eA = mk("a.orig");
    const eM = mk("m.orig");
    const idsFor = (order: ExcalidrawElement[]) => {
      const out = finalizeStrataScene(order, { generation: 1 });
      return new Map(
        order.map((el, i) => [
          (
            el.customData as {
              relationship: { terraformPipelineOriginalSource: string };
            }
          ).relationship.terraformPipelineOriginalSource,
          out[i]!.id,
        ]),
      );
    };
    const a = idsFor([eZ, eA, eM]);
    const b = idsFor([eM, eZ, eA]);
    // same content → same id regardless of array order
    expect(a).toEqual(b);
    // ranks follow the pinned content comparator (a.orig < m.orig < z.orig)
    expect(a.get("a.orig")).toBe(
      strataEdgeStableId("u.a", "v.b", "declaredDataFlow", 0),
    );
    expect(a.get("m.orig")).toBe(
      strataEdgeStableId("u.a", "v.b", "declaredDataFlow", 1),
    );
    expect(a.get("z.orig")).toBe(
      strataEdgeStableId("u.a", "v.b", "declaredDataFlow", 2),
    );
  });

  // (c) at the pure-function level; (b) pure-level G monotonicity.
  it("(b)(c) same input ⇒ same ids; G vs G+1 ⇒ versions increase, nonces change, ids/geometry identical", () => {
    const frame = fakeHullFrame("provider", ["aws"]);
    const node = fakeNode("aws_lb.ecs", { frameId: frame.id });
    const g1 = finalizeStrataScene([frame, node], { generation: 1 });
    const g1Again = finalizeStrataScene([frame, node], { generation: 1 });
    expect(g1Again).toEqual(g1); // byte-equal, ids/seeds/nonces included

    const g2 = finalizeStrataScene([frame, node], { generation: 2 });
    expect(g2.map((el) => el.id)).toEqual(g1.map((el) => el.id));
    for (let i = 0; i < g1.length; i++) {
      expect(g2[i]!.version).toBe(g1[i]!.version + 1);
      expect(g2[i]!.versionNonce).not.toBe(g1[i]!.versionNonce);
      expect(g2[i]!.seed).toBe(g1[i]!.seed);
      expect([g2[i]!.x, g2[i]!.y, g2[i]!.width, g2[i]!.height]).toEqual([
        g1[i]!.x,
        g1[i]!.y,
        g1[i]!.width,
        g1[i]!.height,
      ]);
    }
  });

  it("is idempotent (re-finalizing a finalized scene at the same G is a fixpoint)", () => {
    const frame = fakeHullFrame("provider", ["aws"]);
    const node = fakeNode("aws_lb.ecs", {
      frameId: frame.id,
      groupIds: ["tfpin-99"],
    });
    const once = finalizeStrataScene([frame, node], { generation: 2 });
    const twice = finalizeStrataScene(once, { generation: 2 });
    expect(twice).toEqual(once);
  });

  // (d) dev-asserts.
  it("(d) duplicate stable ids throw (uniqueness is asserted BEFORE convert/restore can silently randomize)", () => {
    const a = fakeNode("aws_lb.ecs", { id: "raw-1" });
    const b = fakeNode("aws_lb.ecs", { id: "raw-2" });
    expect(() => finalizeStrataScene([a, b], { generation: 1 })).toThrow(
      /Strata A6 finalize: duplicate stable id "tf:node:aws_lb.ecs"/,
    );
  });

  it("(d) dangling references throw (boundElements / frameId / bindings)", () => {
    expect(() =>
      finalizeStrataScene(
        [fakeNode("a.b", { boundElements: [{ id: "ghost", type: "arrow" }] })],
        { generation: 1 },
      ),
    ).toThrow(/Strata A6 finalize: dangling boundElements reference "ghost"/);

    expect(() =>
      finalizeStrataScene([fakeNode("a.b", { frameId: "ghost-frame" })], {
        generation: 1,
      }),
    ).toThrow(/dangling frameId reference "ghost-frame"/);

    const edge = fakeEdge("a.b", "c.d", "declaredDataFlow");
    Object.assign(edge, {
      startBinding: { elementId: "ghost-rect", fixedPoint: [0, 0] },
    });
    expect(() => finalizeStrataScene([edge], { generation: 1 })).toThrow(
      /dangling startBinding reference "ghost-rect"/,
    );
  });

  it("icon-asset baggage bindings are nulled (icon glyphs only) — non-icon dangling bindings still throw", () => {
    // Full-mode icon templates carry start/endBinding referencing the LIBRARY
    // asset's own ids; the clone kernel nulls boundElements/containerId but
    // not bindings. Finalize normalizes them to null on glyphs only.
    const rect = fakeNode("aws_lb.ecs", { groupIds: ["tfpin-1"] });
    const icon = fakeEl({
      id: "ic-1",
      type: "line",
      customData: {
        terraformAwsIconGlyph: true,
        terraformVisibilityKey: "aws_lb.ecs",
      },
      groupIds: ["tfpin-1"],
      startBinding: { elementId: "asset-id-ghost", fixedPoint: [0, 0] },
      endBinding: { elementId: "raw-aws_lb.ecs", fixedPoint: [1, 1] },
    });
    const out = finalizeStrataScene([rect, icon], {
      generation: 1,
    }) as (ExcalidrawElement & {
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    })[];
    expect(out[1]!.startBinding).toBeNull(); // dangling asset ref → nulled
    expect(out[1]!.endBinding).toEqual({
      elementId: "tf:node:aws_lb.ecs", // real scene ref → mapped, not nulled
      fixedPoint: [1, 1],
    });
  });

  it("(d) an element with no derivable address throws (no silent pass-through)", () => {
    const stray = fakeEl({ id: "stray", type: "ellipse", customData: {} });
    expect(() => finalizeStrataScene([stray], { generation: 1 })).toThrow(
      /Strata A6 finalize: element "stray" \(type ellipse\) has no derivable address/,
    );
  });

  // (h) groupIds rewrite.
  it("(h) groupIds are rewritten to tfg: content keys (pin/outer/inner-template ordinals)", () => {
    const node = fakeNode("aws_lb.ecs", { groupIds: ["tfpin-123"] });
    const icon = (id: string, groups: string[]) =>
      fakeEl({
        id,
        type: "line",
        customData: {
          terraformAwsIconGlyph: true,
          terraformVisibilityKey: "aws_lb.ecs",
        },
        groupIds: groups,
      });
    const i0 = icon("ic-0", ["tfpin-123", "ico-77", "icg-b", "icg-a"]);
    const i1 = icon("ic-1", ["tfpin-123", "ico-77", "icg-a"]);
    const out = finalizeStrataScene([node, i0, i1], { generation: 1 });
    expect(out[0]!.groupIds).toEqual(["tfg:pin:aws_lb.ecs"]);
    // icg ordinals = first-appearance rank within the card's icon block
    // (icon-asset content order): icg-b appears before icg-a.
    expect(out[1]!.groupIds).toEqual([
      "tfg:pin:aws_lb.ecs",
      "tfg:icon:aws_lb.ecs",
      "tfg:icon:aws_lb.ecs:#0",
      "tfg:icon:aws_lb.ecs:#1",
    ]);
    expect(out[2]!.groupIds).toEqual([
      "tfg:pin:aws_lb.ecs",
      "tfg:icon:aws_lb.ecs",
      "tfg:icon:aws_lb.ecs:#1",
    ]);
    // icon element ids: content sub-address ordinals
    expect(out[1]!.id).toBe(strataStableId("icon", "aws_lb.ecs", 0));
    expect(out[2]!.id).toBe(strataStableId("icon", "aws_lb.ecs", 1));
  });

  it("(h) a group with no derivable stable key (dangling group ref) throws", () => {
    const node = fakeNode("aws_lb.ecs", { groupIds: ["mystery-1"] });
    expect(() => finalizeStrataScene([node], { generation: 1 })).toThrow(
      /Strata A6 finalize: group "mystery-1" has no derivable stable key/,
    );
  });
});

// ── satellite sub-address (full mode): one resource appearing in two clusters ──

describe("finalizeStrataScene — satellite sub-address qualification", () => {
  /** One resource ("shared.res") rendered as a satellite card in TWO cluster
   * builds (parents p1/p2), each appearance with its detached label and a
   * two-glyph icon block sharing the card's pin group — the exact full-mode
   * structure that collided in the Q2 battery. */
  const satAppearance = (parent: string, tag: string) => {
    const cd = {
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: "shared.res",
      terraformSatelliteTier: 1,
      terraformExplodeParent: parent,
    };
    const rect = fakeEl({
      id: `rect-${tag}`,
      type: "rectangle",
      customData: cd,
      groupIds: [`tfpin-${tag}`],
    });
    const label = fakeEl({
      id: `label-${tag}`,
      type: "text",
      customData: cd,
      groupIds: [`tfpin-${tag}`],
    });
    const icon = (n: number) =>
      fakeEl({
        id: `icon-${tag}-${n}`,
        type: "line",
        customData: {
          terraformAwsIconGlyph: true,
          terraformVisibilityKey: "shared.res",
        },
        groupIds: [`tfpin-${tag}`, `ico-${tag}`, `icg-${tag}-x`],
      });
    return [rect, label, icon(0), icon(1)];
  };

  it("two appearances of one resource get DISTINCT node/label/icon ids (parent-qualified), deterministic and order-independent", () => {
    const a = satAppearance("cluster.p1", "a");
    const b = satAppearance("cluster.p2", "b");

    const run = (order: ExcalidrawElement[]) =>
      new Map(
        finalizeStrataScene(order, { generation: 1 }).map((el, i) => [
          order[i]!.id,
          el,
        ]),
      );
    const out = run([...a, ...b]);

    // node/label: spec ordinal slot carries the satellite sub-address
    expect(out.get("rect-a")!.id).toBe("tf:node:shared.res:#cluster.p1");
    expect(out.get("rect-b")!.id).toBe("tf:node:shared.res:#cluster.p2");
    expect(out.get("label-a")!.id).toBe("tf:label:shared.res:#cluster.p1");
    expect(out.get("label-b")!.id).toBe("tf:label:shared.res:#cluster.p2");
    // icons: per-APPEARANCE ordinals — both appearances restart at 0
    expect(out.get("icon-a-0")!.id).toBe("tf:icon:shared.res:#cluster.p1:#0");
    expect(out.get("icon-a-1")!.id).toBe("tf:icon:shared.res:#cluster.p1:#1");
    expect(out.get("icon-b-0")!.id).toBe("tf:icon:shared.res:#cluster.p2:#0");
    expect(out.get("icon-b-1")!.id).toBe("tf:icon:shared.res:#cluster.p2:#1");
    // groups: appearance-scoped keys (no tfg collision between appearances)
    expect(out.get("rect-a")!.groupIds).toEqual([
      "tfg:pin:shared.res:#cluster.p1",
    ]);
    expect(out.get("icon-b-0")!.groupIds).toEqual([
      "tfg:pin:shared.res:#cluster.p2",
      "tfg:icon:shared.res:#cluster.p2",
      "tfg:icon:shared.res:#cluster.p2:#0",
    ]);
    // injectivity across the whole scene
    const ids = [...out.values()].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    // determinism + order-independence: permuted scene ⇒ same content→id map
    const permuted = run([...b, ...a]);
    for (const [oldId, el] of out) {
      expect(permuted.get(oldId)!.id).toBe(el.id);
      expect(permuted.get(oldId)!.groupIds).toEqual(el.groupIds);
    }
  });

  it("the same satellite appearance re-derives the same id run-to-run (and re-finalize is a fixpoint)", () => {
    const scene = satAppearance("cluster.p1", "a");
    const once = finalizeStrataScene(scene, { generation: 2 });
    expect(finalizeStrataScene(scene, { generation: 2 })).toEqual(once);
    // idempotency incl. the pin-group appearance resolution over tfg: ids
    expect(finalizeStrataScene(once, { generation: 2 })).toEqual(once);
  });

  it("compact byte-identity: a card WITHOUT explodeParent keeps the unqualified id (bare key)", () => {
    // fakeNode carries no terraformExplodeParent — the compact/primary shape.
    const out = finalizeStrataScene([fakeNode("aws_lb.ecs")], {
      generation: 1,
    });
    expect(out[0]!.id).toBe("tf:node:aws_lb.ecs");
  });

  it("two appearances with the SAME parent still throw the uniqueness dev-assert (honest degradation, no silent randomization)", () => {
    const a = satAppearance("cluster.p1", "a");
    const b = satAppearance("cluster.p1", "b");
    expect(() => finalizeStrataScene([...a, ...b], { generation: 1 })).toThrow(
      /Strata A6 finalize: duplicate stable id "tf:node:shared.res:#cluster.p1"/,
    );
  });
});

// ── (e) tombstones (unit; apply-path integration in terraformSceneApply.test.ts) ──

describe("computeStrataTombstones", () => {
  const live = (id: string): ExcalidrawElement => fakeEl({ id, version: 1 });

  it("(e) removed = prev − next: per removed address a canonical-id tombstone with isDeleted true and version = G_B", () => {
    const prev = [live("tf:node:x.a"), live("tf:node:y.gone")];
    const next = [live("tf:node:x.a")];
    const tombs = computeStrataTombstones(prev, next, 7);
    expect(tombs).toHaveLength(1);
    const tomb = tombs[0]!;
    expect(tomb.id).toBe("tf:node:y.gone");
    expect(tomb.isDeleted).toBe(true);
    expect(tomb.version).toBe(7);
    expect(tomb.versionNonce).toBe(strataVersionNonce("tf:node:y.gone", 7));
    expect(
      (tomb.customData as Record<string, unknown>)[
        STRATA_TOMBSTONE_CUSTOM_DATA_KEY
      ],
    ).toBe(true);
  });

  it("(e) tombstones persist ONE generation window (a prior tombstone is not re-emitted)", () => {
    const prior = computeStrataTombstones(
      [live("tf:node:x.a"), live("tf:node:y.gone")],
      [live("tf:node:x.a")],
      2,
    )[0]!;
    const tombs = computeStrataTombstones(
      [live("tf:node:x.a"), prior],
      [live("tf:node:x.a")],
      3,
    );
    expect(tombs).toEqual([]);
  });

  it("(e) strata-scoped: a non-strata incoming scene produces NO tombstones even over a strata prev", () => {
    expect(
      computeStrataTombstones([live("tf:node:x.a")], [live("plain-id-1")], 5),
    ).toEqual([]);
  });

  it("falls back to the incoming scene's stamped generation when no meta echo is given", () => {
    const next = [fakeEl({ id: "tf:node:x.a", version: 9 })];
    const tombs = computeStrataTombstones([live("tf:node:y.gone")], next);
    expect(tombs[0]!.version).toBe(9);
  });

  it("soft-hidden (isDeleted) previous elements still count as previous addresses — a soft-hidden edge is not a tombstone", () => {
    const hidden = fakeEl({
      id: "tf:edge:1:a→1:b:declaredDataFlow",
      isDeleted: true,
    });
    const tombs = computeStrataTombstones([hidden], [live("tf:node:x.a")], 2);
    expect(tombs).toHaveLength(1);
    expect(tombs[0]!.id).toBe(hidden.id);
    expect(tombs[0]!.version).toBe(2);
  });
});

// ── (g) static scan — C3′ over the strata module family ──────────────────────

describe("(g) C3′ static scan", () => {
  it("the strata module family contains no Date.now / Math.random / new Date(", () => {
    const componentsDir = path.dirname(fileURLToPath(import.meta.url));
    const moduleFiles = fs
      .readdirSync(componentsDir)
      .filter(
        (name) =>
          name.startsWith("terraformPipelineStrata") &&
          name.endsWith(".ts") &&
          !name.endsWith(".test.ts"),
      );
    expect(moduleFiles.length).toBeGreaterThanOrEqual(7); // family is non-vacuous
    // built by concatenation so this test file never matches itself if a
    // future scan widens to test files
    // eslint-disable-next-line no-useless-concat
    const banned = ["Date" + ".now", "Math" + ".random", "new " + "Date("];
    for (const name of moduleFiles) {
      const source = fs.readFileSync(path.join(componentsDir, name), "utf-8");
      for (const pattern of banned) {
        expect(
          source.includes(pattern),
          `${name} must not contain ${pattern}`,
        ).toBe(false);
      }
    }
  });
});

// ── real-preset integration: (a) T1, (b) full-build G, geometry invariance, OD-8 ──

describe("A6 finalize — real preset integration", () => {
  it(
    "(a)(c) T1 run-twice byte-equal: two full strata builds (same G) produce DEEP-EQUAL element arrays (ids/seeds/versionNonces included)",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);
      const scene1 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      const scene2 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      expect(scene1.meta.rcllV2Degraded).toBeUndefined();
      expect(scene1.meta.strataGeneration).toBe(1);
      expect(scene1.elements.length).toBeGreaterThan(0);
      // (c) semantic no-op ⇒ identical ids; (a) full byte-equality.
      expect(scene2.elements.map((el) => el.id)).toEqual(
        scene1.elements.map((el) => el.id),
      );
      expect(scene2.elements).toEqual(scene1.elements);
      // every element is canonical + generation-stamped
      for (const el of scene1.elements) {
        expect(isStrataCanonicalId(el.id), `canonical id: ${el.id}`).toBe(true);
        expect(el.version).toBe(1);
        expect(el.seed).toBe(strataSeed(el.id));
        expect(el.versionNonce).toBe(strataVersionNonce(el.id, 1));
        expect(el.updated).toBe(1);
        for (const gid of el.groupIds ?? []) {
          expect(gid.startsWith("tfg:"), `canonical group id: ${gid}`).toBe(
            true,
          );
        }
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "(b) G monotonicity end-to-end: strataGeneration G+1 bumps every version, changes nonces, keeps ids + geometry",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);
      const g1 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataGeneration: 1,
      });
      const g2 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataGeneration: 2,
      });
      expect(g2.meta.strataGeneration).toBe(2);
      expect(g2.elements.map((el) => el.id)).toEqual(
        g1.elements.map((el) => el.id),
      );
      for (let i = 0; i < g1.elements.length; i++) {
        const a = g1.elements[i]!;
        const b = g2.elements[i]!;
        expect(b.version).toBe(a.version + 1);
        expect(b.versionNonce).not.toBe(a.versionNonce);
        expect(b.seed).toBe(a.seed);
        expect([b.x, b.y, b.width, b.height]).toEqual([
          a.x,
          a.y,
          a.width,
          a.height,
        ]);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "finalize never touches geometry (Q2 baseline guard): pre-A6 converted scene vs finalized — geometry byte-identical elementwise",
    async () => {
      const converted = await buildConvertedUnfinalized();
      const finalized = finalizeStrataScene(converted, { generation: 1 });
      expect(finalized.length).toBe(converted.length);
      for (let i = 0; i < converted.length; i++) {
        const before = converted[i]! as ExcalidrawElement & {
          points?: readonly unknown[];
        };
        const after = finalized[i]! as ExcalidrawElement & {
          points?: readonly unknown[];
        };
        expect(after.type).toBe(before.type);
        expect([
          after.x,
          after.y,
          after.width,
          after.height,
          after.angle,
        ]).toEqual([
          before.x,
          before.y,
          before.width,
          before.height,
          before.angle,
        ]);
        expect(after.points).toEqual(before.points);
        expect(after.isDeleted).toBe(before.isDeleted);
        expect(after.customData).toEqual(before.customData);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "OD-8: repairTerraformEdgeBindings is a no-op on a finalized strata scene (ids + geometry + bindings unchanged)",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);
      const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      const repaired = repairTerraformEdgeBindings(scene.elements);
      expect(repaired.map((el) => el.id)).toEqual(
        scene.elements.map((el) => el.id),
      );
      expect(repaired).toEqual(scene.elements);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "FULL mode (compact:false, staging-extended-localstack-v2): finalize succeeds (no degradation), satellite appearances qualified, run-twice byte-equal",
    async () => {
      // The Q2 battery's G2_strata_k0_full arm — the configuration that
      // collided on the bare-key scheme (duplicate tf:node:aws_ecs_cluster.this
      // from two satellite appearances) and degraded every full arm to v2.
      const { nodes, plan } = loadNodes("staging-extended-localstack-v2");
      const scene1 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: false,
      });
      expect(scene1.meta.rcllV2Degraded).toBeUndefined();
      expect(scene1.elements.length).toBeGreaterThan(0);

      // uniqueness holds scene-wide (ids and group ids canonical + distinct)
      const ids = scene1.elements.map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      const groupIds = new Set<string>();
      for (const el of scene1.elements) {
        expect(isStrataCanonicalId(el.id), `canonical id: ${el.id}`).toBe(true);
        for (const gid of el.groupIds ?? []) {
          expect(gid.startsWith("tfg:"), `canonical group id: ${gid}`).toBe(
            true,
          );
          groupIds.add(gid);
        }
      }

      // the collision class is really present AND really qualified: the
      // battery's colliding resource appears ≥2 times, parent-disambiguated.
      const ecsClusterNodes = ids.filter((id) =>
        id.startsWith("tf:node:aws_ecs_cluster.this"),
      );
      expect(ecsClusterNodes.length).toBeGreaterThanOrEqual(2);
      for (const id of ecsClusterNodes) {
        if (id !== "tf:node:aws_ecs_cluster.this") {
          expect(id).toMatch(/^tf:node:aws_ecs_cluster\.this:#/);
        }
      }

      // full-mode T1: run-twice byte-equal (ids/seeds/versionNonces included)
      const scene2 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: false,
      });
      expect(scene2.elements).toEqual(scene1.elements);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
