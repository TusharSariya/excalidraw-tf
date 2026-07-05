import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";

import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type { TerraformImportWarning } from "./terraformImportMerge";

export type TerraformStrataSceneOptions = {
  compact?: boolean;
  includeAncillary?: boolean;
  /** OD-1 (M1b): X-axis network-simplex rank refinement. Accepted + threaded at
   * S0a (URL → dialog → sceneContext → here → scene meta); unused until the
   * Strata engine lands (M1). Default off. */
  strataNetworkSimplexRank?: boolean;
  /** OD-2 (M1b): directional sweep count for the A2 ordering pass. Accepted +
   * threaded at S0a; unused until the Strata engine lands (M1). Default 0
   * (M1a ships K=0 "model-order bands"; M1b turns on K=4). */
  strataSweeps?: number;
  /** A7 (M1b): slice-A coordinate refinement flag. Accepted + threaded at S0a;
   * unused until the Strata engine lands (M1). Default off. */
  strataCoordinateRefine?: boolean;
};

/**
 * Strata view — S0a passthrough entry point.
 *
 * The rcll-v2 engine (docs/strata-view-implementation-flow.md §3) lands across
 * milestones W2/W3 (P0-P11). At S0a the engine does not exist yet: this
 * delegates verbatim to the v2 builder (same inputs — same `compact` /
 * `includeAncillary` options the v2 builder itself consumes) so `view=strata`
 * renders identically to v2 today, then merges the Strata identity plus the
 * three future engine flags (accepted-and-threaded-but-unused) into the
 * returned scene meta. This proves the end-to-end wiring (URL/dialog → the
 * `sceneContext` seam → this builder → the meta echo) before any
 * Strata-specific geometry exists — see the threading test
 * `terraformLayoutCoreStrataThreading.test.ts`.
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
  const v2Scene = await buildTerraformPipelineV2ExcalidrawScene(nodes, plan, {
    compact: options?.compact,
    includeAncillary: options?.includeAncillary,
  });

  return {
    ...v2Scene,
    meta: {
      ...v2Scene.meta,
      pipelineLayoutVariant: "strata",
      strataPassthrough: true,
      strataNetworkSimplexRank: options?.strataNetworkSimplexRank === true,
      strataSweeps: options?.strataSweeps ?? 0,
      strataCoordinateRefine: options?.strataCoordinateRefine === true,
    },
  };
}
