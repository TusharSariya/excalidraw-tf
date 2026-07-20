/**
 * W10 banded-compaction ceiling probe (Stage 1 of the W10 two-stage plan;
 * owner screenshot 2026-07-13 triage). Report-emitting, W7/W8-style: this file
 * owns NO layout behavior, changes NO product geometry, and NEVER asserts
 * metric values — only structural harness health (report written, presets
 * exist, offline probe deterministic).
 *
 * Question under test: banded hulls (provider/account; root excluded) place
 * children as a blind full-width vertical stack
 * (terraformPipelineStrataPlacement.ts L321-328) — X-disjoint siblings never
 * share rows. How much canvas height COULD an order-constrained X-overlap
 * skyline reclaim, and would the owner's long chords (WAF→ELB, SQS→RDS,
 * SQS→Dynamo) actually shorten?
 *
 * Method (all offline, on FINAL geometry — the engine is run once per arm and
 * its emitted elements are only measured, never mutated):
 *   1. Build each arm's scene via the same worker path W8 uses.
 *   2. For every banded hull (role provider|account), take its DIRECT children
 *      (child hull frames + primaryCluster cards, resolved by geometric
 *      containment) with their final boxes (x-extent incl. their own padding),
 *      in current top-to-bottom visual order.
 *   3. Recompute an ORDER-CONSTRAINED skyline placement: children processed in
 *      current order; each drops to the lowest Y clearing every already-placed
 *      child whose x-extent overlaps it (dropY semantics reimplemented locally
 *      from terraformPipelineStrataPlacement.ts:80-102, same gap constants via
 *      call-time reads). X-disjoint children may share rows; a child never
 *      rises above an X-overlapping earlier sibling (partial order preserved).
 *   4. Compose BOTTOM-UP: accounts first, then providers re-compacted with the
 *      shrunken account heights (account interiors kept as-is — a CEILING
 *      estimate). Root is reported but NOT compacted; the composed canvas Δ is
 *      the root-stack shift (Σ reclaimed over root children).
 *   5. Chord deltas: each endpoint's Y is shifted by its ancestor hulls'
 *      cumulative child-top offsets under the compaction (no re-layout of
 *      packed interiors — `ceilingEstimate: true`).
 *
 * Arms (P1/P2 × compact, matching the owner's K=4 + A7 config): I (sweeps:4 +
 * coordinateRefine), I_RS (+strataRankSeparate), P (+strataPackedScoring),
 * P_RS (both). Seed 20260704 is the standing battery seed; this probe itself
 * is fully deterministic (no sampling) and is recomputed twice per arm with
 * byte-equality recorded.
 *
 * Run:
 *   Q10_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataBandCompactProbe.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W10_BAND_COMPACT_PROBE.json to $Q10_REPORT_DIR (default tmpdir).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  PIPELINE_CLUSTER_GAP_Y,
  PIPELINE_LANE_GAP_Y,
} from "./terraformPipelineLayoutShared";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q10_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 40;

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── arms (owner config: K=4 sweeps + coordRefine everywhere) ────────────────

const BASE_STRATA: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  I: { ...BASE_STRATA },
  I_RS: { ...BASE_STRATA, strataRankSeparate: true },
  P: { ...BASE_STRATA, strataPackedScoring: true },
  P_RS: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataPackedScoring: true,
  },
};

// ── scene readers ────────────────────────────────────────────────────────────

/** All container-hull roles (used for the hull/leaf skyline gap + parenting);
 * the banded subset under probe is provider|account (root: reported, never
 * compacted). */
const HULL_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const topologyRole = (el: ExcalidrawElement): string | undefined => {
  const role = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyRole;
  return typeof role === "string" ? role : undefined;
};

const isHullFrame = (el: ExcalidrawElement): boolean =>
  el.type === "frame" &&
  !el.isDeleted &&
  HULL_ROLES.has(topologyRole(el) ?? "");

const isResourceCard = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && !el.isDeleted && topologyRole(el) === "primaryCluster";

/** el fully inside container (0.5px tolerance), never itself. */
const containsBox = (
  container: ExcalidrawElement,
  el: ExcalidrawElement,
  eps = 0.5,
): boolean =>
  container !== el &&
  el.x >= container.x - eps &&
  el.y >= container.y - eps &&
  el.x + el.width <= container.x + container.width + eps &&
  el.y + el.height <= container.y + container.height + eps;

/**
 * TFD arrows (soft-deleted in the skeleton; visibility reconcile reveals them
 * at runtime — do NOT filter on isDeleted, same as W7/W8).
 */
const isTfdArrow = (el: ExcalidrawElement): boolean => {
  if (el.type !== "arrow") {
    return false;
  }
  const rel = (el.customData as Record<string, unknown> | undefined)
    ?.relationship as Record<string, unknown> | undefined;
  return (
    typeof rel?.source === "string" &&
    typeof rel?.target === "string" &&
    rel?.aggregated !== true
  );
};

// ── local dropY (semantics of terraformPipelineStrataPlacement.ts:80-102) ────
//
// Deliberately reimplemented here rather than exported from production code
// (zero product-code change). Gap constants are CALL-TIME reads of the shared
// LayoutShared bindings (NaN import-cycle rule: no module-level derived
// consts).

type SkylineRect = { x0: number; x1: number; y1: number; isHull: boolean };

function gapBetween(aIsHull: boolean, bIsHull: boolean): number {
  return aIsHull || bIsHull ? PIPELINE_LANE_GAP_Y : PIPELINE_CLUSTER_GAP_Y;
}

/** Lowest y ≥ startY where [x0,x1) × [y,y+h) clears every placed rect (with
 * the hull/leaf stacked gap). Monotone downward, no gap back-fill. */
function dropY(
  rects: readonly SkylineRect[],
  x0: number,
  x1: number,
  startY: number,
  isHull: boolean,
): number {
  let y = startY;
  let moved = true;
  while (moved) {
    moved = false;
    for (const rect of rects) {
      if (x0 < rect.x1 && rect.x0 < x1 && y < rect.y1) {
        const floor = rect.y1 + gapBetween(rect.isHull, isHull);
        if (floor > y) {
          y = floor;
          moved = true;
        }
      }
    }
  }
  return y;
}

// ── offline probe ────────────────────────────────────────────────────────────

type ChildRow = {
  id: string;
  name: string | null;
  role: string;
  x0: number;
  x1: number;
  heightUsed: number;
  yTopLocalBefore: number;
  yTopLocalAfter: number;
  deltaY: number;
};

type HullCompaction = {
  id: string;
  name: string | null;
  role: string;
  childCount: number;
  heightBefore: number;
  heightAfter: number;
  reclaimed: number;
  children: ChildRow[];
};

type ChordEstimate = {
  found: boolean;
  /** found:false ⟺ a resource address is absent from the preset (P2 has no
   * WAF/SQS resources) — a MISSING pair, never a measured Δ0. */
  absentFromPreset: boolean;
  /** true ⟺ both endpoints resolve to the SAME movable unit at every banded
   * level (account child, provider child, root child) — their Δ is then
   * invariant BY CONSTRUCTION of this estimate (packed interiors never
   * re-laid), not a measured null result. */
  invariantByConstruction: boolean | null;
  sourceAddress: string | null;
  targetAddress: string | null;
  before: number | null;
  after: number | null;
  deltaPx: number | null;
  sourceDy: number | null;
  targetDy: number | null;
  ceilingEstimate: true;
};

type ProbeResult = {
  canvasHeightBefore: number;
  canvasHeightAfter: number;
  composedReclaimedPx: number;
  reclaimedPct: number;
  perLevel: {
    account: { hulls: HullCompaction[]; totalReclaimed: number };
    provider: { hulls: HullCompaction[]; totalReclaimed: number };
  };
  root: {
    compacted: false;
    childCount: number;
    children: Array<{
      id: string;
      name: string | null;
      role: string;
      heightBefore: number;
      reclaimedTotal: number;
      rootStackDy: number;
    }>;
  };
  chords: {
    wafElb: ChordEstimate;
    sqsRds: ChordEstimate;
    sqsDynamo: ChordEstimate;
  };
};

const frameName = (el: ExcalidrawElement): string | null => {
  const name = (el as unknown as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
};

function computeBandCompactProbe(
  elements: readonly ExcalidrawElement[],
): ProbeResult {
  const hulls = elements.filter(isHullFrame);
  const cards = elements.filter(isResourceCard);
  const candidates = [...hulls, ...cards];

  // Direct parent hull of each candidate = smallest-area hull containing it.
  const parentOf = new Map<string, ExcalidrawElement | null>();
  for (const cand of candidates) {
    let best: ExcalidrawElement | null = null;
    for (const hull of hulls) {
      if (containsBox(hull, cand)) {
        if (
          best === null ||
          hull.width * hull.height < best.width * best.height
        ) {
          best = hull;
        }
      }
    }
    parentOf.set(cand.id, best);
  }

  const childrenOf = (hull: ExcalidrawElement | null): ExcalidrawElement[] =>
    candidates
      .filter((c) => parentOf.get(c.id) === hull)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));

  /**
   * Order-constrained skyline recompute of one banded hull's children.
   * `heightOverride` supplies already-shrunk child heights (bottom-up compose);
   * "before" bottoms always use the ORIGINAL geometry.
   */
  const compactHull = (
    hull: ExcalidrawElement,
    heightOverride: ReadonlyMap<string, number>,
  ): { row: HullCompaction; childDelta: Map<string, number> } => {
    const kids = childrenOf(hull);
    const childDelta = new Map<string, number>();
    if (kids.length === 0) {
      return {
        row: {
          id: hull.id,
          name: frameName(hull),
          role: topologyRole(hull) ?? "?",
          childCount: 0,
          heightBefore: round2(hull.height),
          heightAfter: round2(hull.height),
          reclaimed: 0,
          children: [],
        },
        childDelta,
      };
    }
    const topLocal = Math.min(...kids.map((k) => k.y)) - hull.y;
    const rects: SkylineRect[] = [];
    const children: ChildRow[] = [];
    let newBottom = topLocal;
    let oldBottom = topLocal;
    for (const kid of kids) {
      const h = heightOverride.get(kid.id) ?? kid.height;
      const isHull = HULL_ROLES.has(topologyRole(kid) ?? "");
      const yBefore = kid.y - hull.y;
      const yAfter = dropY(rects, kid.x, kid.x + kid.width, topLocal, isHull);
      rects.push({ x0: kid.x, x1: kid.x + kid.width, y1: yAfter + h, isHull });
      childDelta.set(kid.id, yAfter - yBefore);
      newBottom = Math.max(newBottom, yAfter + h);
      oldBottom = Math.max(oldBottom, yBefore + kid.height);
      children.push({
        id: kid.id,
        name: frameName(kid),
        role: topologyRole(kid) ?? "?",
        x0: round2(kid.x),
        x1: round2(kid.x + kid.width),
        heightUsed: round2(h),
        yTopLocalBefore: round2(yBefore),
        yTopLocalAfter: round2(yAfter),
        deltaY: round2(yAfter - yBefore),
      });
    }
    const reclaimed = round2(oldBottom - newBottom);
    return {
      row: {
        id: hull.id,
        name: frameName(hull),
        role: topologyRole(hull) ?? "?",
        childCount: kids.length,
        heightBefore: round2(hull.height),
        heightAfter: round2(hull.height - reclaimed),
        reclaimed,
        children,
      },
      childDelta,
    };
  };

  // Pass 1: accounts (original child heights — regions/cards are untouched).
  const accountHulls = hulls
    .filter((h) => topologyRole(h) === "account")
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const accountRows: HullCompaction[] = [];
  const accountReclaim = new Map<string, number>();
  const accountChildDelta = new Map<string, Map<string, number>>();
  for (const acc of accountHulls) {
    const { row, childDelta } = compactHull(acc, new Map());
    accountRows.push(row);
    accountReclaim.set(acc.id, row.reclaimed);
    accountChildDelta.set(acc.id, childDelta);
  }

  // Pass 2: providers, re-compacted with the SHRUNKEN account heights
  // (account interiors as-is — ceiling estimate).
  const providerHulls = hulls
    .filter((h) => topologyRole(h) === "provider")
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const shrunkHeights = new Map<string, number>();
  for (const acc of accountHulls) {
    shrunkHeights.set(acc.id, acc.height - (accountReclaim.get(acc.id) ?? 0));
  }
  const providerRows: HullCompaction[] = [];
  const providerReclaim = new Map<string, number>();
  const providerChildDelta = new Map<string, Map<string, number>>();
  for (const prov of providerHulls) {
    const { row, childDelta } = compactHull(prov, shrunkHeights);
    providerRows.push(row);
    providerReclaim.set(prov.id, row.reclaimed);
    providerChildDelta.set(prov.id, childDelta);
  }

  // Root band: reported, never compacted. The composed canvas Δ is the pure
  // stack shift — each root child keeps order and moves up by the cumulative
  // reclaimed height of the children stacked above it.
  const rootChildren = childrenOf(null);
  const reclaimedTotalOf = (el: ExcalidrawElement): number => {
    const role = topologyRole(el);
    if (role === "provider") {
      return providerReclaim.get(el.id) ?? 0;
    }
    if (role === "account") {
      return accountReclaim.get(el.id) ?? 0;
    }
    return 0;
  };
  const rootDelta = new Map<string, number>();
  let cumulative = 0;
  const rootRows: ProbeResult["root"]["children"] = [];
  for (const child of rootChildren) {
    rootDelta.set(child.id, -cumulative);
    rootRows.push({
      id: child.id,
      name: frameName(child),
      role: topologyRole(child) ?? "?",
      heightBefore: round2(child.height),
      reclaimedTotal: round2(reclaimedTotalOf(child)),
      rootStackDy: round2(-cumulative),
    });
    cumulative += reclaimedTotalOf(child);
  }
  const composedReclaimedPx = round2(cumulative);

  // Canvas height = bbox over non-deleted elements (frames + cards + text).
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.height);
  }
  const canvasHeightBefore = round2(
    Number.isFinite(maxY - minY) ? maxY - minY : 0,
  );
  const canvasHeightAfter = round2(canvasHeightBefore - composedReclaimedPx);

  // ── chord estimates ────────────────────────────────────────────────────────
  //
  // Endpoint Y shift = Σ over the endpoint's ancestor banded hulls of the
  // child-unit top offset (account child unit + provider child unit) + the
  // root-stack shift of its top-level ancestor. Packed interiors never move
  // relative to their container.
  // dy + the endpoint's "movable path" (which unit it rides at each banded
  // level). Two endpoints with identical paths receive identical dy at every
  // level — their chord is invariant BY CONSTRUCTION of this estimate.
  const movableUnitsOfCard = (
    card: ExcalidrawElement,
  ): { dy: number; path: string[] } => {
    let dy = 0;
    const path: string[] = [];
    for (const [hullList, deltasByHull] of [
      [accountHulls, accountChildDelta],
      [providerHulls, providerChildDelta],
    ] as const) {
      let owner: ExcalidrawElement | null = null;
      for (const hull of hullList) {
        if (containsBox(hull, card)) {
          if (
            owner === null ||
            hull.width * hull.height < owner.width * owner.height
          ) {
            owner = hull;
          }
        }
      }
      if (owner) {
        const kids = childrenOf(owner);
        const unit = kids.find((k) => k === card || containsBox(k, card));
        if (unit) {
          dy += deltasByHull.get(owner.id)?.get(unit.id) ?? 0;
          path.push(`${owner.id}:${unit.id}`);
        }
      }
    }
    const rootUnit = rootChildren.find(
      (k) => k === card || containsBox(k, card),
    );
    if (rootUnit) {
      dy += rootDelta.get(rootUnit.id) ?? 0;
      path.push(`root:${rootUnit.id}`);
    }
    return { dy, path };
  };

  // primaryCluster frames keyed by terraformPrimaryAddress (canonical
  // resolution, same as W8 / computeStrataPathMetrics).
  const cardByAddress = new Map<string, ExcalidrawElement>();
  for (const card of cards) {
    const addr = (card.customData as Record<string, unknown> | undefined)
      ?.terraformPrimaryAddress;
    if (typeof addr === "string" && !cardByAddress.has(addr)) {
      cardByAddress.set(addr, card);
    }
  }
  const findAddress = (re: RegExp): string | null =>
    [...cardByAddress.keys()].find((a) => re.test(a)) ?? null;

  const chord = (
    sourceAddress: string | null,
    targetAddress: string | null,
  ): ChordEstimate => {
    const a = sourceAddress ? cardByAddress.get(sourceAddress) : undefined;
    const b = targetAddress ? cardByAddress.get(targetAddress) : undefined;
    if (!a || !b) {
      return {
        found: false,
        absentFromPreset: true,
        invariantByConstruction: null,
        sourceAddress,
        targetAddress,
        before: null,
        after: null,
        deltaPx: null,
        sourceDy: null,
        targetDy: null,
        ceilingEstimate: true,
      };
    }
    const cx = (e: ExcalidrawElement) => e.x + e.width / 2;
    const cy = (e: ExcalidrawElement) => e.y + e.height / 2;
    const { dy: dyA, path: pathA } = movableUnitsOfCard(a);
    const { dy: dyB, path: pathB } = movableUnitsOfCard(b);
    const before = Math.hypot(cx(b) - cx(a), cy(b) - cy(a));
    const after = Math.hypot(cx(b) - cx(a), cy(b) + dyB - (cy(a) + dyA));
    return {
      found: true,
      absentFromPreset: false,
      invariantByConstruction: pathA.join("|") === pathB.join("|"),
      sourceAddress,
      targetAddress,
      before: round2(before),
      after: round2(after),
      deltaPx: round2(after - before),
      sourceDy: round2(dyA),
      targetDy: round2(dyB),
      ceilingEstimate: true,
    };
  };

  // WAF→ELB (owner obs 1): waf_acl = aws_wafv2_web_acl.api, ELB = aws_lb.ecs
  // (tfd `waf_acl -> ecs_alb`, staging-ecs-alb).
  const wafAddr = findAddress(/aws_wafv2_web_acl\.api(?![\w])/);
  const elbAddr = findAddress(/aws_lb\.ecs(?![\w])/);

  // Owner SQS pairs (round-9 case, resolved the W8 way): SQS→RDS via the TFD
  // arrow's own relationship addresses; Dynamo by address regex.
  const sqsAddr = findAddress(/aws_sqs_queue\.regional_writer_west(?![\w])/);
  const dynamoAddr = findAddress(
    /aws_dynamodb_table\.regional_events_west(?![\w])/,
  );
  let rdsAddr: string | null = null;
  const rdsArrow = elements.filter(isTfdArrow).find((a) => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    const pair = `${rel.source} ${rel.target}`;
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });
  if (rdsArrow) {
    const rel = (rdsArrow.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    // relationship source/target order is not guaranteed — take whichever
    // side is the RDS endpoint (the other side is the SQS queue).
    rdsAddr =
      [rel.source, rel.target].find(
        (addr) => /rds|db_instance/i.test(addr) && cardByAddress.has(addr),
      ) ?? null;
  }

  return {
    canvasHeightBefore,
    canvasHeightAfter,
    composedReclaimedPx,
    reclaimedPct:
      canvasHeightBefore > 0
        ? round2((composedReclaimedPx / canvasHeightBefore) * 100)
        : 0,
    perLevel: {
      account: {
        hulls: accountRows,
        totalReclaimed: round2(
          accountRows.reduce((s, r) => s + r.reclaimed, 0),
        ),
      },
      provider: {
        hulls: providerRows,
        totalReclaimed: round2(
          providerRows.reduce((s, r) => s + r.reclaimed, 0),
        ),
      },
    },
    root: {
      compacted: false,
      childCount: rootChildren.length,
      children: rootRows,
    },
    chords: {
      wafElb: chord(wafAddr, elbAddr),
      sqsRds: chord(sqsAddr, rdsAddr),
      sqsDynamo: chord(sqsAddr, dynamoAddr),
    },
  };
}

// ── per-arm build (same worker path as W8) ───────────────────────────────────

async function buildArmElements(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<{ elements: ExcalidrawElement[]; buildMs: number }> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  return {
    elements: (body.elements ?? []) as ExcalidrawElement[],
    buildMs: round2(performance.now() - t0),
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W10 banded-compaction ceiling probe (report-emitting; never asserts metrics)", () => {
  it(
    "P1 + P2 compact — {I, I_RS, P, P_RS} order-constrained skyline ceiling",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W10 Stage-1 ceiling probe: for each banded hull (provider/account; " +
          "root reported but never compacted) in FINAL per-arm geometry, an " +
          "offline ORDER-CONSTRAINED skyline (dropY semantics of " +
          "terraformPipelineStrataPlacement.ts:80-102, same gap constants) " +
          "re-places the hull's direct children in current top-to-bottom " +
          "order — X-disjoint siblings may share rows, a child never rises " +
          "above an X-overlapping earlier sibling. Composition is bottom-up " +
          "(accounts first, providers with shrunken account heights; account " +
          "interiors kept as-is), so all numbers are CEILING estimates. Chord " +
          "deltas shift each endpoint by its ancestor hulls' cumulative " +
          "child-top offsets + the root-stack shift (ceilingEstimate: true). " +
          "Arms: I (K=4 sweeps + coordRefine), I_RS, P, P_RS (owner config). " +
          "Report-only — no metric is asserted. Standing battery seed 20260704 " +
          "(the probe itself is sampling-free and deterministic).",
      };

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );

        const arms: Record<string, unknown> = {};
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          const { elements, buildMs } = await buildArmElements(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          if (elements.length === 0) {
            softFailures.push(`${preset}/${armLabel}: scene EMPTY`);
          }
          const probe = computeBandCompactProbe(elements);
          const again = computeBandCompactProbe(elements);
          const byteIdentical = JSON.stringify(probe) === JSON.stringify(again);
          if (!byteIdentical) {
            softFailures.push(
              `${preset}/${armLabel}: probe recompute NOT deterministic`,
            );
          }
          if (
            probe.perLevel.account.hulls.length === 0 &&
            probe.perLevel.provider.hulls.length === 0
          ) {
            softFailures.push(
              `${preset}/${armLabel}: no banded hulls found in scene`,
            );
          }
          // Presence validation: P1 carries all three tracked pairs — an
          // unresolved chord there is a harness defect, not a missing
          // resource. (P2 legitimately lacks WAF/SQS: absentFromPreset.)
          if (presetLabel === "P1") {
            for (const [chordName, c] of Object.entries(probe.chords)) {
              if (!c.found) {
                softFailures.push(
                  `${preset}/${armLabel}: chord ${chordName} unresolved (expected present in P1)`,
                );
              }
            }
          }
          arms[armLabel] = {
            preset,
            arm: armLabel,
            options: ARM_OPTIONS[armLabel],
            buildMs,
            ...probe,
            determinism: { probeRecomputeByteIdentical: byteIdentical },
          };
        }
        report[presetLabel] = { preset, arms };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W10_BAND_COMPACT_PROBE.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W10_BAND_COMPACT_PROBE.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
