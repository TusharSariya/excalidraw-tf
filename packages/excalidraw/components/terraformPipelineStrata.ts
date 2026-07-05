import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import { buildStrataScene } from "./terraformPipelineStrataSceneBuild";

import type { StrataDegradedMeta } from "./terraformPipelineStrataTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type { TerraformImportWarning } from "./terraformImportMerge";

export type TerraformStrataSceneOptions = {
  compact?: boolean;
  includeAncillary?: boolean;
  /** OD-1 (M1b): X-axis network-simplex rank refinement (A1). Threaded at S0a;
   * consumed by `rankStrataClusters`. Default off. */
  strataNetworkSimplexRank?: boolean;
  /** OD-2 (M1b): directional sweep count for the A2 ordering pass. Threaded at
   * S0a; consumed by `placeStrataHulls`. Default 0 (M1a "model-order bands"). */
  strataSweeps?: number;
  /** A7 (M1b): slice-A coordinate refinement flag. Threaded at S0a and consumed
   * by `refineStrataCoordinates` (per-hull Y median/PAV nudge) between placement
   * and scene build. Default off (the T2+R4 gate decides the default). */
  strataCoordinateRefine?: boolean;
  /** A6 (OD-7): generation G for the deterministic finalize — element
   * `version` = G, versionNonce = FNV-1a(stableId + ":" + G). Default 1: no
   * caller-side source exists yet (the `sceneContext` literal in
   * terraformLayoutCore does not thread a per-import counter, and plan JSON
   * carries no state serial) — the app-side per-scene regeneration counter is
   * the S7/M3 follow-up. The finalize/tombstone machinery is fully
   * G-parameterized and tested with G>1 regardless. Echoed in scene meta as
   * `strataGeneration` (the apply layer's tombstone pass reads the echo). */
  strataGeneration?: number;
  /** Dev-only failure-contract seam: force the named engine stage to throw so
   * the P11 fallback path is exercisable end-to-end from a test. Never set on
   * any production path. */
  __testForceStageError?: StrataDegradedMeta["stage"];
};

/**
 * Strata view — the rcll-v2 engine entry point (M1a) behind the §5 failure
 * contract.
 *
 * The engine runs its phases sequentially — model → A3 (cycle repair) → A1
 * (rank) → A0+A2 (placement) → scene build → structural check. On ANY stage
 * failure the entry point does NOT throw: it falls back to the v2 substrate
 * builder, reusing the prep it already computed (v3.1 §5 — otherwise every
 * failure silently re-pays the ~20s skeleton build), and surfaces the failure
 * as `rcllV2Degraded: { stage, reason }` in scene meta (the honest-meta
 * surfacing; T9 asserts this key is ABSENT on success).
 *
 * `preparePipelineLayout` is invoked with the SAME shape the v2 builder uses
 * internally (`(nodes, plan, compact)`, no NS option — A1's network-simplex is
 * a separate, engine-owned rank refinement), so the prep handed to the fallback
 * is a byte-valid substitute for what the v2 builder would have built itself. A
 * prep throw (e.g. the CON-10 .tfd gate) is intentionally NOT caught — it is the
 * same HTTP-400 every pipeline variant raises, and the v2 fallback would only
 * re-throw it; degenerate-input coverage is a loud-failure contract.
 *
 * Ancillary is deferred at M1 (the engine path is extraction-free): when
 * `includeAncillary` is requested the engine builds WITHOUT ancillary and echoes
 * `strataAncillaryDeferred: true` (honest-meta, SDEC-26/29). `strataCoordinate-
 * Refine` (A7) runs the per-hull Y refinement between placement and scene build
 * when set; its meta echo is kept regardless. Default off.
 */
export async function buildTerraformStrataExcalidrawScene(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  options?: TerraformStrataSceneOptions,
): Promise<{
  elements: ExcalidrawElement[];
  meta: Record<string, unknown>;
  warnings: TerraformImportWarning[];
}> {
  const compact = options?.compact !== false;
  const includeAncillary = options?.includeAncillary === true;
  const strataNetworkSimplexRank = options?.strataNetworkSimplexRank === true;
  const strataSweeps = options?.strataSweeps ?? 0;
  const strataCoordinateRefine = options?.strataCoordinateRefine === true;
  const strataGeneration = options?.strataGeneration ?? 1;
  const forceStage = options?.__testForceStageError;

  // The engine flag/input echoes + the honest ancillary-deferred marker,
  // merged into BOTH the success and the degraded meta. `strataGeneration` is
  // an input echo like the flags; on the DEGRADED path the fallback v2 scene
  // carries no canonical strata ids, so the apply layer's tombstone pass
  // (which gates on canonical ids, not on this echo) stays inert.
  const flagMeta: Record<string, unknown> = {
    strataNetworkSimplexRank,
    strataSweeps,
    strataCoordinateRefine,
    strataGeneration,
    ...(includeAncillary ? { strataAncillaryDeferred: true } : {}),
  };

  // Build prep ONCE — same invocation shape as the v2 builder's internal call so
  // the fallback prep is a valid substitute. A prep throw propagates (see header).
  const prep = preparePipelineLayout(nodes, plan, compact);

  const engineOptions = {
    compact,
    // M1 is extraction-free: never thread ancillary into the engine — it is
    // echoed as deferred, not silently ignored.
    includeAncillary: false,
    networkSimplexRank: strataNetworkSimplexRank,
    sweeps: strataSweeps,
    coordinateRefine: strataCoordinateRefine,
  };

  // Small dev seam so a test can force any stage to throw.
  const gate = (stage: StrataDegradedMeta["stage"]): void => {
    if (forceStage === stage) {
      throw new Error(`__testForceStageError: forced failure at "${stage}"`);
    }
  };

  let stage: StrataDegradedMeta["stage"] = "model";
  try {
    gate("model");
    const model = buildStrataModel(prep, engineOptions);

    stage = "a3";
    gate("a3");
    const repair = repairStrataCycles(model.edges, model.addressOf);

    stage = "a1";
    gate("a1");
    const rank = rankStrataClusters([...model.clusters.keys()], repair, {
      networkSimplexRank: engineOptions.networkSimplexRank,
      // OD-6 / D10 #5: unit width is the frame's TRUE local rect width (what
      // placement uses), NOT build.width.
      unitWidthOf: (id) => {
        const cluster = model.clusters.get(id);
        return cluster ? clusterFrameLocalRect(cluster).width : 0;
      },
    });

    // A0 compound placement + A2 ordering (both inside placeStrataHulls).
    // Attribution contract (codex W2 P2): the forced-error hook gets an honest
    // per-stage tag, and a real throw from the ordering pass self-identifies
    // by its "Strata A2" message prefix — every throw WP-3a adds to the
    // ordering module MUST use that prefix or it will be misattributed to a0.
    stage = "a2";
    gate("a2");
    stage = "a0";
    gate("a0");
    let placement: ReturnType<typeof placeStrataHulls>;
    try {
      placement = placeStrataHulls(
        model,
        repair.edgesPrime,
        rank,
        engineOptions,
      );
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Strata A2")) {
        stage = "a2";
      }
      throw err;
    }

    // A7 coordinate refinement (M1b, flag-gated). Transforms the placement in
    // place of nothing when OFF (byte-identical to A0). Every throw it raises
    // self-identifies with the "Strata A7" message prefix — re-tagged in the
    // outer catch (mirror of the "Strata A2"/"Strata A6" contracts), and the
    // R2 dev-assert inside the pass makes a re-anchor violation degrade honestly.
    stage = "a7";
    gate("a7");
    if (engineOptions.coordinateRefine) {
      placement = refineStrataCoordinates(placement, model, repair.edgesPrime);
    }

    stage = "scene-build";
    gate("scene-build");
    const scene = await buildStrataScene({
      prep,
      model,
      placement,
      nodes,
      generation: strataGeneration,
    });

    // Standing R2 invariant (S0b acceptance): any nonzero count is a failure.
    stage = "structural-check";
    gate("structural-check");
    const structure = checkStrataStructure(placement, model);
    if (
      structure.nonAncestorOverlaps > 0 ||
      structure.titleCollisions > 0 ||
      structure.contiguityViolations > 0
    ) {
      throw new Error(`structural check failed: ${JSON.stringify(structure)}`);
    }

    return {
      elements: scene.elements,
      meta: {
        layoutEngine: "pipeline",
        pipelineVariant: "strata",
        pipelineLayoutVariant: "strata",
        pipelineCompact: compact,
        pipelineClusterCount: prep.clusters.length,
        pipelineEdgeCount: model.edges.length,
        pipelineSelfLoopCount: model.selfLoops.length,
        pipelineColumnCount: rank.columnX.length,
        pipelineTopologyFrameEdgeCount: scene.frameEdgeCount,
        strataNetworkSimplexApplied: rank.networkSimplexApplied,
        ...(rank.nsSkipReason
          ? { strataNetworkSimplexSkipReason: rank.nsSkipReason }
          : {}),
        // R2 evidence (all-zero on the success path).
        strataStructural: structure,
        ...flagMeta,
      },
      // NOT the legacy pipelineCycleWarnings (codex W2 P2): its message claims
      // ordering "fell back to first .tfd occurrence", which is false here —
      // A3 repairs cycles structurally (GreedyFAS) and no file-order fallback
      // exists in this engine. Warn accurately, and only when a cycle existed.
      warnings:
        repair.feedbackKeys.size > 0
          ? [
              {
                code: "pipeline_cycle" as const,
                message: `Strata view repaired ${repair.feedbackKeys.size} dependency cycle edge(s) structurally (GreedyFAS); the affected arrow(s) are drawn against the flow direction.`,
              },
            ]
          : [],
    };
  } catch (err) {
    // A7 attribution contract (mirror of "Strata A2"): the coordinate refinement
    // + its R2 dev-assert run under stage "a7" and self-identify with the
    // "Strata A7" message prefix, so a re-anchor violation is tagged honestly.
    if (err instanceof Error && err.message.startsWith("Strata A7")) {
      stage = "a7";
    }
    // A6 attribution contract (mirror of the "Strata A2" prefix above): the
    // finalize runs inside buildStrataScene (stage "scene-build"), and every
    // throw it raises self-identifies with the "Strata A6" message prefix.
    if (err instanceof Error && err.message.startsWith("Strata A6")) {
      stage = "finalize";
    }
    const reason = err instanceof Error ? err.message : String(err);
    // Dev surfacing — the meta IS the contract, but a warn helps local debug.
    // eslint-disable-next-line no-console
    console.warn(`[strata] engine degraded at stage "${stage}": ${reason}`);

    // §5 fallback: reuse the prep already built (never re-pay the skeleton build).
    const fallback = await buildTerraformPipelineV2ExcalidrawScene(
      nodes,
      plan,
      { compact, includeAncillary, prep },
    );
    return {
      elements: fallback.elements,
      meta: {
        ...fallback.meta,
        pipelineLayoutVariant: "strata",
        ...flagMeta,
        rcllV2Degraded: { stage, reason },
      },
      warnings: fallback.warnings,
    };
  }
}
