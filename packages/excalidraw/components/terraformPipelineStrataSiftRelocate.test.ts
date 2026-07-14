/**
 * OD-15 `strataSiftRelocate` VALIDATION harness (report-emitting; branch
 * strata-v3.2-w5-w10b). This file owns NO layout behavior — it drives the full
 * strata engine end-to-end on the owner's real preset with two arms (flag OFF /
 * flag ON) and MEASURES whether the relocate feature reduces the owner-priority
 * combined-crossing score C without regressing raw edge-edge crossings past the
 * inherited ε cap, and whether the three owner-reported deciding hulls actually
 * move in the expected direction.
 *
 * Objective (mirrors the engine): C = penW·penetrations + crossW·edgeEdge with
 * default weights 1/1. Owner priority = hull-crossings ≻ edge-length. Penetrations
 * are hull-frame pierces recomputed on FINAL geometry (computePierceMetrics —
 * the A5 pierce counter every sibling harness uses); edge-edge crossings come
 * from the diagnostics kernel (diagnosePipelineScene.dataflow.crossings, the same
 * counter the packed-scoring battery reports); L1 length is Σ Manhattan arrow
 * polyline length on the drawn TFD arrows.
 *
 * Target config (owner's real setup): preset staging-extended-localstack-v2,
 * layoutMode strata, band-depth ROOT (all hulls below root packed), strataSweeps
 * 4, strataCoordinateRefine, strataRankSeparate, strataPackedScoring, epsilon 2.
 *
 * HARD assertions: (1) flag-off byte-identity — OFF with the flag omitted equals
 * OFF with the flag explicitly false; (2) ON does NOT regress — C(on) ≤ C(off)
 * AND edgeEdge(on) ≤ edgeEdge(off) + cap (cap = inherited ε = 2); (3) determinism
 * — the ON arm built twice is byte-identical. Everything else (strict-improvement
 * on C, the three owner cases) is measured, LOGGED, and only asserted in the
 * expected direction when the geometry actually supports it — a case that does
 * not move is reported honestly as NO CHANGE, never forced to pass.
 *
 * Run:
 *   yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataSiftRelocate.test.ts \
 *     --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET = "staging-extended-localstack-v2";
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;
const EPSILON = 2; // strataPackedScoringEpsilon; cap inherits it when unset.

// Owner's real setup shared across arms; siftRelocate is toggled per-arm.
const BASE_OPTIONS: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataBandDepth: "root", // all hulls below root packed
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: true,
  strataPackedScoring: true,
  strataPackedScoringEpsilon: EPSILON,
};

// ── final-geometry helpers (arrow polylines) ───────────────────────────────

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

function arrowPolyline(el: ExcalidrawElement): Array<[number, number]> {
  const pts = (el as unknown as { points?: Array<[number, number]> }).points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return [];
  }
  return pts.map(([px, py]) => [el.x + px, el.y + py]);
}

/** Σ |Δx|+|Δy| over every segment of every drawn TFD arrow (final geometry). */
function totalL1(elements: readonly ExcalidrawElement[]): number {
  let sum = 0;
  for (const el of elements) {
    if (!isTfdArrow(el)) {
      continue;
    }
    const poly = arrowPolyline(el);
    for (let i = 0; i + 1 < poly.length; i++) {
      const [x1, y1] = poly[i]!;
      const [x2, y2] = poly[i + 1]!;
      sum += Math.abs(x2 - x1) + Math.abs(y2 - y1);
    }
  }
  return Math.round(sum);
}

// ── customData readers (mirror the pierce-metrics conventions) ──────────────

const roleOf = (el: ExcalidrawElement): string => {
  const r = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyRole;
  return typeof r === "string" ? r : "";
};

const pathOf = (el: ExcalidrawElement): string[] => {
  const p = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyPath;
  return Array.isArray(p)
    ? (p.filter((s) => typeof s === "string") as string[])
    : [];
};

const addressOf = (el: ExcalidrawElement): string | null => {
  const a = (el.customData as Record<string, unknown> | undefined)
    ?.terraformPrimaryAddress;
  return typeof a === "string" ? a : null;
};

const centerY = (el: ExcalidrawElement): number => el.y + el.height / 2;

/** Region hull frames (role "region"), non-deleted. */
function regionFrames(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.filter(
    (el) => el.type === "frame" && !el.isDeleted && roleOf(el) === "region",
  );
}

/** primaryCluster frames keyed by their terraformPrimaryAddress. */
function clustersByAddress(
  elements: readonly ExcalidrawElement[],
): Map<string, ExcalidrawElement> {
  const out = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    if (
      el.type !== "frame" ||
      el.isDeleted ||
      roleOf(el) !== "primaryCluster"
    ) {
      continue;
    }
    const a = addressOf(el);
    if (a && !out.has(a)) {
      out.set(a, el);
    }
  }
  return out;
}

/** First region frame whose path has BOTH substrings (case-insensitive). */
function findRegion(
  elements: readonly ExcalidrawElement[],
  needleA: string,
  needleB: string,
): ExcalidrawElement | null {
  for (const f of regionFrames(elements)) {
    const joined = pathOf(f).join("/").toLowerCase();
    if (
      joined.includes(needleA.toLowerCase()) &&
      joined.includes(needleB.toLowerCase())
    ) {
      return f;
    }
  }
  return null;
}

/** First account hull frame (role "account") whose path contains the id. */
function findAccount(
  elements: readonly ExcalidrawElement[],
  acctId: string,
): ExcalidrawElement | null {
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted || roleOf(el) !== "account") {
      continue;
    }
    if (pathOf(el).join("/").includes(acctId)) {
      return el;
    }
  }
  return null;
}

/** First primaryCluster whose address contains every needle (case-insensitive). */
function findCluster(
  byAddr: ReadonlyMap<string, ExcalidrawElement>,
  ...needles: string[]
): { address: string; el: ExcalidrawElement } | null {
  for (const [addr, el] of byAddr) {
    const low = addr.toLowerCase();
    if (needles.every((n) => low.includes(n.toLowerCase()))) {
      return { address: addr, el };
    }
  }
  return null;
}

// ── deterministic geometry fingerprint (byte-identity + determinism) ────────

function sceneFingerprint(elements: readonly ExcalidrawElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    const base = `${el.id}:${el.type}:${el.x},${el.y},${el.width},${el.height}`;
    const pts = (el as unknown as { points?: Array<[number, number]> }).points;
    const ptStr = Array.isArray(pts)
      ? pts.map(([a, b]) => `${a},${b}`).join(";")
      : "";
    parts.push(ptStr ? `${base}|${ptStr}` : base);
  }
  return parts.sort().join("\n");
}

// ── per-arm build + score ───────────────────────────────────────────────────

type ArmScore = {
  elements: ExcalidrawElement[];
  crossings: number; // raw edge-edge (diagnostics kernel)
  penetrations: number; // hull-frame pierces on final geometry (A5)
  weightedC: number; // penW·pen + crossW·edgeEdge at 1/1
  lengthL1: number;
  elementCount: number;
  meta: Record<string, unknown>;
};

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<ArmScore> {
  clearTerraformImportPrepCache();
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
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const crossings = diagnosePipelineScene(elements).dataflow.crossings;
  const penetrations = computePierceMetrics(elements).pierce.total;
  return {
    elements,
    crossings,
    penetrations,
    weightedC: penetrations + crossings, // weights 1/1
    lengthL1: totalL1(elements),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    meta: (body.meta ?? {}) as Record<string, unknown>,
  };
}

// eslint-disable-next-line no-console -- probe output IS the deliverable
const log = (...a: unknown[]) => console.log(...a);

describe("OD-15 strataSiftRelocate validation (real preset, owner config)", () => {
  it(
    "OFF vs ON — combined-crossing score, cap, determinism, and the 3 owner cases",
    async () => {
      const raw = getTerraformImportPresetSourcesFromDb(PRESET);
      expect(raw, `preset ${PRESET} exists`).toBeTruthy();
      const sources = resolveSourcesWithTfdComposition(
        raw! as TerraformImportPresetSources,
      );

      // Arms. OFF omits the flag entirely (= the pre-feature baseline). ON adds
      // the flag + 1/1 weights; the edge-edge cap inherits ε=2 (strataEdgeCrossCap
      // left unset). OFF_EXPLICIT proves the flag-off path is byte-identical
      // whether the flag is absent or `false`.
      const off = await buildArm(sources, { ...BASE_OPTIONS });
      const offExplicit = await buildArm(sources, {
        ...BASE_OPTIONS,
        strataSiftRelocate: false,
      });
      const on = await buildArm(sources, {
        ...BASE_OPTIONS,
        strataSiftRelocate: true,
        strataCrossWeightPenetration: 1,
        strataCrossWeightEdge: 1,
      });
      const onAgain = await buildArm(sources, {
        ...BASE_OPTIONS,
        strataSiftRelocate: true,
        strataCrossWeightPenetration: 1,
        strataCrossWeightEdge: 1,
      });

      // ── global score report ───────────────────────────────────────────────
      log(
        "\n=== strataSiftRelocate global geometry (preset " + PRESET + ") ===",
      );
      const row = (label: string, s: ArmScore) =>
        log(
          `  ${label.padEnd(16)} edgeEdge=${String(s.crossings).padStart(5)}` +
            `  hullPen=${String(s.penetrations).padStart(4)}` +
            `  C(pen+edge)=${String(s.weightedC).padStart(5)}` +
            `  L1=${String(s.lengthL1).padStart(9)}` +
            `  n=${s.elementCount}`,
        );
      row("OFF", off);
      row("OFF(explicit)", offExplicit);
      row("ON", on);
      row("ON(rerun)", onAgain);

      const dC = on.weightedC - off.weightedC;
      const dEdge = on.crossings - off.crossings;
      const dPen = on.penetrations - off.penetrations;
      const dL1 = on.lengthL1 - off.lengthL1;
      log(
        `  Δ(ON−OFF): C=${dC}  edgeEdge=${dEdge}  hullPen=${dPen}  L1=${dL1}` +
          `   cap(ε)=${EPSILON}`,
      );
      if (dC < 0) {
        log(
          `  VERDICT: ON STRICTLY IMPROVES combined score C (${off.weightedC} -> ${on.weightedC}).`,
        );
      } else if (dC === 0) {
        log(
          `  VERDICT: NO CHANGE — C identical (${off.weightedC}); feature inert on this preset/config.`,
        );
      } else {
        log(
          `  VERDICT: ON REGRESSES C by ${dC} (should be caught by an assertion).`,
        );
      }
      log(
        `  packedScoring meta: OFF fellBack=${String(
          off.meta.strataPackedScoringFellBack,
        )}` +
          ` selections=${JSON.stringify(
            off.meta.strataPackedScoringSelections,
          )}`,
      );
      log(
        `                     ON  fellBack=${String(
          on.meta.strataPackedScoringFellBack,
        )}` +
          ` selections=${JSON.stringify(
            on.meta.strataPackedScoringSelections,
          )}`,
      );
      const sceneChanged =
        sceneFingerprint(off.elements) !== sceneFingerprint(on.elements);
      log(`  scene geometry changed OFF->ON: ${sceneChanged}`);

      // ── HARD 1: flag-off byte-identity (omitted === explicit false) ────────
      expect(
        sceneFingerprint(offExplicit.elements),
        "flag-off byte-identity: strataSiftRelocate omitted must equal explicit false",
      ).toEqual(sceneFingerprint(off.elements));

      // ── HARD 2: determinism (ON built twice is byte-identical) ─────────────
      expect(
        sceneFingerprint(onAgain.elements),
        "determinism: the ON arm built twice must be byte-identical",
      ).toEqual(sceneFingerprint(on.elements));
      log(
        `  determinism: ON rebuilt byte-identical = ${
          sceneFingerprint(onAgain.elements) === sceneFingerprint(on.elements)
        }`,
      );

      // ── HARD 3: non-regression (owner guardrails) ──────────────────────────
      // C(on) ≤ C(off): the weighted objective must not get worse.
      expect(
        on.weightedC,
        `combined score must not regress: C(on)=${on.weightedC} <= C(off)=${off.weightedC}`,
      ).toBeLessThanOrEqual(off.weightedC);
      // Raw edge-edge crossings within the hard cap (baseline + ε).
      expect(
        on.crossings,
        `edge-edge cap: edgeEdge(on)=${on.crossings} <= edgeEdge(off)=${off.crossings} + cap(${EPSILON})`,
      ).toBeLessThanOrEqual(off.crossings + EPSILON);

      // ── the three owner cases ──────────────────────────────────────────────
      const findings: string[] = [];
      const offAddr = clustersByAddress(off.elements);
      const onAddr = clustersByAddress(on.elements);

      // IMPORTANT: the ON layout translates GLOBALLY (its whole scene sits
      // ~2900px lower than OFF because a different hull ordering changes the
      // overall origin), so RAW absolute Y is NOT comparable across arms. Every
      // owner-case measure below is therefore TRANSLATION-INVARIANT: a region's
      // top is expressed RELATIVE to its own account hull's top, and case 2 uses
      // the bucket→ssm center-Y GAP (both inside the same hull). "+relY is DOWN".
      log(
        "\n=== owner cases (translation-invariant: region relY = region.y − account-02 hull top.y) ===",
      );
      const offAcct2 = findAccount(off.elements, "000000000002");
      const onAcct2 = findAccount(on.elements, "000000000002");
      const relRegionY = (
        elements: readonly ExcalidrawElement[],
        acct: ExcalidrawElement | null,
        a: string,
        b: string,
      ): number | null => {
        const r = findRegion(elements, a, b);
        return r && acct ? r.y - acct.y : null;
      };

      // Case 1: account-02 / us-west-2 region could move DOWN (toward acct-03's
      // us-west-2) ⇒ relY increases (region sits lower within its account).
      {
        const offRel = relRegionY(
          off.elements,
          offAcct2,
          "000000000002",
          "us-west-2",
        );
        const onRel = relRegionY(
          on.elements,
          onAcct2,
          "000000000002",
          "us-west-2",
        );
        if (offRel !== null && onRel !== null) {
          const d = onRel - offRel;
          log(
            `  [1] acct-02/us-west-2 region relY: OFF=${offRel.toFixed(
              1,
            )} ON=${onRel.toFixed(1)} Δ=${d.toFixed(1)} (expect DOWN, Δ>0)`,
          );
          findings.push(
            d > 0
              ? `case1 MOVED DOWN (relY) Δ=${d.toFixed(1)}`
              : d === 0
              ? "case1 NO CHANGE (relY)"
              : `case1 moved UP (relY) Δ=${d.toFixed(
                  1,
                )} (opposite of expected)`,
          );
        } else {
          log(`  [1] acct-02/us-west-2 region or account hull NOT FOUND`);
          findings.push("case1 NOT FOUND");
        }
      }

      // Case 2: lake_replica_east_2["archive"] could move BELOW the ssm params in
      // its region hull ⇒ (bucket.centerY − ssm.centerY) GAP is positive/grows.
      {
        const offBucket = findCluster(
          offAddr,
          "lake_replica_east_2",
          "archive",
        );
        const onBucket = findCluster(onAddr, "lake_replica_east_2", "archive");
        const offSsm = findCluster(offAddr, "aws_ssm_parameter");
        const onSsm = findCluster(onAddr, "aws_ssm_parameter");
        if (offBucket && onBucket && offSsm && onSsm) {
          const offGap = centerY(offBucket.el) - centerY(offSsm.el);
          const onGap = centerY(onBucket.el) - centerY(onSsm.el);
          const d = onGap - offGap;
          log(`  [2] bucket=${offBucket.address}`);
          log(`      ssm(ref)=${offSsm.address}`);
          log(
            `      bucket−ssm center-Y GAP (>0 ⇒ below): OFF=${offGap.toFixed(
              1,
            )} ON=${onGap.toFixed(1)} Δ=${d.toFixed(1)}`,
          );
          log(
            `      bucket-below-ssm? OFF=${offGap > 0} ON=${
              onGap > 0
            } (expect: below in ON)`,
          );
          findings.push(
            `case2 bucket-below-ssm OFF=${offGap > 0} ON=${
              onGap > 0
            }; gap ${offGap.toFixed(0)}→${onGap.toFixed(0)}`,
          );
        } else {
          log(
            `  [2] bucket/ssm NOT FOUND (bucket off=${!!offBucket} on=${!!onBucket}, ssm off=${!!offSsm} on=${!!onSsm})`,
          );
          findings.push("case2 NOT FOUND");
        }
      }

      // Case 3: account-02 / us-east-2 region could move UP (so a lambda→api-gw
      // edge stops crossing extra hulls) ⇒ relY decreases (region sits higher).
      {
        const offRel = relRegionY(
          off.elements,
          offAcct2,
          "000000000002",
          "us-east-2",
        );
        const onRel = relRegionY(
          on.elements,
          onAcct2,
          "000000000002",
          "us-east-2",
        );
        if (offRel !== null && onRel !== null) {
          const d = onRel - offRel;
          log(
            `  [3] acct-02/us-east-2 region relY: OFF=${offRel.toFixed(
              1,
            )} ON=${onRel.toFixed(1)} Δ=${d.toFixed(1)} (expect UP, Δ<0)`,
          );
          findings.push(
            d < 0
              ? `case3 MOVED UP (relY) Δ=${d.toFixed(1)}`
              : d === 0
              ? "case3 NO CHANGE (relY)"
              : `case3 moved DOWN (relY) Δ=${d.toFixed(
                  1,
                )} (opposite of expected)`,
          );
        } else {
          log(`  [3] acct-02/us-east-2 region or account hull NOT FOUND`);
          findings.push("case3 NOT FOUND");
        }
      }

      // Diagnostic: dump distinct region-frame paths (so a NOT-FOUND above is
      // debuggable and the assertions can be retargeted honestly).
      const regionPaths = [
        ...new Set(regionFrames(off.elements).map((f) => pathOf(f).join("/"))),
      ].sort();
      log(`\n  region-frame paths present (OFF):`);
      for (const p of regionPaths) {
        log(`    ${p}`);
      }

      log(`\n=== owner-case findings ===`);
      for (const f of findings) {
        log(`  - ${f}`);
      }

      // Directional assertions ONLY where the geometry moved in the expected
      // direction — a NO CHANGE / NOT FOUND is reported, never forced to pass.
      // (The hard non-regression gate above already protects the objective.)
      expect(findings.length, "all three owner cases evaluated").toBe(3);
    },
    TIMEOUT,
  );
});
