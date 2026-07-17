/**
 * STEP 0 CENSUS — "is there right slack next to ancillary host hulls?"
 *
 * Gate for the greedy right-slack allocator port (plan: floating-snuggling-wirth).
 * The allocator can ONLY widen a band into PRE-EXISTING right slack
 * (`recursiveRightSlackCeiling`, terraformPipelineRcllAncillaryAllocator.ts:486-519):
 * it walks the host's path from root, shrinking the permitted right edge at each
 * level to the nearest vertically-overlapping right sibling, floored at the root's
 * right edge, and NEVER grows the root. If slack is scarce, the allocator is aimed
 * at nothing.
 *
 * Method (measurement only — builds nothing):
 *  - real app path `layoutTerraformFromSources` with strataBandDepth PINNED to
 *    "root" (the owner's config);
 *  - hull boxes reconstructed from the EMITTED hull frames. Strata's `emitHullFrame`
 *    emits each non-root hull at its EXACT placement box and ids it
 *    `topologyFrameSkeletonId(role, hull.id)` = `tf-pipeline:${role}:${encodeURI(key)}`
 *    (terraformPipelineStrataSceneBuild.ts:222-232), so frame box == boxedHulls box and
 *    the key round-trips. The synthetic root emits no frame — its right edge is taken
 *    as the max right over all emitted frames (documented approximation).
 *  - strips built with the shared `buildAncillaryStrips` off the same prep shape strata
 *    builds (`preparePipelineLayout(nodes, plan, compact)`).
 *  - host hull = LONGEST PREFIX of the strip's scope path present in the hull set
 *    (scopeKey is "\0"-joined, identical to `topologyRoleAndKeyFromPath`'s key).
 *
 * WRITES THE ARTIFACT AFTER EVERY ARM (a predecessor timed out at 40min with zero
 * output because it only wrote at the end).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  clearTerraformImportPrepCache,
  getTerraformImportPrepCache,
} from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import {
  ancillaryStripRows,
  preparePipelineLayout,
  PIPELINE_FRAME_PAD,
} from "./terraformPipelineLayoutShared";
import {
  buildAncillaryStrips,
  countAncillaryCards,
} from "./terraformPipelineLayoutAncillary";
import { topologyRoleAndKeyFromPath } from "./terraformPipelineTopologyFrames";

const PRESET = "staging-extended-localstack-v2";
const BAND_DEPTH = "root" as const;
const OUT = path.resolve("scratchpad", "ancillary-census");

const TOPO_ROLES = new Set(["provider", "account", "region", "vpc", "subnetZone"]);
const ROOT = "__root__";

type Box = { x: number; y: number; width: number; height: number };

const yOverlaps = (a: Box, b: Box): boolean =>
  a.y < b.y + b.height && b.y < a.y + a.height;

const median = (xs: number[]): number => quantile(xs, 0.5);
const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) {
    return NaN;
  }
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};

const rowsOf = (
  strip: Parameters<typeof ancillaryStripRows>[0],
  wrap: number,
): { rows: number; height: number; width: number } => {
  const r = ancillaryStripRows(strip, wrap);
  return {
    rows: new Set(r.positions.map((p) => Math.round(p.y))).size,
    height: Math.round(r.height),
    width: Math.round(r.width),
  };
};

type Arm = { name: string; deBand: string };
const ARMS: Arm[] = [{ name: "deBand=none", deBand: "none" }, { name: "deBand=vpc", deBand: "vpc" }];

const measure = async (arm: Arm) => {
  clearTerraformImportPrepCache();
  const t0 = Date.now();
  const res = await layoutTerraformFromSources(
    getTerraformImportPresetSourcesFromDb(PRESET) as never,
    {
      layoutMode: "strata",
      pipelineCompact: true,
      ...resolveStrataDemoOptions({
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
        strataPackedEps: 1,
        strataBandDepth: BAND_DEPTH,
        strataSift: true,
        strataPackedConverge: true,
        strataTransitiveAdopt: true,
        ...(arm.deBand !== "none" ? { strataDeBandLevel: arm.deBand } : {}),
      } as never),
    } as Record<string, unknown>,
  );
  const buildMs = Date.now() - t0;
  if (!res.ok) {
    return { arm: arm.name, ok: false, error: String(res.error), buildMs };
  }
  const scene = res.scene as {
    elements: ExcalidrawElement[];
    meta: Record<string, unknown>;
  };

  // ── hull boxes, reconstructed from the emitted hull frames ──
  const hullBox = new Map<string, Box>();
  let rootRight = -Infinity;
  let rootLeft = Infinity;
  for (const el of scene.elements) {
    if (el.type !== "frame") {
      continue;
    }
    rootRight = Math.max(rootRight, el.x + el.width);
    rootLeft = Math.min(rootLeft, el.x);
    const cd = el.customData as
      | { terraformTopologyRole?: string; terraformTopologyPath?: string[] }
      | undefined;
    const role = String(cd?.terraformTopologyRole ?? "");
    if (!TOPO_ROLES.has(role)) {
      continue;
    }
    // The element `id` is REWRITTEN during skeleton→element conversion
    // (`tf%3Aframe%3Aprovider%3Aaws`), so the skeleton frameId does NOT survive.
    // The hull key is recovered from the stamped topology path instead:
    // `buildStrataHullTree` sets `node.id = topologyRoleAndKeyFromPath(path).key`
    // and `emitHullFrame` stamps `terraformTopologyPath = [...hull.path]` verbatim.
    const rk = topologyRoleAndKeyFromPath(cd?.terraformTopologyPath ?? []);
    if (!rk || rk.role !== role) {
      continue;
    }
    hullBox.set(rk.key, {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    });
  }
  hullBox.set(ROOT, {
    x: rootLeft,
    y: 0,
    width: rootRight - rootLeft,
    height: Number.MAX_SAFE_INTEGER / 4,
  });

  // parent = longest PROPER prefix present in the hull set, else ROOT
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const key of hullBox.keys()) {
    if (key === ROOT) {
      continue;
    }
    const segs = key.split("\0");
    let parent = ROOT;
    for (let n = segs.length - 1; n >= 1; n -= 1) {
      const cand = segs.slice(0, n).join("\0");
      if (hullBox.has(cand)) {
        parent = cand;
        break;
      }
    }
    parentOf.set(key, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), key]);
  }

  // ── strips (shared builder, off the same prep shape strata builds) ──
  const cache = getTerraformImportPrepCache();
  if (!cache) {
    return { arm: arm.name, ok: false, error: "no prep cache", buildMs };
  }
  const prep = preparePipelineLayout(cache.nodes, cache.mergedPlan, true, {});
  const strips = buildAncillaryStrips(cache.nodes, cache.mergedPlan, prep, {
    compact: true,
  });
  const totalCards = countAncillaryCards(strips);

  // ── mirror of recursiveRightSlackCeiling over the reconstructed tree ──
  const slackCeiling = (hostKey: string): number | null => {
    const chain: string[] = [];
    let cur: string | undefined = hostKey;
    while (cur && cur !== ROOT) {
      chain.push(cur);
      cur = parentOf.get(cur);
    }
    chain.push(ROOT);
    chain.reverse(); // [ROOT, ..., host]
    let maxRight = rootRight; // baselineRootRight — hard cap, never grown
    for (let i = 1; i < chain.length; i += 1) {
      const parent = chain[i - 1]!;
      const node = chain[i]!;
      const nb = hullBox.get(node)!;
      let childMaxRight = maxRight - PIPELINE_FRAME_PAD;
      for (const sibKey of childrenOf.get(parent) ?? []) {
        if (sibKey === node) {
          continue;
        }
        const sb = hullBox.get(sibKey)!;
        if (sb.x >= nb.x + nb.width - 0.5 && yOverlaps(sb, nb)) {
          childMaxRight = Math.min(childMaxRight, sb.x - PIPELINE_FRAME_PAD);
        }
      }
      maxRight = Math.max(nb.x + nb.width, childMaxRight);
    }
    return maxRight;
  };

  const rows: Record<string, unknown>[] = [];
  for (const strip of strips) {
    const segs = strip.scopeKey.split("\0");
    let hostKey: string | null = null;
    for (let n = segs.length; n >= 1; n -= 1) {
      const cand = segs.slice(0, n).join("\0");
      if (hullBox.has(cand)) {
        hostKey = cand;
        break;
      }
    }
    const resolvedHost = hostKey ?? ROOT;
    const host = hullBox.get(resolvedHost)!;
    const hostInteriorWidth = host.width - 2 * PIPELINE_FRAME_PAD;
    const ceilingRight = slackCeiling(resolvedHost) ?? host.x + host.width;
    const rightSlackPx = Math.max(0, ceilingRight - (host.x + host.width));
    const atHost = rowsOf(strip, hostInteriorWidth);
    const atSlack = rowsOf(strip, hostInteriorWidth + rightSlackPx);
    const widestCard = Math.max(0, ...strip.cards.map((c) => c.build.width));
    rows.push({
      scopeKey: strip.scopeKey.replace(/\0/g, "/"),
      scopeRole: strip.scopeRole,
      cardCount: strip.cards.length,
      hostKey: resolvedHost === ROOT ? ROOT : resolvedHost.replace(/\0/g, "/"),
      hostRole: resolvedHost === ROOT ? "root" : undefined,
      relocated: resolvedHost !== strip.scopeKey,
      hostWidth: Math.round(host.width),
      hostInteriorWidth: Math.round(hostInteriorWidth),
      widestCard: Math.round(widestCard),
      rightSlackPx: Math.round(rightSlackPx),
      rowsAtHostWrap: atHost.rows,
      rowsAtHostWrapPlusSlack: atSlack.rows,
      heightAtHostWrap: atHost.height,
      heightAtHostWrapPlusSlack: atSlack.height,
    });
  }

  const slacks = rows.map((r) => r.rightSlackPx as number);
  const rHost = rows.map((r) => r.rowsAtHostWrap as number);
  const rSlack = rows.map((r) => r.rowsAtHostWrapPlusSlack as number);
  const cardW = rows.length > 0 ? median(rows.map((r) => r.widestCard as number)) : NaN;

  return {
    arm: arm.name,
    ok: true,
    buildMs,
    bandDepth: BAND_DEPTH,
    deBand: arm.deBand,
    echoedDeBand: scene.meta.strataDeBandLevel ?? null,
    degraded: scene.meta.rcllV2Degraded ?? null,
    hullCount: hullBox.size - 1,
    rootRight: Math.round(rootRight),
    rootWidth: Math.round(rootRight - rootLeft),
    stripCount: strips.length,
    totalCards,
    aggregates: {
      medianRightSlackPx: Math.round(median(slacks)),
      p25RightSlackPx: Math.round(quantile(slacks, 0.25)),
      p75RightSlackPx: Math.round(quantile(slacks, 0.75)),
      maxRightSlackPx: Math.round(Math.max(...slacks)),
      medianRowsAtHostWrap: median(rHost),
      medianRowsAtHostWrapPlusSlack: median(rSlack),
      totalRowsAtHostWrap: rHost.reduce((a, b) => a + b, 0),
      totalRowsAtHostWrapPlusSlack: rSlack.reduce((a, b) => a + b, 0),
      totalRowSavings:
        rHost.reduce((a, b) => a + b, 0) - rSlack.reduce((a, b) => a + b, 0),
      medianCardWidth: Math.round(cardW),
      hostsWithSlackBelowOneCard: rows.filter(
        (r) => (r.rightSlackPx as number) < (r.widestCard as number),
      ).length,
      hostsWithZeroSlack: slacks.filter((s) => s < 1).length,
      stripsWithAnySaving: rows.filter(
        (r) => (r.rowsAtHostWrap as number) > (r.rowsAtHostWrapPlusSlack as number),
      ).length,
    },
    strips: rows,
  };
};

describe("Step 0 census — ancillary host right slack", () => {
  const results: unknown[] = [];
  for (const arm of ARMS) {
    it(
      `measures ${arm.name}`,
      async () => {
        const r = await measure(arm);
        results.push(r);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(
          path.join(OUT, "census.json"),
          `${JSON.stringify({ preset: PRESET, bandDepth: BAND_DEPTH, n: 1, results }, null, 2)}\n`,
        );
        // eslint-disable-next-line no-console
        console.log(`ARM ${arm.name} ->`, JSON.stringify(r, null, 2));
        expect(r.ok).toBe(true);
        // Guards against the exact silent-garbage failure this probe already hit
        // once: a broken hull reconstruction resolves EVERY strip to the root and
        // reports "zero slack everywhere" — a plausible-looking fabricated answer.
        expect((r as { hullCount: number }).hullCount).toBeGreaterThan(0);
        expect((r as { totalCards: number }).totalCards).toBeGreaterThan(0);
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
    );
  }
});
