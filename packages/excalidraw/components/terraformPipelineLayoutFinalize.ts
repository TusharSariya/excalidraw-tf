import { convertToExcalidrawElements } from "@excalidraw/element";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  buildTerraformDeclaredDataFlowLineSkeletons,
  mirrorAndDetachTerraformResourceLabels,
  type TerraformDependencyLayoutBox,
} from "./terraformElkLayout";
import { collectDeclaredDataFlowEdges } from "./terraformExplodeGraph";
import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { reorderTopologyElementsZStack } from "./terraformTopologyLayout";
import {
  getTerraformEdgeLayer,
  reconcileTerraformVisibility,
  repairTerraformEdgeBindings,
  TERRAFORM_IMPORT_EDGE_LAYER_PINS,
} from "./terraformVisibility";

import { injectTerraformAwsIconsIntoElements } from "./terraformAwsIcons";
import { detectEdgeCollapse } from "./terraformEdgeCollapse";
import {
  isTerraformEdgeTripwireEnabled,
  tripwireRecordFinalizeSummary,
} from "./terraformEdgeTripwire";

import type { TerraformEdgeRepairStats } from "./terraformVisibility";

import type { CollapsedPipelineEdge } from "./terraformPipelineLayoutShared";

import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type { TerraformImportWarning } from "./terraformImportMerge";

export function pipelineCycleWarnings(depthResult: {
  hasCycle: boolean;
}): TerraformImportWarning[] {
  return depthResult.hasCycle
    ? [
        {
          code: "pipeline_cycle",
          message:
            "Pipeline view detected a cycle after collapsing .tfd endpoints; order fell back to first .tfd occurrence.",
        } as TerraformImportWarning,
      ]
    : [];
}

export function appendPipelineEdgeSkeletons(
  nodes: TerraformPlanNodesMap,
  collapsedEdges: CollapsedPipelineEdge[],
  skeleton: ExcalidrawElementSkeleton[],
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>,
): void {
  const pipelineNodes = { ...nodes } as TerraformPlanNodesMap;
  pipelineNodes[DECLARED_DATAFLOW_ORDERED_KEY] = collapsedEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    sequence: edge.sequence,
    origin: "tfd",
  }));
  const originalBySequence = new Map(
    collapsedEdges.map((edge) => [edge.sequence, edge.original]),
  );
  skeleton.push(
    ...buildTerraformDeclaredDataFlowLineSkeletons(
      pipelineNodes,
      Object.fromEntries(layoutBoxes.entries()),
      collectDeclaredDataFlowEdges(pipelineNodes),
      new Set(),
      { terraformSemanticOverview: true },
    ).map((line) => ({
      ...line,
      customData: {
        ...(line.customData ?? {}),
        terraformPipelineView: true,
        relationship: {
          ...((line.customData as { relationship?: Record<string, unknown> })
            ?.relationship ?? {}),
          ...(() => {
            const sequence = (
              line.customData as {
                relationship?: { sequence?: unknown };
              }
            )?.relationship?.sequence;
            const original =
              typeof sequence === "number"
                ? originalBySequence.get(sequence)
                : undefined;
            return original
              ? {
                  terraformPipelineOriginalSource: original.source,
                  terraformPipelineOriginalTarget: original.target,
                  terraformPipelineOriginalSequence: original.sequence,
                }
              : {};
          })(),
        },
      },
    })),
  );
}

export async function convertPipelineSkeletonToElements(
  skeleton: ExcalidrawElementSkeleton[],
  // M3 telemetry: an optional accumulator the internal `repairTerraformEdgeBindings`
  // call forwards to, so a caller (the Strata engine) can observe how many styled
  // routed polylines repair kept vs flattened. Omitting it is byte-identical to
  // before — repair does no extra work and returns the same elements.
  repairStats?: TerraformEdgeRepairStats,
): Promise<ExcalidrawElement[]> {
  let elements = convertToExcalidrawElements(skeleton, {
    regenerateIds: true,
  }) as ExcalidrawElement[];
  elements = mirrorAndDetachTerraformResourceLabels(elements);
  elements = await injectTerraformAwsIconsIntoElements(elements);
  elements = reconcileTerraformVisibility(
    repairTerraformEdgeBindings(elements, repairStats),
    {
      pins: TERRAFORM_IMPORT_EDGE_LAYER_PINS,
      hoverPeekKey: null,
    },
  );
  elements = reorderTopologyElementsZStack(elements);

  // TRIPWIRE (c) — scene-finalize census (owner Q11, LOG-ONLY). Emit how many
  // declared edges left spanning visible geometry vs how many were declared, so
  // a process-level collapse is logged with the numbers. Gated OFF by default
  // (zero overhead in prod); observes only — the returned scene is unchanged.
  if (isTerraformEdgeTripwireEnabled()) {
    let declaredEdgeCount = 0;
    for (const element of elements) {
      if (!getTerraformEdgeLayer(element)) {
        continue;
      }
      const relationship = (
        element.customData as
          | { relationship?: { source?: unknown; target?: unknown } }
          | undefined
      )?.relationship;
      if (
        typeof relationship?.source === "string" &&
        typeof relationship?.target === "string"
      ) {
        declaredEdgeCount += 1;
      }
    }
    const stats = detectEdgeCollapse(elements, declaredEdgeCount);
    tripwireRecordFinalizeSummary({
      declaredEdgeCount: stats.declaredEdgeCount,
      spanningVisibleLinearCount: stats.spanningVisibleLinearCount,
      edgeSpanningFraction: stats.edgeSpanningFraction,
      edgeCollapseDetected: stats.edgeCollapseDetected,
    });
  }

  return elements;
}

export async function finalizePipelineScene(
  nodes: TerraformPlanNodesMap,
  collapsedEdges: CollapsedPipelineEdge[],
  skeleton: ExcalidrawElementSkeleton[],
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>,
  meta: Record<string, unknown>,
  depthResult: { hasCycle: boolean },
): Promise<{
  elements: ExcalidrawElement[];
  meta: Record<string, unknown>;
  warnings: TerraformImportWarning[];
}> {
  appendPipelineEdgeSkeletons(nodes, collapsedEdges, skeleton, layoutBoxes);
  const elements = await convertPipelineSkeletonToElements(skeleton);
  return {
    elements,
    meta,
    warnings: pipelineCycleWarnings(depthResult),
  };
}
