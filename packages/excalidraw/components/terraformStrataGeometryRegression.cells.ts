/**
 * W0-I4 — shared cell definitions + measurement for the Strata geometry
 * regression suite. Imported by both the full probe
 * (`terraformStrataGeometryRegression.probe.test.ts`) and the quick per-merge
 * tripwire (`terraformStrataGeometryRegression.test.ts`) so the two never drift
 * on WHAT they measure or HOW.
 *
 * This is a FREEZE harness: it captures the current (pre-overnight-change)
 * strata layout behavior into a committed baseline. Its value is not the first
 * (tautological) run — it is the first later merge that flips a hash it should
 * not have.
 *
 * Every geometry fingerprint routes through the shared, canonical
 * `strataGeometryHash` (terraformStrataGeometryHash.ts) — never a parallel
 * canonicalization. Decisions record RENDERED metrics (not chord proxies):
 * `diagnosePipelineScene(...).dataflow.crossings` and `computePierceMetrics`.
 * `pierce` is a denominator artifact under de-band, so `topoFrames` and
 * `piercePerTopoFrame` are recorded next to it (trap #3).
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import { strataGeometryHash } from "./terraformStrataGeometryHash";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

/** P2 = the frozen measurement preset (seed 20260704). P1 = closest small
 * bundle preset that exists in the committed DB (verified present). */
export const STRATA_REGRESSION_PRESETS = {
  P2: "staging-extended-localstack-v2",
  P1: "staging-localstack",
} as const;

export type StrataRegressionPresetKey = keyof typeof STRATA_REGRESSION_PRESETS;

/** Options merged over the strata engine base for one matrix column. */
export type StrataRegressionConfig = {
  /** Stable key — the baseline is addressed by `${presetKey}::${config.name}`. */
  name: string;
  /** One-line description of what this cell isolates. */
  note: string;
  /** Layout options merged over `{ layoutMode:"strata", pipelineCompact:true }`. */
  options: Record<string, unknown>;
  /** Marked slow — excluded from the default generation/assertion run unless
   * `STRATA_REGRESSION_SLOW=1`. Recorded as SKIPPED-SLOW in the baseline. */
  slow?: boolean;
};

// The full audit config (P2 canonical) minus the (very slow) vpc de-band.
const AUDIT_MINUS_DEBAND: Record<string, unknown> = {
  pipelineCompact: false,
  pipelineIncludeAncillary: true,
  pipelinePrivateApiRegional: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: true,
  strataPackedScoring: true,
  strataPackedScoringEpsilon: 1,
  strataBandDepth: "root",
  strataSiftRelocate: true,
  strataPackedConverge: true,
  strataTransitiveAdopt: true,
  strataBlockClamp: true,
  strataTranspose: true,
  strataHeightGate: true,
};

/**
 * The matrix columns. `strata-default` is the quick-subset tripwire cell (kept
 * cheap). Each major toggle is exercised solo on an otherwise-default engine;
 * the two audit rows and the vpc de-band are marked slow (packed-scoring
 * descent blowup — minutes) so the default run stays tractable while still
 * pinning them honestly in the baseline as SKIPPED-SLOW.
 */
export const STRATA_REGRESSION_CONFIGS: readonly StrataRegressionConfig[] = [
  {
    name: "strata-default",
    note: "bare strata engine (layoutMode strata + compact); quick-subset cell",
    options: {},
  },
  {
    name: "audit-minus-deband",
    note: "P2 canonical audit config without strataDeBandLevel",
    options: AUDIT_MINUS_DEBAND,
    slow: true,
  },
  {
    name: "audit-with-deband-vpc",
    note: "P2 canonical audit config incl. strataDeBandLevel=vpc (blowup risk)",
    options: { ...AUDIT_MINUS_DEBAND, strataDeBandLevel: "vpc" },
    slow: true,
  },
  {
    name: "deband-none",
    note: "de-band ladder rung: none (identity) on otherwise-default",
    options: { strataDeBandLevel: "none" },
  },
  {
    name: "deband-subnet",
    note: "de-band ladder rung: subnet on otherwise-default",
    options: { strataDeBandLevel: "subnet" },
  },
  {
    name: "rankSeparate",
    note: "OD-14 whole-model sibling-separation ranking, solo",
    options: { strataRankSeparate: true },
  },
  {
    name: "packedScoring",
    note: "SDEC-57 packed-hull candidate scoring, solo",
    options: { strataPackedScoring: true },
  },
  {
    name: "packedScoring-eps1",
    note: "packed scoring with W8b epsilon=1 crossings budget",
    options: { strataPackedScoring: true, strataPackedScoringEpsilon: 1 },
  },
  {
    name: "sift-packedScoring",
    note: "OD-15 relocate lever (rides with packed scoring)",
    options: { strataSiftRelocate: true, strataPackedScoring: true },
  },
  {
    name: "transpose-sweeps4",
    note: "P2 within-column transpose with K=4 sweeps",
    options: { strataTranspose: true, strataSweeps: 4 },
  },
  {
    name: "blockClamp",
    note: "P4 pure-sink account block clamp, solo",
    options: { strataBlockClamp: true },
  },
  {
    name: "heightGate",
    note: "P5 Lever-C height maintain-or-decrease gate, solo",
    options: { strataHeightGate: true },
  },
  {
    name: "bandDepth-root",
    note: "v3.2 band-depth cut = root on otherwise-default",
    options: { strataBandDepth: "root" },
  },
];

/** Roles that mark a topology hull frame (mirrors the private set in the pierce
 * / slice metrics modules — duplicated to stay import-additive). */
const TOPOLOGY_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const countTopoFrames = (elements: readonly ExcalidrawElement[]): number =>
  elements.filter(
    (el) =>
      el.type === "frame" &&
      !el.isDeleted &&
      TOPOLOGY_ROLES.has(
        typeof (
          el.customData as { terraformTopologyRole?: unknown } | undefined
        )?.terraformTopologyRole === "string"
          ? ((el.customData as { terraformTopologyRole?: string })
              .terraformTopologyRole as string)
          : "",
      ),
  ).length;

/** One frozen measurement cell. `ok:false` records a current failure verbatim —
 * a freeze test pins the behavior that exists, error or not. */
export type StrataRegressionMeasurement =
  | {
      ok: true;
      geometryHash: string;
      elementCount: number;
      renderedCrossings: number;
      pierce: number;
      topoFrames: number;
      piercePerTopoFrame: number;
    }
  | { ok: false; error: string };

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Preset-sources accessor, injected by the consuming test files. This module
 * is library-side, so it must not import `excalidraw-app` itself (arch rule
 * `no-excalidraw-app-in-terraform`; tests are exempt and own the DB import). */
export type StrataRegressionSourcesResolver = (
  presetId: string,
) => TerraformPlanParsingSources;

let sourcesResolver: StrataRegressionSourcesResolver | null = null;

export const setStrataRegressionSourcesResolver = (
  resolver: StrataRegressionSourcesResolver,
): void => {
  sourcesResolver = resolver;
};

const sourcesFor = (
  presetKey: StrataRegressionPresetKey,
): TerraformPlanParsingSources => {
  if (!sourcesResolver) {
    throw new Error(
      "strata regression cells: call setStrataRegressionSourcesResolver() before measuring",
    );
  }
  return sourcesResolver(STRATA_REGRESSION_PRESETS[presetKey]);
};

/**
 * Run one matrix cell end-to-end through the real app path
 * (`layoutTerraformFromSources`) and collect its frozen metrics. Clears the
 * session-global prep cache first (hermetic isolation — a sibling test's stale
 * enriched-placement entry would otherwise leak in).
 */
export const measureStrataRegressionCell = async (
  presetKey: StrataRegressionPresetKey,
  config: StrataRegressionConfig,
): Promise<StrataRegressionMeasurement> => {
  clearTerraformImportPrepCache();
  const result = await layoutTerraformFromSources(sourcesFor(presetKey), {
    layoutMode: "strata",
    pipelineCompact: true,
    ...config.options,
  });
  clearTerraformImportPrepCache();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const elements = result.scene.elements as ExcalidrawElement[];
  const live = elements.filter((el) => !el.isDeleted);
  const topoFrames = countTopoFrames(elements);
  const pierce = computePierceMetrics(elements).pierce.total;
  return {
    ok: true,
    geometryHash: strataGeometryHash(elements),
    elementCount: live.length,
    renderedCrossings: diagnosePipelineScene(elements).dataflow.crossings,
    pierce,
    topoFrames,
    piercePerTopoFrame: topoFrames > 0 ? round4(pierce / topoFrames) : 0,
  };
};

export const cellKey = (
  presetKey: StrataRegressionPresetKey,
  config: StrataRegressionConfig,
): string => `${presetKey}::${config.name}`;
