import {
  isTerraformImportProfilerEnabled,
  terraformImportProfilerRecord,
} from "./terraformImportProfiler";

import type { TerraformImportPreset } from "./terraformImportPresetsTypes";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const API_BASE = "/api/terraform-import-presets";

/**
 * Perf-loop E06b: measurement-only attribution for the profiler-blind ~3.9s
 * nav→planParsed preload window. Records into the import profiler aggregate
 * (`window.__terraformImportProfilerSummary`) AND emits a nav-relative
 * `[terraform:…]` console marker (captured by benchmark-import-time.mjs) so the
 * preset-sources download and the ~24MB `response.json()` parse are attributable
 * on the client timeline. Fully gated behind `isTerraformImportProfilerEnabled()`
 * — zero cost (a single cached boolean read) when the profiler is off, so it
 * never runs on a prod hot path.
 */
function recordPreloadSpan(name: string, durationMs: number): void {
  terraformImportProfilerRecord(name, durationMs);
  const rounded = Math.round(durationMs * 100) / 100;
  // eslint-disable-next-line no-console -- profiler-gated dev import-timing marker
  console.log(`[terraform:${name}]`, `${rounded}ms`);
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // ignore parse errors
  }
  return `Request failed (${response.status})`;
}

export async function fetchTerraformImportPresetsFromApi(): Promise<
  TerraformImportPreset[]
> {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { presets?: TerraformImportPreset[] };
  return Array.isArray(body.presets) ? body.presets : [];
}

export async function createTerraformImportPresetViaApi(
  preset: TerraformImportPreset,
): Promise<TerraformImportPreset> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { preset: TerraformImportPreset };
  return body.preset;
}

export async function updateTerraformImportPresetViaApi(
  presetId: string,
  preset: TerraformImportPreset,
): Promise<TerraformImportPreset> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(presetId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { preset: TerraformImportPreset };
  return body.preset;
}

export async function deleteTerraformImportPresetViaApi(
  presetId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(presetId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

export async function fetchTerraformImportPresetSourcesFromApi(
  presetId: string,
): Promise<TerraformImportPresetSources> {
  const profile = isTerraformImportProfilerEnabled();
  const fetchStart = profile ? performance.now() : 0;
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(presetId)}/sources`,
  );
  if (profile) {
    recordPreloadSpan("preload.fetch.sources", performance.now() - fetchStart);
  }
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const parseStart = profile ? performance.now() : 0;
  const body = (await response.json()) as {
    sources?: TerraformImportPresetSources;
  };
  if (profile) {
    recordPreloadSpan("preload.parse.json", performance.now() - parseStart);
  }
  if (!body.sources) {
    throw new Error("Preset sources response was empty.");
  }
  return body.sources;
}

export async function fetchTerraformImportPresetFromApi(
  presetId: string,
  options: { includeContent?: boolean } = {},
): Promise<TerraformImportPreset> {
  const query = options.includeContent ? "?includeContent=1" : "";
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(presetId)}${query}`,
  );
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { preset: TerraformImportPreset };
  return body.preset;
}

export async function syncTerraformImportPresetFromDiskViaApi(
  presetId: string,
): Promise<TerraformImportPreset> {
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(presetId)}/sync-from-disk`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { preset: TerraformImportPreset };
  return body.preset;
}

const ARTIFACT_API_BASE = "/api/terraform-import-artifacts";
const COMPOSITION_API_BASE = "/api/terraform-import-compositions";

export async function fetchTerraformImportArtifactsFromApi(): Promise<
  import("./terraformImportPresetsTypes").TerraformImportArtifact[]
> {
  const response = await fetch(ARTIFACT_API_BASE);
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as {
    artifacts?: import("./terraformImportPresetsTypes").TerraformImportArtifact[];
  };
  return Array.isArray(body.artifacts) ? body.artifacts : [];
}

export async function saveTerraformImportArtifactViaApi(
  artifact: import("./terraformImportPresetsTypes").TerraformImportArtifact & {
    content: string;
  },
): Promise<import("./terraformImportPresetsTypes").TerraformImportArtifact> {
  const response = await fetch(ARTIFACT_API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as {
    artifact: import("./terraformImportPresetsTypes").TerraformImportArtifact;
  };
  return body.artifact;
}

export async function saveTerraformImportCompositionViaApi(
  composition: import("./terraformImportPresetsTypes").TerraformImportComposition,
): Promise<import("./terraformImportPresetsTypes").TerraformImportComposition> {
  const response = await fetch(COMPOSITION_API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ composition }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as {
    composition: import("./terraformImportPresetsTypes").TerraformImportComposition;
  };
  return body.composition;
}

export async function fetchTerraformImportCompositionSourcesFromApi(
  compositionId: string,
): Promise<TerraformImportPresetSources> {
  const response = await fetch(
    `${COMPOSITION_API_BASE}/${encodeURIComponent(compositionId)}/sources`,
  );
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as {
    sources?: TerraformImportPresetSources;
  };
  if (!body.sources) {
    throw new Error("Composition sources response was empty.");
  }
  return body.sources;
}
