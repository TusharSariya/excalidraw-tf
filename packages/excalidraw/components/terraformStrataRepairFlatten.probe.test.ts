/**
 * M1 probe — quantify the `repairTerraformEdgeBindings` FLATTEN of styled
 * `strataEdgeStyle:"curve"` edges on `staging-extended-localstack-v2`.
 *
 * VERIFIED DIAGNOSIS (this test measures, it does not re-derive):
 *   `applyStrataEdgeStyle("curve")` reshapes every eligible declared-dataflow
 *   chord into a stamped bezier/orbit polyline (`customData.terraformRoutedPolyline
 *   = true`, points.length > 2). Downstream, `repairTerraformEdgeBindings`
 *   (inside `convertPipelineSkeletonToElements`) runs a validate-before-trust
 *   gate: the routed marker is honoured ONLY when BOTH polyline endpoints sit
 *   within ROUTED_ANCHOR_TOLERANCE (=48px chebyshev-outside) of the keyed CARD
 *   BODY rect (`terraformVisibilityRole:"resource"` rectangles). But the styled
 *   chord's endpoints were clipped against the leaf FRAME box (registered in
 *   `layoutBoxes`), which for tall composite cards sits > 48px outside the inset
 *   card body — so the gate flattens the polyline back to a 2-point chord and
 *   strips the stamp.
 *
 * The probe reaches the SAME skeleton `buildTerraformStrataExcalidrawScene`
 * builds (reconstructing the vanilla model→rank→place→A7-refine→assemble phase
 * sequence with the owner's config: strata / sweeps 4 / coordinateRefine / curve)
 * and derives BOTH stages from that ONE skeleton so the flatten delta is a pure
 * function of the repair pass:
 *   Stage A (pre-repair)  = convert → mirror → inject-icons  (STOP before repair)
 *   Stage B (post-repair) = repairTerraformEdgeBindings(A) — the exact production
 *     repair fn convertPipelineSkeletonToElements calls, run in isolation so the
 *     visibility soft-delete that runs AFTER it (declaredDataFlow layer is pinned
 *     OFF) cannot mask the flattened geometry.
 * A cross-check against the real full engine (which DOES soft-delete, so declared
 * arrows are counted including isDeleted) validates the reconstruction is faithful.
 *
 * NOTHING here mutates production source. Run:
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataRepairFlatten.probe.test.ts
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import { convertToExcalidrawElements } from "@excalidraw/element";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import { assembleStrataSceneSkeleton } from "./terraformPipelineStrataSceneBuild";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { mirrorAndDetachTerraformResourceLabels } from "./terraformElkLayout";
import { injectTerraformAwsIconsIntoElements } from "./terraformAwsIcons";
import {
  getTerraformEdgeLayer,
  getTerraformVisibilityKey,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";
import { applyStrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { TerraformDependencyLayoutBox } from "./terraformElkLayout";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type {
  StrataBox,
  StrataEngineOptions,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

const PRESET = "staging-extended-localstack-v2";

/** Mirror of terraformVisibility.ts:94 — the gate tolerance under test. */
const ROUTED_ANCHOR_TOLERANCE = 48;

/** Mirror of terraformVisibility.ts:97 — chebyshev distance OUTSIDE a rect. */
const chebyshevOutside = (
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number => Math.max(0, rx - px, px - (rx + rw), ry - py, py - (ry + rh));

// ── preset → nodes/plan (same recipe as the strata scene-build/finalize tests) ─

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

/**
 * Reconstruct the VANILLA `buildTerraformStrataExcalidrawScene` phase sequence
 * (terraformPipelineStrata.ts) for the owner's config — every non-default strata
 * toggle OFF — up to and INCLUDING `assembleStrataSceneSkeleton` with edgeStyle
 * "curve". Returns the styled skeleton + the id→box map the emission read.
 */
function buildStyledSkeleton(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  compact: boolean,
): {
  skeleton: ExcalidrawElementSkeleton[];
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>;
  edgeStyleMeta: { styled: number; skipped: number; orbited: number } | undefined;
} {
  const prep = preparePipelineLayout(nodes, plan, compact);
  const engineOptions: StrataEngineOptions = {
    compact,
    includeAncillary: false,
    networkSimplexRank: false,
    rankSeparate: false,
    sweeps: 4,
    coordinateRefine: true,
  };
  const model = buildStrataModel(prep, engineOptions);
  const repair = repairStrataCycles(model.edges, model.addressOf);
  const rank = rankStrataClusters([...model.clusters.keys()], repair, {
    networkSimplexRank: false,
    rankSeparate: false,
    jointNsProbe: false,
    hullRoot: model.hullRoot,
    unitWidthOf: (id: string) => {
      const cluster = model.clusters.get(id);
      return cluster ? clusterFrameLocalRect(cluster).width : 0;
    },
  } as unknown as Parameters<typeof rankStrataClusters>[2]);
  let placement = placeStrataHulls(model, repair.edgesPrime, rank, engineOptions);
  // A7 coordinate refinement (coordinateRefine true, no packed scoring → the
  // simple single-arm branch, cascade off — the owner's config).
  placement = refineStrataCoordinates(placement, model, repair.edgesPrime, {
    cascade: false,
  });
  const assembled = assembleStrataSceneSkeleton({
    prep,
    model,
    placement,
    nodes,
    edgeStyle: "curve",
  });
  return {
    skeleton: assembled.skeleton,
    layoutBoxes: assembled.layoutBoxes,
    edgeStyleMeta: assembled.edgeStyle,
  };
}

/** Stage A: the production convert path UP TO (excluding) the repair flatten. */
async function convertNoRepair(
  skeleton: ExcalidrawElementSkeleton[],
): Promise<ExcalidrawElement[]> {
  let elements = convertToExcalidrawElements(skeleton, {
    regenerateIds: true,
  }) as ExcalidrawElement[];
  elements = mirrorAndDetachTerraformResourceLabels(elements);
  elements = await injectTerraformAwsIconsIntoElements(elements);
  return elements;
}

// ── element analysis helpers ──────────────────────────────────────────────────

type Rel = { source: string; target: string; sequence?: unknown };

const relOf = (el: ExcalidrawElement): Rel | null => {
  const rel = (el.customData as { relationship?: Record<string, unknown> })
    ?.relationship;
  if (
    rel &&
    typeof rel.source === "string" &&
    typeof rel.target === "string" &&
    rel.aggregated !== true
  ) {
    return { source: rel.source, target: rel.target, sequence: rel.sequence };
  }
  return null;
};

/** A declared-dataflow arrow. `includeHidden` counts arrows the visibility
 * reconcile soft-deleted (the declaredDataFlow layer is pinned OFF by default):
 * repair FLATTENS geometry BEFORE reconcile soft-deletes, so the post-flatten
 * points/stamp survive on the (isDeleted) element and must be counted. */
const isDeclaredArrow = (
  el: ExcalidrawElement,
  includeHidden = false,
): boolean =>
  el.type === "arrow" &&
  (includeHidden || !el.isDeleted) &&
  getTerraformEdgeLayer(el) === "declaredDataFlow" &&
  relOf(el) !== null;

const isStamped = (el: ExcalidrawElement): boolean =>
  (el.customData as { terraformRoutedPolyline?: unknown })
    ?.terraformRoutedPolyline === true;

const pointCount = (el: ExcalidrawElement): number =>
  ((el as unknown as { points?: readonly unknown[] }).points ?? []).length;

/** Stable join key across independent convert() calls (ids are regenerated). */
const edgeKey = (rel: Rel): string =>
  `${rel.source}|||${rel.target}|||${String(rel.sequence ?? "")}`;

/** Absolute (start,end) endpoints of a linear element. */
const endpointsOf = (
  el: ExcalidrawElement,
): { start: [number, number]; end: [number, number] } => {
  const pts = (el as unknown as { points: [number, number][] }).points;
  const p0 = pts[0]!;
  const pl = pts[pts.length - 1]!;
  return {
    start: [el.x + p0[0], el.y + p0[1]],
    end: [el.x + pl[0], el.y + pl[1]],
  };
};

/** Rebuild `collectTerraformResourceRects` keying (terraformVisibility.ts:913)
 * over an element array, preserving order so last-wins matches the repair pass;
 * ALSO return the per-key candidate list for the duplicate-appearance question. */
function buildResourceRects(elements: readonly ExcalidrawElement[]): {
  rects: Map<string, ExcalidrawElement>;
  candidates: Map<string, ExcalidrawElement[]>;
} {
  const rects = new Map<string, ExcalidrawElement>();
  const candidates = new Map<string, ExcalidrawElement[]>();
  for (const el of elements) {
    if (el.isDeleted || el.type !== "rectangle") {
      continue;
    }
    const cd = (el.customData ?? {}) as Record<string, unknown>;
    if (cd.terraformAwsIconGlyph === true) {
      continue;
    }
    if (cd.terraformVisibilityRole !== "resource") {
      continue;
    }
    const key = getTerraformVisibilityKey(el);
    if (!key) {
      continue;
    }
    rects.set(key, el); // last-wins (mirrors rects.set(key, element))
    const list = candidates.get(key) ?? [];
    list.push(el);
    candidates.set(key, list);
  }
  return { rects, candidates };
}

const resourceType = (address: string): string => {
  const parts = address.split(".");
  return parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
};

const trunc = (s: string, n = 26): string =>
  s.length > n ? `…${s.slice(-(n - 1))}` : s;

const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return NaN;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ── per-arm probe ─────────────────────────────────────────────────────────────

type FlatRow = {
  edge: string;
  srcType: string;
  fails: string;
  bodyDist: number; // chebyshev-outside keyed CARD body rect (failing endpoint)
  frameDist: number; // chebyshev-outside leaf FRAME box (failing endpoint)
  dx: number;
  dy: number;
};

async function probeArm(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  compact: boolean,
): Promise<{
  declaredA: number;
  styledA: number;
  metaStyled: number | undefined;
  survivorB: number;
  gateFlattened: number;
  neverStyled: number;
  rows: FlatRow[];
  realDeclared: number;
  realSurvivor: number;
  realFlattened: number;
  dupKeys: number;
  dupEdgesTouching: number;
  dupAllDeterministic: boolean;
  dupResolveRows: {
    key: string;
    candidates: number;
    edgesTouching: number;
    resolvedGeom: string;
    deterministic: boolean;
  }[];
}> {
  const built = buildStyledSkeleton(nodes, plan, compact);

  // Stage A = pre-repair (curve intact): the production convert prefix, STOP
  // before the repair flatten. Stage B = repairTerraformEdgeBindings(A) — the
  // EXACT production repair pass (the same fn convertPipelineSkeletonToElements
  // calls), applied in isolation so the visibility soft-delete that runs AFTER
  // it in the full path cannot mask the flattened geometry. Repair maps 1:1 and
  // order-preserving, so stageA[i] (curve) ↔ stageB[i] (post-repair) index-align.
  const stageA = await convertNoRepair(built.skeleton);
  const stageB = repairTerraformEdgeBindings(stageA);

  const { rects: rectsA, candidates: candA } = buildResourceRects(stageA);

  const arrowsA = stageA.filter((el) => isDeclaredArrow(el));
  const styledA = arrowsA.filter(
    (el) => isStamped(el) && pointCount(el) > 2,
  ).length;

  // Index-aligned classification: for each pre-repair declared arrow, look at
  // its post-repair twin. Survivor = stamp kept + >2 pts. Gate-flattened = was a
  // stamped curve in A, lost the stamp / became a 2-pt chord in B.
  const rows: FlatRow[] = [];
  let survivorB = 0;
  let neverStyled = 0;
  for (let i = 0; i < stageA.length; i++) {
    const elA = stageA[i]!;
    if (!isDeclaredArrow(elA)) {
      continue;
    }
    const elB = stageB[i]!;
    const stampedA = isStamped(elA) && pointCount(elA) > 2;
    const survived = isStamped(elB) && pointCount(elB) > 2;
    if (survived) {
      survivorB += 1;
      continue;
    }
    if (!stampedA) {
      neverStyled += 1; // was never a curve (skipped by the style pass)
      continue;
    }
    // gate-flattened: measure the PRE-repair curve endpoints (what the gate saw).
    const rel = relOf(elA)!;
    const { start, end } = endpointsOf(elA);
    const bodyS = rectsA.get(rel.source);
    const bodyT = rectsA.get(rel.target);
    const frameS = built.layoutBoxes.get(rel.source);
    const frameT = built.layoutBoxes.get(rel.target);
    const dStartBody = bodyS
      ? chebyshevOutside(start[0], start[1], bodyS.x, bodyS.y, bodyS.width, bodyS.height)
      : Infinity;
    const dEndBody = bodyT
      ? chebyshevOutside(end[0], end[1], bodyT.x, bodyT.y, bodyT.width, bodyT.height)
      : Infinity;
    const dStartFrame = frameS
      ? chebyshevOutside(start[0], start[1], frameS.x, frameS.y, frameS.width, frameS.height)
      : Infinity;
    const dEndFrame = frameT
      ? chebyshevOutside(end[0], end[1], frameT.x, frameT.y, frameT.width, frameT.height)
      : Infinity;
    const startFails = dStartBody > ROUTED_ANCHOR_TOLERANCE;
    const endFails = dEndBody > ROUTED_ANCHOR_TOLERANCE;
    const fails =
      startFails && endFails
        ? "both"
        : startFails
        ? "start(src)"
        : endFails
        ? "end(tgt)"
        : "none";
    // The failing endpoint(s) drive the flatten; report the max body dist and
    // the corresponding frame dist over the failing set.
    const failBody = Math.max(
      startFails ? dStartBody : -Infinity,
      endFails ? dEndBody : -Infinity,
    );
    const failFrame = Math.max(
      startFails ? dStartFrame : -Infinity,
      endFails ? dEndFrame : -Infinity,
    );
    rows.push({
      edge: `${trunc(rel.source)}→${trunc(rel.target)}`,
      srcType: resourceType(rel.source),
      fails,
      bodyDist: Number.isFinite(failBody) ? Math.round(failBody * 10) / 10 : failBody,
      frameDist: Number.isFinite(failFrame) ? Math.round(failFrame * 10) / 10 : failFrame,
      dx: Math.round(Math.abs(end[0] - start[0])),
      dy: Math.round(Math.abs(end[1] - start[1])),
    });
  }

  // Duplicate-appearance question: resource keys with >1 "resource"-role rect
  // (satellite appearances of one resource in multiple parent clusters). For each
  // such key, which rect the repair binding resolves to = the LAST one in element
  // order (rects.set last-wins). Determinism proof: a SECOND independent
  // conversion of the SAME skeleton must resolve the key to byte-identical
  // geometry. Also record how many declared edges reference each dup key (repair
  // binds those edges to the resolved rect).
  const stageA2 = await convertNoRepair(built.skeleton);
  const { rects: rectsA2 } = buildResourceRects(stageA2);
  const dupKeySet = new Set<string>();
  for (const [key, list] of candA) {
    if (list.length > 1) {
      dupKeySet.add(key);
    }
  }
  const edgeTouchByKey = new Map<string, number>();
  for (const el of arrowsA) {
    const rel = relOf(el)!;
    for (const endKey of new Set([rel.source, rel.target])) {
      if (dupKeySet.has(endKey)) {
        edgeTouchByKey.set(endKey, (edgeTouchByKey.get(endKey) ?? 0) + 1);
      }
    }
  }
  const geomOf = (el: ExcalidrawElement | undefined): string =>
    el ? `${el.x},${el.y},${el.width},${el.height}` : "∅";
  const dupResolveRows: {
    key: string;
    candidates: number;
    edgesTouching: number;
    resolvedGeom: string;
    deterministic: boolean;
  }[] = [];
  for (const key of dupKeySet) {
    const g1 = geomOf(rectsA.get(key));
    const g2 = geomOf(rectsA2.get(key));
    dupResolveRows.push({
      key: trunc(key, 40),
      candidates: candA.get(key)!.length,
      edgesTouching: edgeTouchByKey.get(key) ?? 0,
      resolvedGeom: g1,
      deterministic: g1 === g2,
    });
  }
  const dupEdgesTouching = [...edgeTouchByKey.values()].reduce(
    (a, b) => a + b,
    0,
  );
  const dupAllDeterministic = dupResolveRows.every((r) => r.deterministic);

  // Cross-check: the REAL engine (full orchestrator, owner's config). The full
  // path soft-deletes declaredDataFlow arrows (layer pinned off), so count them
  // INCLUDING isDeleted — the flattened geometry survives on the hidden element.
  const real = await buildTerraformStrataExcalidrawScene(nodes, plan, {
    compact,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataEdgeStyle: "curve",
  } as unknown as Parameters<typeof buildTerraformStrataExcalidrawScene>[2]);
  const realArrows = real.elements.filter((el) => isDeclaredArrow(el, true));
  const realSurvivor = realArrows.filter(
    (el) => isStamped(el) && pointCount(el) > 2,
  ).length;
  const realFlattened = realArrows.length - realSurvivor;

  return {
    declaredA: arrowsA.length,
    styledA,
    metaStyled: built.edgeStyleMeta?.styled,
    survivorB,
    gateFlattened: rows.length,
    neverStyled,
    rows,
    realDeclared: realArrows.length,
    realSurvivor,
    realFlattened,
    dupKeys: dupKeySet.size,
    dupEdgesTouching,
    dupAllDeterministic,
    dupResolveRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — preset probe, two mode arms
// ─────────────────────────────────────────────────────────────────────────────

describe("strata repair-flatten probe — curve edges on the pinned preset", () => {
  it(
    "PART 1 — flatten census (compact:false PRIMARY + compact:true) with per-edge gate distances",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);

      const primary = await probeArm(nodes, plan, false); // compact:false — owner's config
      const secondary = await probeArm(nodes, plan, true); // compact:true

      for (const [label, arm] of [
        ["compact:false (PRIMARY)", primary],
        ["compact:true", secondary],
      ] as const) {
        const bodyDists = arm.rows
          .map((r) => r.bodyDist)
          .filter((n) => Number.isFinite(n));
        const frameDists = arm.rows
          .map((r) => r.frameDist)
          .filter((n) => Number.isFinite(n));
        // eslint-disable-next-line no-console
        console.log(
          `\n=== ${label} ===\n` +
            `declared arrows (Stage A) : ${arm.declaredA}\n` +
            `styled (stamped curve) A  : ${arm.styledA}  (meta.styled=${arm.metaStyled})\n` +
            `survivors (Stage B)       : ${arm.survivorB}\n` +
            `gate-FLATTENED            : ${arm.gateFlattened}\n` +
            `never-styled (skipped)    : ${arm.neverStyled}\n` +
            `REAL engine: declared=${arm.realDeclared} survivor=${arm.realSurvivor} flattened=${arm.realFlattened}\n` +
            `chebyshev-to-keyed-BODY  (flattened): min=${bodyDists.length ? Math.min(...bodyDists) : "-"} median=${median(bodyDists)} max=${bodyDists.length ? Math.max(...bodyDists) : "-"}\n` +
            `chebyshev-to-FRAME-box   (flattened): min=${frameDists.length ? Math.min(...frameDists) : "-"} median=${median(frameDists)} max=${frameDists.length ? Math.max(...frameDists) : "-"}\n` +
            `duplicate resource keys (>1 rect): ${arm.dupKeys}  (declared edges touching a dup key: ${arm.dupEdgesTouching}; all resolutions deterministic: ${arm.dupAllDeterministic})`,
        );
        // eslint-disable-next-line no-console
        console.table(arm.rows.slice(0, 30));
        if (arm.dupResolveRows.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `--- ${label}: duplicate-key rect resolution (last-wins) + determinism ---`,
          );
          // eslint-disable-next-line no-console
          console.table(arm.dupResolveRows.slice(0, 20));
        }
      }

      // ── STRUCTURAL guards (both arms) ──
      expect(primary.declaredA).toBeGreaterThan(0);
      expect(secondary.declaredA).toBeGreaterThan(0);
      // styled count is internally consistent with the pass's own meta.
      expect(primary.styledA).toBe(primary.metaStyled);
      expect(secondary.styledA).toBe(secondary.metaStyled);
      expect(primary.styledA).toBeGreaterThan(0);
      expect(secondary.styledA).toBeGreaterThan(0);

      // ── FIDELITY: reconstruction == real engine (survivor/flatten counts) ──
      // Both derive survivor/flatten from the SAME classification; if the
      // reconstructed vanilla phase order matches production these are equal.
      expect(primary.survivorB).toBe(primary.realSurvivor);
      expect(primary.gateFlattened + primary.neverStyled).toBe(
        primary.realFlattened,
      );
      expect(secondary.survivorB).toBe(secondary.realSurvivor);

      // ── PINNING (primary arm): the flatten is real and large ──
      expect(primary.gateFlattened).toBeGreaterThanOrEqual(80);

      // ── PINNING (primary arm): mechanism — every gate-flattened edge fails on
      // the BODY rect (>48px) while its failing endpoint sits on the FRAME border
      // (<=2px). Reported as a fraction so an alternate mechanism surfaces as data
      // rather than a bare throw (per M1 plan). ──
      const finite = primary.rows.filter(
        (r) => Number.isFinite(r.bodyDist) && Number.isFinite(r.frameDist),
      );
      const bodyOver48 = finite.filter(
        (r) => r.bodyDist > ROUTED_ANCHOR_TOLERANCE,
      ).length;
      const frameUnder2 = finite.filter((r) => r.frameDist <= 2).length;
      const both = finite.filter(
        (r) => r.bodyDist > ROUTED_ANCHOR_TOLERANCE && r.frameDist <= 2,
      ).length;
      // eslint-disable-next-line no-console
      console.log(
        `\nPRIMARY mechanism check: finite=${finite.length} bodyDist>48=${bodyOver48} frameDist<=2=${frameUnder2} BOTH=${both} ` +
          `(fraction=${finite.length ? (both / finite.length).toFixed(3) : "n/a"})`,
      );
      // Every flattened edge fails the body gate by construction of the set.
      expect(bodyOver48).toBe(finite.length);
      // The framing mechanism dominates (report the exact fraction above).
      expect(both / Math.max(1, finite.length)).toBeGreaterThanOrEqual(0.8);

      // ── DUPLICATE-APPEARANCE: repair's last-wins rect resolution is
      // deterministic across independent conversions of the same skeleton. ──
      expect(primary.dupKeys).toBeGreaterThan(0); // full mode HAS satellite dups
      expect(primary.dupAllDeterministic).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 20,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — synthetic orbit / bezier fixture (direct applyStrataEdgeStyle)
// ─────────────────────────────────────────────────────────────────────────────

describe("applyStrataEdgeStyle — synthetic forward-bezier + back-edge-orbit", () => {
  it("styles a forward chord to a stamped bezier and orbits a genuine back-edge", () => {
    // leaf boxes: A/B carry the FORWARD edge (far left, out of the back-edge
    // corridor); C/D carry the BACK edge; E is a foreign obstacle straddling the
    // back-edge chord with clear space above → the over-the-top orbit succeeds.
    const leafBoxes = new Map<string, StrataBox>([
      ["A", { x: -400, y: 200, width: 100, height: 40 }],
      ["B", { x: -100, y: 200, width: 100, height: 40 }],
      ["C", { x: 600, y: 0, width: 100, height: 40 }],
      ["D", { x: 200, y: 0, width: 100, height: 40 }],
      ["E", { x: 400, y: -20, width: 80, height: 60 }],
    ]);
    const placement = {
      boxedHulls: new Map(),
      leafBoxes,
    } as unknown as StrataPlacementResult;

    const mkArrow = (
      source: string,
      target: string,
      x: number,
      y: number,
      end: [number, number],
    ): ExcalidrawElementSkeleton =>
      ({
        type: "arrow",
        x,
        y,
        points: [
          [0, 0],
          end,
        ],
        customData: {
          terraformEdgeLayer: "declaredDataFlow",
          relationship: { source, target },
        },
      } as unknown as ExcalidrawElementSkeleton);

    // FORWARD: start [-350,220] → end [-50,220] (end.x > start.x).
    const forward = mkArrow("A", "B", -350, 220, [300, 0]);
    // BACK-EDGE: start [640,20] → end [260,20] (end.x < start.x); chord pierces E.
    const back = mkArrow("C", "D", 640, 20, [-380, 0]);

    const skeleton: ExcalidrawElementSkeleton[] = [forward, back];
    const meta = applyStrataEdgeStyle(
      skeleton,
      {} as unknown as StrataModel,
      placement,
      "curve",
    );

    // eslint-disable-next-line no-console
    console.log(
      `\nPART 2 orbit fixture: styled=${meta.styled} orbited=${meta.orbited} orbitReverted=${meta.orbitReverted} skipped=${meta.skipped} pointsTotal=${meta.pointsTotal}`,
    );

    const fwd = skeleton[0] as unknown as {
      points: [number, number][];
      customData: Record<string, unknown>;
    };
    const bck = skeleton[1] as unknown as {
      points: [number, number][];
      customData: Record<string, unknown>;
    };

    // Forward → stamped bezier, > 2 points.
    expect(fwd.customData.terraformRoutedPolyline).toBe(true);
    expect(fwd.points.length).toBeGreaterThan(2);

    // Back-edge → orbited (constructed so the never-worse pierce guard accepts),
    // stamped, > 2 points.
    expect(meta.orbited).toBe(1);
    expect(meta.orbitReverted).toBe(0);
    expect(bck.customData.terraformRoutedPolyline).toBe(true);
    expect(bck.points.length).toBeGreaterThan(2);

    // both edges styled, nothing skipped.
    expect(meta.styled).toBe(2);
    expect(meta.skipped).toBe(0);
  });
});
