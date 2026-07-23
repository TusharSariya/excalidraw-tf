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

/**
 * W14 F4 — worker-offload fallback observability (dev/profiler + WP4 trace only).
 * Counts each time a layout job that was *meant* to run on a worker instead ran on
 * the main thread, tagged by why (mirrors the WP2 scan-stats pattern in
 * terraformPlanParsing.tsx):
 *   - `disabled`: workers were off (env kill-switch / prior downgrade) at dispatch.
 *   - `poolFailure`: the worker URL / pool itself was unavailable
 *     (WorkerUrlNotDefinedError / WorkerInTheMainChunkError).
 *   - `cloneError`: postMessage structured-clone of the job/response failed
 *     (DataCloneError).
 *   - `workerError`: any other error surfaced from the worker path.
 * Pure integer increments — no logging, no allocation. Read/reset via the exported
 * helpers for tests and the W14 WP4 browser trace.
 */
export type TerraformLayoutWorkerFallbackReason =
  | "disabled"
  | "poolFailure"
  | "cloneError"
  | "workerError";

const terraformLayoutWorkerFallbackCounts: Record<
  TerraformLayoutWorkerFallbackReason,
  number
> = { disabled: 0, poolFailure: 0, cloneError: 0, workerError: 0 };

export function getTerraformLayoutWorkerFallbackStats(): Record<
  TerraformLayoutWorkerFallbackReason,
  number
> {
  return { ...terraformLayoutWorkerFallbackCounts };
}

export function resetTerraformLayoutWorkerFallbackStats(): void {
  terraformLayoutWorkerFallbackCounts.disabled = 0;
  terraformLayoutWorkerFallbackCounts.poolFailure = 0;
  terraformLayoutWorkerFallbackCounts.cloneError = 0;
  terraformLayoutWorkerFallbackCounts.workerError = 0;
}

function classifyWorkerFallbackReason(
  err: unknown,
): TerraformLayoutWorkerFallbackReason {
  if (
    err instanceof WorkerUrlNotDefinedError ||
    err instanceof WorkerInTheMainChunkError
  ) {
    return "poolFailure";
  }
  if (err instanceof Error && err.name === "DataCloneError") {
    return "cloneError";
  }
  return "workerError";
}

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
    terraformLayoutWorkerFallbackCounts.disabled += 1;
    return runJobOnMainThread(job);
  }
  try {
    return await runPoolJob(job, signal);
  } catch (err) {
    terraformLayoutWorkerFallbackCounts[classifyWorkerFallbackReason(err)] += 1;
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
  // Pipeline family — must match the authoritative predicate in
  // terraformLayoutCore.ts (`strata`). W14 F1: `strata` was missing here, so a
  // strata import fell through to `runSequential` and never reached the
  // pipelineFull worker offload (lever B) — it ran on the main thread.
  const pipelineLayout = layoutMode === "strata";

  const runSequential = async () => {
    const result = await layoutTerraformFromSources(sources, options);
    return toScenePayload(result);
  };

  if (!shouldUseTerraformLayoutWorkers || typeof Worker === "undefined") {
    return runSequential();
  }

  const runJob = (job: TerraformLayoutWorkerJob) =>
    runJobWithFallback(job, signal);

  // W14 F5: the pipelineFull job result is converted to a scene payload OUTSIDE
  // the infra try/catch below. A layout-level `{ ok:false }` is a deterministic
  // validation outcome — it must surface as a thrown status error WITHOUT the
  // outer catch re-running the whole build via `runSequential` (which would
  // execute an invalid import twice and repeat artifactLoader side effects). Only
  // genuine infrastructure errors (pool / postMessage / chunk) reach the catch.
  let pipelineJobResult: TerraformLayoutWorkerJobResult | null = null;

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
      // falls back to `runJobOnMainThread`.
      // TODO(onProgress): the single-job request/response protocol carries no
      // progress channel, so `onProgress` is not wired for pipelineFull yet.
      pipelineJobResult = await runJob({
        type: "pipelineFull",
        sources,
        options,
      });
    } else {
      return runSequential();
    }
  } catch (err) {
    if (
      err instanceof WorkerUrlNotDefinedError ||
      err instanceof WorkerInTheMainChunkError
    ) {
      shouldUseTerraformLayoutWorkers = false;
      terraformLayoutWorkerFallbackCounts.poolFailure += 1;
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    // Non-abort infra error surfaced from the worker path — count the sequential
    // rerun (poolFailure already counted above; avoid double-counting it).
    if (
      !(err instanceof WorkerUrlNotDefinedError) &&
      !(err instanceof WorkerInTheMainChunkError)
    ) {
      terraformLayoutWorkerFallbackCounts.workerError += 1;
    }
    return runSequential();
  }

  // Layout-level conversion (W14 F5) — outside the infra fallback path, so an
  // `{ ok:false }` throws to the caller instead of triggering a second build.
  if (!pipelineJobResult || pipelineJobResult.type !== "pipelineFull") {
    return runSequential();
  }
  return toScenePayload(pipelineJobResult.result);
}
