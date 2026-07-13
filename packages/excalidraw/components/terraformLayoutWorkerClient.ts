import { promiseTry } from "@excalidraw/common";

import { WorkerInTheMainChunkError, WorkerUrlNotDefinedError } from "../errors";
import { WorkerPool } from "../workers";

import {
  layoutTerraformFromSources,
  type LayoutTerraformResult,
  type TerraformLayoutOptions,
  type TerraformPlanParsingSources,
} from "./terraformLayoutCore";
import { layoutSemanticViewParallel } from "./terraformLayoutSemanticParallel";

import type { TerraformExcalidrawScenePayload } from "./terraformSceneApply";
import type {
  LayoutViaWorkersOptions,
  TerraformLayoutWorkerJob,
  TerraformLayoutWorkerJobResult,
  TerraformLayoutWorkerRequest,
  TerraformLayoutWorkerResponse,
} from "./terraformLayoutWorkerTypes";

const defaultUseTerraformLayoutWorkers =
  typeof Worker !== "undefined" &&
  import.meta.env.VITE_TERRAFORM_LAYOUT_WORKERS !== "false";

let shouldUseTerraformLayoutWorkers = defaultUseTerraformLayoutWorkers;

/** Vitest / tooling: override worker usage (null restores env default). */
export function setTerraformLayoutWorkersEnabledForTests(
  value: boolean | null,
): void {
  shouldUseTerraformLayoutWorkers =
    value === null ? defaultUseTerraformLayoutWorkers : value;
}

let layoutWorkerPool: Promise<
  WorkerPool<TerraformLayoutWorkerRequest, TerraformLayoutWorkerResponse>
> | null = null;

let nextJobId = 1;

async function getLayoutWorkerPool() {
  if (!layoutWorkerPool) {
    layoutWorkerPool = promiseTry(async () => {
      const { WorkerUrl } = await import("./terraform-layout-worker.chunk");
      return WorkerPool.create<
        TerraformLayoutWorkerRequest,
        TerraformLayoutWorkerResponse
      >(WorkerUrl, { ttl: 60_000 });
    });
  }
  return layoutWorkerPool;
}

async function runPoolJob(
  job: TerraformLayoutWorkerJob,
  signal?: AbortSignal,
): Promise<TerraformLayoutWorkerJobResult> {
  if (signal?.aborted) {
    throw new DOMException("Layout aborted", "AbortError");
  }
  const pool = await getLayoutWorkerPool();
  const id = nextJobId++;
  const response = await pool.postMessage({ id, job }, {});
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.result;
}

async function runJobOnMainThread(
  job: TerraformLayoutWorkerJob,
): Promise<TerraformLayoutWorkerJobResult> {
  const { runSemanticAwsLayoutJob, runSemanticProviderLayoutJob } =
    await import("./terraformLayoutSemanticParallel");

  switch (job.type) {
    case "semanticAws":
      return runSemanticAwsLayoutJob(job.prep);
    case "semanticProvider":
      return runSemanticProviderLayoutJob(
        job.family,
        job.label,
        job.changes,
        job.nodes,
        job.plan,
      );
    case "pipelineFull":
      // No-worker / test path (and the pool-failure fallback): run the whole
      // pipeline/strata build on the main thread. `layoutTerraformFromSources`
      // is already imported statically at the top of this module.
      return {
        type: "pipelineFull",
        result: await layoutTerraformFromSources(job.sources, job.options),
      };
    default:
      throw new Error("Unknown layout job");
  }
}

async function runJobWithFallback(
  job: TerraformLayoutWorkerJob,
  signal?: AbortSignal,
): Promise<TerraformLayoutWorkerJobResult> {
  if (!shouldUseTerraformLayoutWorkers) {
    return runJobOnMainThread(job);
  }
  try {
    return await runPoolJob(job, signal);
  } catch {
    return runJobOnMainThread(job);
  }
}

function toScenePayload(
  result: LayoutTerraformResult,
): TerraformExcalidrawScenePayload {
  if (!result.ok) {
    const err = new Error(result.error);
    (err as Error & { status?: number }).status = result.status ?? 400;
    throw err;
  }
  return result.scene as TerraformExcalidrawScenePayload;
}

export function isTerraformLayoutWorkersEnabled(): boolean {
  return shouldUseTerraformLayoutWorkers;
}

export async function layoutTerraformViaWorkers(
  sources: TerraformPlanParsingSources,
  options: TerraformLayoutOptions,
  workerOptions: LayoutViaWorkersOptions = {},
): Promise<TerraformExcalidrawScenePayload> {
  const { onProgress, signal } = workerOptions;
  const layoutMode =
    options.layoutMode ??
    (options.semanticLayout === true ? "semantic" : "module");
  const semanticLayout = layoutMode === "semantic";
  const pipelineLayout = layoutMode === "pipeline" || layoutMode === "rcll";

  const runSequential = async () => {
    const result = await layoutTerraformFromSources(sources, options);
    return toScenePayload(result);
  };

  if (!shouldUseTerraformLayoutWorkers || typeof Worker === "undefined") {
    return runSequential();
  }

  const runJob = (job: TerraformLayoutWorkerJob) =>
    runJobWithFallback(job, signal);

  try {
    if (semanticLayout) {
      const result = await layoutSemanticViewParallel(
        sources,
        options,
        runJob,
        onProgress,
      );
      return toScenePayload(result);
    }

    if (pipelineLayout) {
      // W14 lever B: post the whole build as a single `pipelineFull` job so it
      // leaves the main thread (unblocking, not parallelizing). `runJob` =
      // `runJobWithFallback`, so a missing worker URL / pool failure transparently
      // falls back to `runJobOnMainThread`. The outer catch below still re-runs
      // `runSequential()` on any surfaced error, and AbortError still rethrows —
      // exactly as before this branch existed.
      // TODO(onProgress): the single-job request/response protocol carries no
      // progress channel, so `onProgress` is not wired for pipelineFull yet.
      const jobResult = await runJob({ type: "pipelineFull", sources, options });
      if (jobResult.type !== "pipelineFull") {
        return runSequential();
      }
      return toScenePayload(jobResult.result);
    }

    return runSequential();
  } catch (err) {
    if (
      err instanceof WorkerUrlNotDefinedError ||
      err instanceof WorkerInTheMainChunkError
    ) {
      shouldUseTerraformLayoutWorkers = false;
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    return runSequential();
  }
}
