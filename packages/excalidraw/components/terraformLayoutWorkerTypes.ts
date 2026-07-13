import type { ExcalidrawElement } from "@excalidraw/element/types";

import type {
  LayoutTerraformResult,
  TerraformLayoutOptions,
  TerraformPlanParsingSources,
} from "./terraformLayoutCore";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type { TerraformProviderFamily } from "./terraformProviderClassification";

export type TerraformLayoutProgress = {
  phase: string;
  done: number;
  total: number;
};

export type TerraformLayoutWorkerJob =
  | {
      type: "semanticAws";
      prep: SemanticAwsLayoutPrep;
    }
  | {
      type: "semanticProvider";
      family: TerraformProviderFamily;
      label: string;
      changes: unknown[];
      nodes: TerraformPlanNodesMap;
      plan: unknown;
    }
  | {
      // W14 lever B: run the WHOLE pipeline/strata build off the main thread.
      // `sources` (plan JSON text etc.) and `options` are plain, structured-
      // cloneable objects; the result scene is plain elements. This does not
      // parallelize the build — it just unblocks the main thread.
      type: "pipelineFull";
      sources: TerraformPlanParsingSources;
      options: TerraformLayoutOptions;
    };

export type SemanticAwsLayoutPrep = {
  topoModel: unknown;
  zones: unknown[];
  regionalBuckets: unknown[];
  nodes: TerraformPlanNodesMap;
  awsPlan: unknown;
  vpcEndpointBuckets: unknown[];
  routeTableBottomPlacements: unknown;
  vpcDefaultPlumbingBuckets: unknown[];
  vpcFlowLogBuckets: unknown[];
  endpointSecurityGroupBuckets: unknown[];
  natZonePlacements: unknown;
  interfaceVpcEndpointZonePlacements: unknown;
  deferDecorations?: boolean;
};

export type TerraformLayoutWorkerJobResult =
  | {
      type: "semanticAws";
      elements: ExcalidrawElement[];
      meta: Record<string, unknown>;
      files?: Record<string, unknown>;
    }
  | {
      type: "semanticProvider";
      family: TerraformProviderFamily;
      elements: ExcalidrawElement[];
    }
  | {
      // Carries the full LayoutTerraformResult (ok/scene or ok:false/error) so
      // the client can apply `toScenePayload` exactly as the sequential path
      // does — a layout validation failure (result.ok:false) surfaces as a
      // thrown Error via that helper, not via the worker `response.ok:false`
      // channel (which is reserved for thrown exceptions inside the worker).
      type: "pipelineFull";
      result: LayoutTerraformResult;
    };

export type TerraformLayoutWorkerRequest = {
  id: number;
  job: TerraformLayoutWorkerJob;
};

export type TerraformLayoutWorkerResponse =
  | { id: number; ok: true; result: TerraformLayoutWorkerJobResult }
  | { id: number; ok: false; error: string };

export type LayoutViaWorkersOptions = {
  onProgress?: (progress: TerraformLayoutProgress) => void;
  signal?: AbortSignal;
};

export type { TerraformPlanParsingSources, TerraformLayoutOptions };
