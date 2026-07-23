export type TerraformView = "module" | "semantic" | "strata";

/**
 * Internal layout mode. Same closed set as {@link TerraformView}; kept as a
 * named alias so view→mode plumbing reads clearly and can diverge later. Single
 * source of truth — annotate `layoutMode` with this instead of re-spelling the
 * union inline, so adding/removing a view is enforced by the compiler everywhere.
 */
export type TerraformLayoutMode = TerraformView;

/**
 * Surviving layout-engine variants after the Pipeline/RCLL views were removed:
 * `"v2"` (the shared substrate Strata builds on, still exercised by V2 tests and
 * echoed in Strata scene meta) and `"strata"` (the deterministic layered engine).
 * The removed `"classic"`/`"compound"`/`"rcll"` builders no longer exist.
 */
export type PipelineLayoutVariant = "v2" | "strata";

/** De-band depth (none → subnet → vpc → region → account → provider), re-exported
 * here so the dialog prop surface has one import home. Shared with Strata. */
export {
  DEBAND_LEVELS,
  type DeBandLevel,
} from "./terraformPipelineLayoutProfiles";

export const MAX_PLAN_BUNDLES = 10;

export type PlanDotBundleRow = {
  id: string;
  planFile: File | null;
  dotFile: File | null;
  label: string;
};

export const VIEW_OPTIONS: ReadonlyArray<{
  value: TerraformView;
  label: string;
  description: string;
}> = [
  {
    value: "semantic",
    label: "Semantic view",
    description:
      "AWS account, region, VPC, and subnet topology plus provider boxes for other clouds.",
  },
  {
    value: "strata",
    label: "Strata",
    description:
      "Next-gen layered compound layout (rcll-v2 spec) — deterministic, diff-stable, readability-gated.",
  },
  {
    value: "module",
    label: "Module view",
    description: "Module-framed infrastructure graph.",
  },
];

export const joinPresetPath = (rootPath: string, relativePath: string) =>
  `${rootPath.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;

export const toPresetId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const inferStackIdFromFileName = (
  name: string,
  fallbackIndex: number,
) => {
  const trimmed = name.trim();
  const noExt = trimmed.includes(".")
    ? trimmed.slice(0, trimmed.lastIndexOf("."))
    : trimmed;
  return toPresetId(noExt) || `stack-${fallbackIndex + 1}`;
};

export async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

let bundleRowCounter = 0;

export const newBundleRow = (): PlanDotBundleRow => ({
  id: `bundle-${++bundleRowCounter}`,
  planFile: null,
  dotFile: null,
  label: "",
});
