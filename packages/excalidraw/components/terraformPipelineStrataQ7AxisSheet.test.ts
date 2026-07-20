/**
 * Q7-AXIS blinded sheet + sealed key GENERATOR (W11 WP2; SDEC-24's owed 20-edge
 * direction-reading hand-label, both presets, impact-tracing framing).
 *
 * Report-emitting, clone of the W10b band-compact battery's report pattern
 * (buildArm + getTerraformImportPresetSourcesFromDb + layoutTerraformViaWorkers,
 * Q7AXIS_REPORT_DIR env → tmpdir). This file owns NO layout behavior, changes NO
 * geometry, and asserts ONLY harness structure + determinism + the ≥20-eligible
 * preflight — NEVER a metric value.
 *
 * Per preset (P1 = staging-extended-localstack-v2, P2 = staging-localstack)
 * under the v3.2 default strata arm I ({ layoutMode:"strata", pipelineCompact,
 * strataSweeps:4, strataCoordinateRefine }) it emits:
 *   Q7_AXIS_SHEET_{P1|P2}.json + .md — BLINDED (decision 6): neutral row index,
 *     the two endpoint display names in RANDOMIZED (seeded) order, coarse
 *     canvas-locating hints, the frozen proposition, and a blank ownerLabel. NO
 *     source/target roles, NO x-coords, NO machine proxy.
 *   Q7_AXIS_KEY_{P1|P2}.json — SEALED key: edge id, canonical addresses,
 *     declared direction, the machine source-left-of-target proxy, and the
 *     sheet-frame mapping (which of A/B is the declared source).
 *
 * Cross-hull (decision 7): endpoints whose DEEPEST containing hull frames differ
 * (geometric card-center-in-hull-box containment, deepest = longest
 * terraformTopologyPath; provider (path[0] = aws everywhere) is shared so it
 * never fabricates a cross-hull pair). Preflight asserts ≥20 eligible unique
 * edges/preset (dedupe by canonicalEdgeKey) — the generator FAILS loudly
 * otherwise, never pads. Exactly 20/preset are sampled via mulberry32(20260704)
 * over the canonicalEdgeKey-sorted candidates; the same seeded stream randomizes
 * each edge's A/B frame.
 *
 * Run:
 *   Q7AXIS_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataQ7AxisSheet.test.ts \
 *     --exclude "**\/.claude/**"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  BOOTSTRAP_SEED,
  canonicalEdgeKey,
  mulberry32,
} from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { sourceLeftOfTarget } from "./terraformPipelineStrataQ7AxisScore";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q7AXIS_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 20;
const SAMPLE_N = 20;

/** v3.2 default strata arm I (K=4 + coordRefine). */
const ARM_I: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

/** The FROZEN owner proposition (decision 6/8 — do not reword after labeling). */
const PROPOSITION =
  "On the canvas, which way does this connection read as flowing? " +
  "(A->B / B->A / ambiguous)";

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── scene readers ────────────────────────────────────────────────────────────

type CD = Record<string, unknown>;
const cdOf = (el: ExcalidrawElement): CD => (el.customData ?? {}) as CD;
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

type Card = { address: string; display: string; cx: number; cy: number };
type Hull = { id: string; role: string; depth: number; box: Box };
type Box = { x: number; y: number; w: number; h: number };

/** primaryCluster frames keyed by terraformPrimaryAddress — the same resolution
 * computeStrataPathMetrics uses for node centers. */
function cardsByAddress(
  elements: readonly ExcalidrawElement[],
): Map<string, Card> {
  const out = new Map<string, Card>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = cdOf(el);
    if (cd.terraformTopologyRole !== "primaryCluster") {
      continue;
    }
    const address = str(cd.terraformPrimaryAddress);
    if (!address || out.has(address)) {
      continue;
    }
    const name = (el as unknown as { name?: unknown }).name;
    out.set(address, {
      address,
      display: typeof name === "string" && name ? name : address,
      cx: el.x + el.width / 2,
      cy: el.y + el.height / 2,
    });
  }
  return out;
}

/** Every non-cluster topology hull frame with its box + containment depth
 * (terraformTopologyPath length). Provider is included but, being scene-unique
 * (aws), it can only be the shared deepest of two provider-direct cards — it
 * never fabricates a cross-hull pair. */
function hullFrames(elements: readonly ExcalidrawElement[]): Hull[] {
  const out: Hull[] = [];
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = cdOf(el);
    const role = str(cd.terraformTopologyRole);
    if (!role || role === "primaryCluster") {
      continue;
    }
    const path = cd.terraformTopologyPath;
    if (!Array.isArray(path) || path.length === 0) {
      continue;
    }
    out.push({
      id: el.id,
      role,
      depth: path.length,
      box: { x: el.x, y: el.y, w: el.width, h: el.height },
    });
  }
  return out;
}

const centerInBox = (cx: number, cy: number, b: Box): boolean =>
  cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;

/** The DEEPEST hull frame geometrically containing (cx,cy): max
 * terraformTopologyPath length, ties broken by frame id. null when uncontained. */
function deepestHull(
  cx: number,
  cy: number,
  hulls: readonly Hull[],
): Hull | null {
  let best: Hull | null = null;
  for (const h of hulls) {
    if (!centerInBox(cx, cy, h.box)) {
      continue;
    }
    if (
      best === null ||
      h.depth > best.depth ||
      (h.depth === best.depth && h.id < best.id)
    ) {
      best = h;
    }
  }
  return best;
}

type TfdArrow = { id: string; source: string; target: string };

function tfdArrows(elements: readonly ExcalidrawElement[]): TfdArrow[] {
  const out: TfdArrow[] = [];
  for (const el of elements) {
    if (el.type !== "arrow") {
      continue;
    }
    const rel = cdOf(el).relationship as CD | undefined;
    const source = str(rel?.source);
    const target = str(rel?.target);
    if (!source || !target || rel?.aggregated === true) {
      continue;
    }
    out.push({ id: el.id, source, target });
  }
  return out;
}

// ── coarse canvas-locating hint ──────────────────────────────────────────────

function sceneBounds(elements: readonly ExcalidrawElement[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const ROW_LABELS = ["top", "middle", "bottom"] as const;
const COL_LABELS = ["left", "center", "right"] as const;

/** Coarse 3×3 region of a point within the scene bounds (canvas-locating hint). */
function coarseRegion(px: number, py: number, bounds: Box): string {
  const clamp = (t: number): number => Math.max(0, Math.min(2, Math.floor(t)));
  const col = bounds.w > 0 ? clamp((3 * (px - bounds.x)) / bounds.w) : 1;
  const row = bounds.h > 0 ? clamp((3 * (py - bounds.y)) / bounds.h) : 1;
  return `${ROW_LABELS[row]}-${COL_LABELS[col]}`;
}

// ── sheet/key shapes ─────────────────────────────────────────────────────────

type SheetRow = {
  index: number;
  endpointA: string;
  endpointB: string;
  hint: { midpointRegion: string; endpointA: string; endpointB: string };
  proposition: string;
  ownerLabel: string;
};

type KeyEntry = {
  index: number;
  edgeId: string;
  sourceAddress: string;
  targetAddress: string;
  canonicalEdgeKey: string;
  declaredSourceSlot: "A" | "B";
  machineSourceLeftOfTarget: boolean | null;
  // provenance (deblinding + cross-checks)
  endpointAAddress: string;
  endpointBAddress: string;
  deepestHullSourceId: string | null;
  deepestHullTargetId: string | null;
  midpointRegion: string;
};

type SheetAndKey = {
  preset: string;
  seed: number;
  proposition: string;
  eligibleUniqueCount: number;
  sheet: SheetRow[];
  key: KeyEntry[];
};

/** Deterministic partial Fisher-Yates sample of `max` items from the ascending
 * list, driven by the SUPPLIED rng (so the same stream then feeds A/B flips). */
function sampleWithRng<T>(
  sorted: readonly T[],
  max: number,
  rng: () => number,
): T[] {
  if (sorted.length <= max) {
    return [...sorted];
  }
  const idx = sorted.map((_, i) => i);
  for (let i = 0; i < max; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx
    .slice(0, max)
    .sort((a, b) => a - b)
    .map((i) => sorted[i]!);
}

/**
 * Pure generator: build the blinded sheet + sealed key from the built scene.
 * Deterministic given the elements (single mulberry32(seed) stream, sorted
 * candidate order) — run twice, deep-equal.
 */
function buildSheetAndKey(
  preset: string,
  elements: readonly ExcalidrawElement[],
): SheetAndKey {
  const cards = cardsByAddress(elements);
  const hulls = hullFrames(elements);
  const bounds = sceneBounds(elements);

  // Eligible unique cross-hull edges, deduped by canonicalEdgeKey.
  const seen = new Set<string>();
  type Cand = {
    key: string;
    edgeId: string;
    source: string;
    target: string;
    sourceCard: Card;
    targetCard: Card;
    srcHullId: string | null;
    tgtHullId: string | null;
  };
  const candidates: Cand[] = [];
  for (const a of tfdArrows(elements)) {
    const sourceCard = cards.get(a.source);
    const targetCard = cards.get(a.target);
    if (!sourceCard || !targetCard) {
      continue;
    }
    const srcHull = deepestHull(sourceCard.cx, sourceCard.cy, hulls);
    const tgtHull = deepestHull(targetCard.cx, targetCard.cy, hulls);
    const srcId = srcHull?.id ?? null;
    const tgtId = tgtHull?.id ?? null;
    // Cross-hull: deepest containing hull frames differ.
    if (srcId === tgtId) {
      continue;
    }
    const key = canonicalEdgeKey(a.source, a.target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({
      key,
      edgeId: a.id,
      source: a.source,
      target: a.target,
      sourceCard,
      targetCard,
      srcHullId: srcId,
      tgtHullId: tgtId,
    });
  }
  candidates.sort((x, y) => (x.key === y.key ? 0 : x.key < y.key ? -1 : 1));

  const rng = mulberry32(BOOTSTRAP_SEED);
  const sampled = sampleWithRng(candidates, SAMPLE_N, rng);

  const sheet: SheetRow[] = [];
  const key: KeyEntry[] = [];
  sampled.forEach((c, i) => {
    const index = i + 1;
    // Randomize the A/B frame from the same seeded stream. flip ⇒ source lands
    // in slot B (so declaredSourceSlot = "B"); otherwise source is slot A.
    const flip = rng() < 0.5;
    const slotA = flip ? c.targetCard : c.sourceCard;
    const slotB = flip ? c.sourceCard : c.targetCard;
    const declaredSourceSlot: "A" | "B" = flip ? "B" : "A";
    const midpointRegion = coarseRegion(
      (c.sourceCard.cx + c.targetCard.cx) / 2,
      (c.sourceCard.cy + c.targetCard.cy) / 2,
      bounds,
    );
    sheet.push({
      index,
      endpointA: slotA.display,
      endpointB: slotB.display,
      hint: {
        midpointRegion,
        endpointA: slotA.display,
        endpointB: slotB.display,
      },
      proposition: PROPOSITION,
      ownerLabel: "",
    });
    key.push({
      index,
      edgeId: c.edgeId,
      sourceAddress: c.source,
      targetAddress: c.target,
      canonicalEdgeKey: c.key,
      declaredSourceSlot,
      machineSourceLeftOfTarget: sourceLeftOfTarget(
        round2(c.sourceCard.cx),
        round2(c.targetCard.cx),
      ),
      endpointAAddress: slotA.address,
      endpointBAddress: slotB.address,
      deepestHullSourceId: c.srcHullId,
      deepestHullTargetId: c.tgtHullId,
      midpointRegion,
    });
  });

  return {
    preset,
    seed: BOOTSTRAP_SEED,
    proposition: PROPOSITION,
    eligibleUniqueCount: candidates.length,
    sheet,
    key,
  };
}

/** Human-readable blinded sheet (owner fills the ownerLabel column). */
function sheetMarkdown(sk: SheetAndKey, presetLabel: string): string {
  const lines: string[] = [];
  lines.push(
    `# Q7-AXIS direction-reading sheet — ${presetLabel} (${sk.preset})`,
  );
  lines.push("");
  lines.push(
    "BLINDED sheet. For each edge, open the preset canvas, find the connection " +
      "between the two named endpoints in the given region, and record which way " +
      "it reads as flowing. Do NOT open the sealed key until every row is filled.",
  );
  lines.push("");
  lines.push(`Proposition (per row): ${sk.proposition}`);
  lines.push("");
  lines.push(
    "| # | endpoint A | endpoint B | canvas region | your read (A->B / B->A / ambiguous) |",
  );
  lines.push(
    "| - | ---------- | ---------- | ------------- | ----------------------------------- |",
  );
  for (const r of sk.sheet) {
    lines.push(
      `| ${r.index} | ${r.endpointA} | ${r.endpointB} | ${r.hint.midpointRegion} |  |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ── build ────────────────────────────────────────────────────────────────────

async function buildArmI(
  sources: TerraformImportPresetSources,
): Promise<ExcalidrawElement[]> {
  clearTerraformImportPrepCache();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: [...sources.planDotBundles],
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: [...sources.tfdLabels],
    },
    { semanticLayout: false, ...ARM_I },
  );
  return (body.elements ?? []) as ExcalidrawElement[];
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("Q7-AXIS blinded sheet + sealed key generator (report-emitting; asserts structure only)", () => {
  it(
    "emits 20-edge cross-hull sheets + keys for P1 and P2 (deterministic)",
    async () => {
      const softFailures: string[] = [];
      mkdirSync(REPORT_DIR, { recursive: true });

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );
        const elements = await buildArmI(sources);
        expect(
          elements.length,
          `${presetLabel} scene non-empty`,
        ).toBeGreaterThan(0);

        const first = buildSheetAndKey(preset, elements);
        const again = buildSheetAndKey(preset, elements);

        // Determinism: generate twice, deep-equal.
        expect(
          JSON.stringify(again),
          `${presetLabel} generator not deterministic`,
        ).toEqual(JSON.stringify(first));

        // Preflight: ≥20 eligible unique cross-hull edges — fail loudly, no pad.
        expect(
          first.eligibleUniqueCount,
          `${presetLabel}: only ${first.eligibleUniqueCount} eligible unique cross-hull edges (<${SAMPLE_N}); generator must not pad`,
        ).toBeGreaterThanOrEqual(SAMPLE_N);

        // Exactly 20 sampled rows in sheet + key.
        expect(first.sheet.length, `${presetLabel} sheet row count`).toBe(
          SAMPLE_N,
        );
        expect(first.key.length, `${presetLabel} key row count`).toBe(SAMPLE_N);

        // Blinding: sheet rows carry NO source/target roles, x-coords, or proxy.
        const forbidden = [
          "source",
          "target",
          "sourceAddress",
          "targetAddress",
          "declaredSourceSlot",
          "machineSourceLeftOfTarget",
          "cx",
          "x",
        ];
        for (const r of first.sheet) {
          const keys = new Set(Object.keys(r));
          for (const f of forbidden) {
            if (keys.has(f)) {
              softFailures.push(
                `${presetLabel}: sheet row ${r.index} leaks "${f}"`,
              );
            }
          }
          if (r.ownerLabel !== "") {
            softFailures.push(
              `${presetLabel}: sheet row ${r.index} ownerLabel not blank`,
            );
          }
          if (r.proposition !== PROPOSITION) {
            softFailures.push(
              `${presetLabel}: sheet row ${r.index} proposition drift`,
            );
          }
          if (!r.endpointA || !r.endpointB) {
            softFailures.push(
              `${presetLabel}: sheet row ${r.index} missing an endpoint name`,
            );
          }
        }

        // Key integrity + sheet-frame mapping consistency.
        const indices = new Set<number>();
        for (const e of first.key) {
          indices.add(e.index);
          if (e.declaredSourceSlot !== "A" && e.declaredSourceSlot !== "B") {
            softFailures.push(
              `${presetLabel}: key ${e.index} bad declaredSourceSlot`,
            );
          }
          // The slot the key calls the declared source MUST hold sourceAddress.
          const declaredAddr =
            e.declaredSourceSlot === "A"
              ? e.endpointAAddress
              : e.endpointBAddress;
          if (declaredAddr !== e.sourceAddress) {
            softFailures.push(
              `${presetLabel}: key ${e.index} declaredSourceSlot maps to "${declaredAddr}" not source "${e.sourceAddress}"`,
            );
          }
          if (
            e.canonicalEdgeKey !==
            canonicalEdgeKey(e.sourceAddress, e.targetAddress)
          ) {
            softFailures.push(
              `${presetLabel}: key ${e.index} canonicalEdgeKey mismatch`,
            );
          }
          if (e.deepestHullSourceId === e.deepestHullTargetId) {
            softFailures.push(
              `${presetLabel}: key ${e.index} not cross-hull (equal deepest hulls)`,
            );
          }
          if (
            e.machineSourceLeftOfTarget !== null &&
            typeof e.machineSourceLeftOfTarget !== "boolean"
          ) {
            softFailures.push(`${presetLabel}: key ${e.index} bad proxy value`);
          }
        }
        if (indices.size !== SAMPLE_N) {
          softFailures.push(
            `${presetLabel}: key indices not unique 1..${SAMPLE_N}`,
          );
        }

        // Emit artifacts.
        writeFileSync(
          `${REPORT_DIR}/Q7_AXIS_SHEET_${presetLabel}.json`,
          JSON.stringify(
            {
              preset: first.preset,
              seed: first.seed,
              proposition: first.proposition,
              rows: first.sheet,
            },
            null,
            2,
          ),
        );
        writeFileSync(
          `${REPORT_DIR}/Q7_AXIS_SHEET_${presetLabel}.md`,
          sheetMarkdown(first, presetLabel),
        );
        writeFileSync(
          `${REPORT_DIR}/Q7_AXIS_KEY_${presetLabel}.json`,
          JSON.stringify(
            {
              preset: first.preset,
              seed: first.seed,
              proposition: first.proposition,
              eligibleUniqueCount: first.eligibleUniqueCount,
              entries: first.key,
            },
            null,
            2,
          ),
        );
        // eslint-disable-next-line no-console -- artifact emission IS the deliverable
        console.log(
          `Q7-AXIS ${presetLabel}: ${first.eligibleUniqueCount} eligible unique cross-hull edges; sheet+key written to ${REPORT_DIR}`,
        );
      }

      expect(
        softFailures,
        `harness structure failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
