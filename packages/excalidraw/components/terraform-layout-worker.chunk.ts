/**
 * Web Worker entry for Terraform layout jobs (semantic AWS / semantic provider).
 * Loaded as a separate chunk via `import.meta.url` (see subset-worker.chunk.ts).
 */
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import {
  runSemanticAwsLayoutJob,
  runSemanticProviderLayoutJob,
} from "./terraformLayoutSemanticParallel";

import type {
  TerraformLayoutWorkerRequest,
  TerraformLayoutWorkerResponse,
} from "./terraformLayoutWorkerTypes";

export const WorkerUrl: URL | undefined = import.meta.url
  ? new URL(import.meta.url)
  : undefined;

/**
 * Worker-side dispatch for a single layout request → response envelope. Extracted
 * from the `self.onmessage` handler below so vitest can exercise the real
 * worker-side dispatch + success/error response channel directly (jsdom defines
 * `window`, so the `onmessage` guard never installs the handler in tests — W14 F2).
 */
export async function runTerraformLayoutWorkerRequest(
  request: TerraformLayoutWorkerRequest,
): Promise<TerraformLayoutWorkerResponse> {
  const { id, job } = request;
  try {
    let result;
    switch (job.type) {
      case "semanticAws":
        result = await runSemanticAwsLayoutJob(job.prep);
        break;
      case "semanticProvider":
        result = await runSemanticProviderLayoutJob(
          job.family,
          job.label,
          job.changes,
          job.nodes,
          job.plan,
        );
        break;
      case "pipelineFull":
        result = {
          type: "pipelineFull" as const,
          result: await layoutTerraformFromSources(job.sources, job.options),
        };
        break;
      default:
        throw new Error(`Unknown layout worker job type`);
    }
    return { id, ok: true, result };
  } catch (err) {
    return {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

if (typeof window === "undefined" && typeof self !== "undefined") {
  self.onmessage = async (
    event: MessageEvent<TerraformLayoutWorkerRequest>,
  ) => {
    self.postMessage(await runTerraformLayoutWorkerRequest(event.data));
  };
}
