import {
  isDeBandLevel,
  isRcllLayoutProfile,
  type DeBandLevel,
  type RcllLayoutProfile,
} from "./terraformPipelineLayoutProfiles";

import {
  TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS,
  type TerraformRuntimePerformanceSettings,
} from "./terraformRuntimePerformance";

import type {
  PipelineLayoutVariant,
  TerraformView,
} from "./terraformImportDialogUtils";
import type { ModulePackingMode } from "./terraformModuleLayoutOptions";
import type { TerraformLodPreset } from "./terraformLod";
import { isValidTerraformFocusHopCount } from "./terraformRelationshipFocus";

import type { TerraformFocusDirection } from "./terraformRelationshipFocus";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";

/** Edge-layer visibility pins (mirrors `AppState["terraformEdgeLayerPins"]`). */
export type TerraformEdgeLayerPins = {
  dependency: boolean;
  dataFlow: boolean;
  declaredDataFlow: boolean;
  networking: boolean;
  topologyFrameFlow: boolean;
};

/** Stable short codes for each edge layer in the `layers=` param (order = emit order). */
const EDGE_LAYER_CODES: ReadonlyArray<[keyof TerraformEdgeLayerPins, string]> =
  [
    ["dependency", "dep"],
    ["networking", "net"],
    ["dataFlow", "dataflow"],
    ["declaredDataFlow", "declared"],
    ["topologyFrameFlow", "topo"],
  ];

/** The boolean experiment keys of {@link TerraformRuntimePerformanceSettings} (excludes the
 * numeric `lowZoomThreshold`), so `settings[key] = true` stays type-correct. */
type TerraformPerfBooleanKey =
  | "hideAwsIconGlyphsBelowZoom"
  | "suppressHoverFocusBelowZoom"
  | "debounceHoverFocus"
  | "suppressFrameClippingBelowZoom"
  | "skipBindingRepairDuringFocus";

/** Short codes for each boolean canvas-performance experiment in the `canvasPerf=` param. */
const RUNTIME_PERF_CODES: ReadonlyArray<[TerraformPerfBooleanKey, string]> = [
  ["hideAwsIconGlyphsBelowZoom", "hideicons"],
  ["suppressHoverFocusBelowZoom", "nohover"],
  ["debounceHoverFocus", "debouncehover"],
  ["suppressFrameClippingBelowZoom", "noclip"],
  ["skipBindingRepairDuringFocus", "nobindrepair"],
];

const VALID_LOD_PRESETS = new Set<TerraformLodPreset>([
  "performance",
  "balanced",
  "detailed",
]);

/** The 6 `StrataHullRole` cuts the band-depth slider accepts, exact-case
 * (mixed-case `subnetZone`, so — unlike the other lowercase-normalized
 * enums here — the raw param is NOT lowercased before the membership check). */
const VALID_STRATA_BAND_DEPTHS = new Set<StrataHullRole>([
  "root",
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

export type TerraformDemoUrlParams = {
  presetId: string;
  view?: TerraformView;
  pack?: ModulePackingMode;
  compact?: boolean;
  pipelineVariant?: PipelineLayoutVariant;
  packed?: boolean;
  packedPullLeft?: boolean;
  ancillary?: boolean;
  /** Opt-in: private VPC-endpoint-bound REST APIs placed at region level. */
  privateApiRegional?: boolean;
  semanticPlace?: boolean;
  /** Accepts the clear alias `laneRise` as well as the milestone name `swimlaneRise`. */
  swimlaneRise?: boolean;
  reorder?: boolean;
  /** RCLL M6c: container-aware crossing minimization (hierarchical superset of reorder). */
  crossingMin?: boolean;
  /** RCLL de-band depth: `none | subnet | vpc | region | account | provider`. */
  deBandLevel?: DeBandLevel;
  /** Back-compat alias for `deBandLevel=subnet` (the original subnet-only probe). */
  subnetDeBand?: boolean;
  /** Accepts the clear alias `laneSplit` as well as the milestone name `rankSeparate`. */
  rankSeparate?: boolean;
  straighten?: boolean;
  /** RCLL M5b: coordinated per-column permutation re-pack (refines straighten, within band). */
  coordRepack?: boolean;
  deDensify?: boolean;
  /** RCLL "Column packing" tri-state: `spread` (M5b) / `none` / `compact` (M5c). */
  columnPacking?: "spread" | "none" | "compact" | "shorten";
  /** RCLL "Layout" profile — `readable | balanced | compact` (outcome-first preset). */
  profile?: RcllLayoutProfile;
  /** RCLL DEC-1 cycle-band rise; default on — only `=0` (false) is meaningful.
   * Accepts the clear alias `cycleRise` as well as the milestone name. */
  staircaseBandOverlap?: boolean;

  // ─── Strata (rcll-v2) engine flags — S0a: accepted + threaded, unused until the
  // engine lands (M1). All opt-in, default off/0. ───
  /** OD-1: X-axis network-simplex rank refinement. */
  strataNsRank?: boolean;
  /** OD-2: directional sweep count for A2 ordering (M1a ships 0; M1b turns on 4). */
  strataSweeps?: number;
  /** A7: slice-A coordinate refinement. */
  strataCoordRefine?: boolean;
  /** OD-14: whole-model sibling-separation ranking (the height lever). */
  strataRankSeparate?: boolean;
  /** Round 9 (SDEC-57): packed-hull whole-layout candidate scoring. */
  strataPackedScoring?: boolean;
  /** W8b: ε-constraint crossings budget for the packed scorer (`strataPackedEps`;
   * 0 = strict rule; 0<ε<1 = relative mode). */
  strataPackedEps?: number;
  /** Package C spike (W9): post-A7 obstacle-avoiding edge routing
   * (`strataEdgeRouting=1/0`). Default off. */
  strataEdgeRouting?: boolean;
  /** W10 (SDEC-63): banded row-share compaction lever
   * (`strataBandCompact=1/0`). Default off; primarily effective with
   * rankSeparate. LEGACY ALIAS for `strataBandDepth: "root"` — kept for old
   * share links; explicit `strataBandDepth` always wins. */
  strataBandCompact?: boolean;
  /** v3.2 band-depth slider: the deepest role still banded (`root | provider |
   * account | region | vpc | subnetZone`). Default `"account"` (today's fixed
   * role→policy map, byte-identical). */
  strataBandDepth?: StrataHullRole;
  /** OD-15 crossings-≻-length relocate lever (`strataSift=1/0`). Default off. */
  strataSift?: boolean;
  /** Relocate objective weight on penetrations (`strataPenW`). Default 1. */
  strataPenW?: number;
  /** Relocate objective weight on edge-edge crossings (`strataCrossW`). Default 1. */
  strataCrossW?: number;
  /** Edge-edge regression cap (`strataEdgeCap`). Optional — absent inherits
   * `strataPackedEps`. */
  strataEdgeCap?: number;

  // ─── Runtime canvas view settings (applied after import, not layout inputs) ───
  /** Zoom LOD master switch (`lodEnabled=1/0`). */
  lodEnabled?: boolean;
  /** LOD detail preset (`lodPreset=performance|balanced|detailed`). */
  lodPreset?: TerraformLodPreset;
  /** Overview minimap visibility (`minimap=1/0`). */
  minimap?: boolean;
  /** Edge-layer visibility pins (`layers=dep,net,…` or `layers=none`). */
  edgeLayerPins?: TerraformEdgeLayerPins;
  /** Dev canvas-performance experiments (`canvasPerf=…` + `canvasPerfZoom=…`). */
  runtimePerformance?: TerraformRuntimePerformanceSettings;
  /**
   * Relationship-focus traversal direction (W11 WP1). `focusdir=deps|dependents`;
   * omitted (or `"both"`) is the legacy undirected default and is never emitted.
   */
  focusDirection?: TerraformFocusDirection;
  /**
   * Relationship-focus hop-cap override. `Infinity` (`focushops=all`, menu
   * "Unlimited") or a finite non-negative safe-integer cap (`focushops=2`;
   * 0 = focused node only — W13 WP1; W11 F5: API-set finite caps must
   * survive sharing); omitted = legacy default
   * (3 hops). `JSON.stringify(Infinity) === null`, so Infinity never
   * round-trips through JSON — only through this URL param and the in-memory
   * options object (AppState stores the `-1` sentinel instead).
   */
  focusMaxHops?: number;
};

const VALID_COLUMN_PACKING = new Set<"spread" | "none" | "compact" | "shorten">(
  ["spread", "none", "compact", "shorten"],
);

const PRESET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VALID_VIEWS = new Set<TerraformView>([
  "module",
  "semantic",
  "pipeline",
  "rcll",
  "strata",
]);
const VALID_PIPELINE_VARIANTS = new Set<PipelineLayoutVariant>([
  "classic",
  "compound",
  "v2",
]);
const VALID_PACK_MODES = new Set<ModulePackingMode>([
  "default",
  "box",
  "rectpacking",
]);

export const isDemoPathname = (pathname: string): boolean =>
  pathname === "/demo" || pathname === "/demo/";

export const normalizePresetIdParam = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !PRESET_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
};

export const parseTerraformDemoUrlParams = (
  search: string,
): TerraformDemoUrlParams | null => {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const presetRaw = params.get("preset");
  if (!presetRaw) {
    return null;
  }

  const presetId = normalizePresetIdParam(presetRaw);
  if (!presetId) {
    return null;
  }

  const viewRaw = params.get("view");
  let view: TerraformView | undefined;
  if (viewRaw != null && viewRaw.trim() !== "") {
    const normalizedView = viewRaw.trim().toLowerCase() as TerraformView;
    if (!VALID_VIEWS.has(normalizedView)) {
      return null;
    }
    view = normalizedView;
  }

  const packRaw = params.get("pack");
  let pack: ModulePackingMode | undefined;
  if (packRaw != null && packRaw.trim() !== "") {
    const normalizedPack = packRaw.trim().toLowerCase() as ModulePackingMode;
    if (!VALID_PACK_MODES.has(normalizedPack)) {
      return null;
    }
    pack = normalizedPack;
  }

  const pipelineVariantRaw = params.get("pipelineVariant");
  let pipelineVariant: PipelineLayoutVariant | undefined;
  if (pipelineVariantRaw != null && pipelineVariantRaw.trim() !== "") {
    const normalized = pipelineVariantRaw
      .trim()
      .toLowerCase() as PipelineLayoutVariant;
    if (!VALID_PIPELINE_VARIANTS.has(normalized)) {
      return null;
    }
    pipelineVariant = normalized;
  }

  const parseBooleanParam = (name: string): boolean | undefined | null => {
    const raw = params.get(name);
    if (raw == null || raw.trim() === "") {
      return undefined;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
    return null;
  };

  // Milestone params accept a clearer alias (matching the menu vocabulary) as well as
  // the legacy name. The first param that is present wins; an invalid value hard-fails.
  const parseBooleanAlias = (
    ...names: string[]
  ): boolean | undefined | null => {
    for (const name of names) {
      const value = parseBooleanParam(name);
      if (value === null) {
        return null;
      }
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };

  let packed = parseBooleanParam("packed");
  if (packed === null) {
    return null;
  }
  const packedPullLeft = parseBooleanParam("packedPullLeft");
  if (packedPullLeft === null) {
    return null;
  }
  // Pull-left only exists within packed mode, so the param implies it.
  if (packedPullLeft === true && packed !== false) {
    packed = true;
  }
  const compact = parseBooleanParam("compact");
  if (compact === null) {
    return null;
  }
  const ancillary = parseBooleanParam("ancillary");
  if (ancillary === null) {
    return null;
  }
  const privateApiRegional = parseBooleanParam("privateApiRegional");
  if (privateApiRegional === null) {
    return null;
  }
  const semanticPlace = parseBooleanParam("semanticPlace");
  if (semanticPlace === null) {
    return null;
  }
  const swimlaneRise = parseBooleanAlias("laneRise", "swimlaneRise");
  if (swimlaneRise === null) {
    return null;
  }
  const reorder = parseBooleanParam("reorder");
  if (reorder === null) {
    return null;
  }
  const crossingMin = parseBooleanParam("crossingMin");
  if (crossingMin === null) {
    return null;
  }
  const subnetDeBand = parseBooleanParam("subnetDeBand");
  if (subnetDeBand === null) {
    return null;
  }
  // De-band depth enum. Hard-fail on an invalid value (same contract as columnPacking).
  // Back-compat: a legacy `subnetDeBand=1` (no explicit level) ⇒ `subnet`.
  const deBandLevelRaw = params.get("deBandLevel");
  let deBandLevel: DeBandLevel | undefined;
  if (deBandLevelRaw != null && deBandLevelRaw.trim() !== "") {
    const normalized = deBandLevelRaw.trim().toLowerCase();
    if (!isDeBandLevel(normalized)) {
      return null;
    }
    deBandLevel = normalized;
  } else if (subnetDeBand === true) {
    deBandLevel = "subnet";
  }
  const rankSeparate = parseBooleanAlias("laneSplit", "rankSeparate");
  if (rankSeparate === null) {
    return null;
  }
  const straighten = parseBooleanParam("straighten");
  if (straighten === null) {
    return null;
  }
  const coordRepack = parseBooleanParam("coordRepack");
  if (coordRepack === null) {
    return null;
  }
  const deDensify = parseBooleanParam("deDensify");
  if (deDensify === null) {
    return null;
  }
  // "Column packing" tri-state. Hard-fail on an invalid value (same contract as the
  // booleans). Back-compat: a legacy `deDensify=1` (no explicit packing) ⇒ `spread`.
  const columnPackingRaw = params.get("columnPacking");
  let columnPacking: "spread" | "none" | "compact" | "shorten" | undefined;
  if (columnPackingRaw != null && columnPackingRaw.trim() !== "") {
    const normalized = columnPackingRaw.trim().toLowerCase() as
      | "spread"
      | "none"
      | "compact"
      | "shorten";
    if (!VALID_COLUMN_PACKING.has(normalized)) {
      return null;
    }
    columnPacking = normalized;
  } else if (deDensify === true) {
    columnPacking = "spread";
  }
  const staircaseBandOverlap = parseBooleanAlias(
    "cycleRise",
    "staircaseBandOverlap",
  );
  if (staircaseBandOverlap === null) {
    return null;
  }

  // "Layout" profile enum. Hard-fail on an invalid value (same contract as columnPacking).
  const profileRaw = params.get("profile");
  let profile: RcllLayoutProfile | undefined;
  if (profileRaw != null && profileRaw.trim() !== "") {
    const normalized = profileRaw.trim().toLowerCase();
    if (!isRcllLayoutProfile(normalized)) {
      return null;
    }
    profile = normalized;
  }

  // Strata (rcll-v2) engine flags — S0a: accepted + threaded, unused until the
  // engine lands (M1). Hard-fail on an invalid value (same contract as the rest).
  const strataNsRank = parseBooleanParam("strataNsRank");
  if (strataNsRank === null) {
    return null;
  }
  const strataSweepsRaw = params.get("strataSweeps");
  let strataSweeps: number | undefined;
  if (strataSweepsRaw != null && strataSweepsRaw.trim() !== "") {
    const parsed = Number(strataSweepsRaw.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    strataSweeps = parsed;
  }
  const strataCoordRefine = parseBooleanParam("strataCoordRefine");
  if (strataCoordRefine === null) {
    return null;
  }
  const strataRankSeparate = parseBooleanParam("strataRankSep");
  if (strataRankSeparate === null) {
    return null;
  }
  const strataPackedScoring = parseBooleanParam("strataPackedScoring");
  if (strataPackedScoring === null) {
    return null;
  }
  // W8b ε budget: nonnegative finite number (fractional = relative mode).
  const strataEdgeRouting = parseBooleanParam("strataEdgeRouting");
  if (strataEdgeRouting === null) {
    return null;
  }
  const strataBandCompact = parseBooleanParam("strataBandCompact");
  if (strataBandCompact === null) {
    return null;
  }
  // Band-depth cut enum. Hard-fail on an invalid value (same contract as the
  // rest). Exact-case membership check (NOT lowercased — `subnetZone` is
  // mixed-case, unlike every other enum parsed here).
  const strataBandDepthRaw = params.get("strataBandDepth");
  let strataBandDepth: StrataHullRole | undefined;
  if (strataBandDepthRaw != null && strataBandDepthRaw.trim() !== "") {
    const normalized = strataBandDepthRaw.trim() as StrataHullRole;
    if (!VALID_STRATA_BAND_DEPTHS.has(normalized)) {
      return null;
    }
    strataBandDepth = normalized;
  }
  const strataPackedEpsRaw = params.get("strataPackedEps");
  let strataPackedEps: number | undefined;
  if (strataPackedEpsRaw != null && strataPackedEpsRaw.trim() !== "") {
    const parsed = Number(strataPackedEpsRaw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    // Absolute mode (>= 1) is an integer crossings budget; a fractional
    // value there (e.g. 1.5) violates the contract, so reject it. Relative
    // mode (0 < eps < 1) stays fractional.
    if (parsed >= 1 && !Number.isInteger(parsed)) {
      return null;
    }
    strataPackedEps = parsed;
  }
  const strataSift = parseBooleanParam("strataSift");
  if (strataSift === null) {
    return null;
  }
  const strataPenWRaw = params.get("strataPenW");
  let strataPenW: number | undefined;
  if (strataPenWRaw != null && strataPenWRaw.trim() !== "") {
    const parsed = Number(strataPenWRaw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    strataPenW = parsed;
  }
  const strataCrossWRaw = params.get("strataCrossW");
  let strataCrossW: number | undefined;
  if (strataCrossWRaw != null && strataCrossWRaw.trim() !== "") {
    const parsed = Number(strataCrossWRaw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    strataCrossW = parsed;
  }
  const strataEdgeCapRaw = params.get("strataEdgeCap");
  let strataEdgeCap: number | undefined;
  if (strataEdgeCapRaw != null && strataEdgeCapRaw.trim() !== "") {
    const parsed = Number(strataEdgeCapRaw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    strataEdgeCap = parsed;
  }

  // ─── Runtime canvas view settings ───
  const lodEnabled = parseBooleanParam("lodEnabled");
  if (lodEnabled === null) {
    return null;
  }
  const lodPresetRaw = params.get("lodPreset");
  let lodPreset: TerraformLodPreset | undefined;
  if (lodPresetRaw != null && lodPresetRaw.trim() !== "") {
    const normalized = lodPresetRaw.trim().toLowerCase() as TerraformLodPreset;
    if (!VALID_LOD_PRESETS.has(normalized)) {
      return null;
    }
    lodPreset = normalized;
  }
  const minimap = parseBooleanParam("minimap");
  if (minimap === null) {
    return null;
  }

  // `layers=dep,net,…` (or `none`) → the full pins object (unlisted layers = hidden).
  const layersRaw = params.get("layers");
  let edgeLayerPins: TerraformEdgeLayerPins | undefined;
  if (layersRaw != null && layersRaw.trim() !== "") {
    const codes = layersRaw
      .trim()
      .toLowerCase()
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code !== "" && code !== "none");
    const codeToKey = new Map<string, keyof TerraformEdgeLayerPins>(
      EDGE_LAYER_CODES.map(([key, code]) => [code, key] as const),
    );
    for (const code of codes) {
      if (!codeToKey.has(code)) {
        return null;
      }
    }
    edgeLayerPins = {
      dependency: false,
      dataFlow: false,
      declaredDataFlow: false,
      networking: false,
      topologyFrameFlow: false,
    };
    for (const code of codes) {
      edgeLayerPins[codeToKey.get(code)!] = true;
    }
  }

  // `focusdir=deps|dependents` (W11 WP1). "both" is the default and is never an
  // accepted explicit code — it is represented by omission only.
  const focusDirRaw = params.get("focusdir");
  let focusDirection: TerraformFocusDirection | undefined;
  if (focusDirRaw != null && focusDirRaw.trim() !== "") {
    const normalized = focusDirRaw.trim().toLowerCase();
    if (normalized === "deps") {
      focusDirection = "dependencies";
    } else if (normalized === "dependents") {
      focusDirection = "dependents";
    } else {
      return null;
    }
  }

  // `focushops=all` (W11 WP1, "Unlimited" → Infinity) or an explicit finite
  // non-negative safe-integer cap (`focushops=0` = focused node only — W13
  // WP1; W11 F5 — AppState accepts any finite cap via the API, so shares
  // must round-trip it). Negative values (the `-1` sentinel included) never
  // appear in URLs and reject. The legacy default (3 hops) is represented by
  // omission only.
  //
  // W13 F4 — LEXICAL form is validated first: the only accepted spellings are
  // the literal `all` or a canonical ASCII decimal integer
  // (`/^(0|[1-9][0-9]*)$/`). Numeric aliases that `Number()` would happily
  // coerce — `-0`, leading zeros (`007`), hex (`0x10`), signs (`+1`),
  // exponents (`1e2`), decimals (`2.0`) — all reject the whole URL. This
  // REVERSES the W13 WP1 decimal-spelling pin ("accept iff Number() yields an
  // integer"): one lexical form per value, so URLs stay canonical and
  // round-trip byte-stable. The parsed value must then also pass the shared
  // domain validator (non-negative safe integer).
  const focusHopsRaw = params.get("focushops");
  let focusMaxHops: number | undefined;
  if (focusHopsRaw != null && focusHopsRaw.trim() !== "") {
    const normalized = focusHopsRaw.trim().toLowerCase();
    if (normalized === "all") {
      focusMaxHops = Infinity;
    } else if (/^(0|[1-9][0-9]*)$/.test(normalized)) {
      const parsedHops = Number(normalized);
      if (isValidTerraformFocusHopCount(parsedHops)) {
        focusMaxHops = parsedHops;
      } else {
        // Canonical digits but beyond Number.MAX_SAFE_INTEGER — reject.
        return null;
      }
    } else {
      return null;
    }
  }

  // `canvasPerf=hideicons,…` (or `none`) + `canvasPerfZoom=0.2|0.3|0.4` → full perf settings.
  const canvasPerfRaw = params.get("canvasPerf");
  const canvasPerfZoomRaw = params.get("canvasPerfZoom");
  let runtimePerformance: TerraformRuntimePerformanceSettings | undefined;
  if (
    (canvasPerfRaw != null && canvasPerfRaw.trim() !== "") ||
    (canvasPerfZoomRaw != null && canvasPerfZoomRaw.trim() !== "")
  ) {
    const settings: TerraformRuntimePerformanceSettings = {
      ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS,
    };
    const codeToKey = new Map<string, TerraformPerfBooleanKey>(
      RUNTIME_PERF_CODES.map(([key, code]) => [code, key] as const),
    );
    const codes = (canvasPerfRaw ?? "")
      .trim()
      .toLowerCase()
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code !== "" && code !== "none");
    for (const code of codes) {
      if (!codeToKey.has(code)) {
        return null;
      }
      settings[codeToKey.get(code)!] = true;
    }
    if (canvasPerfZoomRaw != null && canvasPerfZoomRaw.trim() !== "") {
      const zoom = Number(canvasPerfZoomRaw.trim());
      if (zoom !== 0.2 && zoom !== 0.3 && zoom !== 0.4) {
        return null;
      }
      settings.lowZoomThreshold = zoom;
    }
    runtimePerformance = settings;
  }

  return {
    presetId,
    ...(view ? { view } : {}),
    ...(pack ? { pack } : {}),
    ...(compact != null ? { compact } : {}),
    ...(pipelineVariant ? { pipelineVariant } : {}),
    ...(packed != null ? { packed } : {}),
    ...(packedPullLeft != null ? { packedPullLeft } : {}),
    ...(ancillary != null ? { ancillary } : {}),
    ...(privateApiRegional != null ? { privateApiRegional } : {}),
    ...(semanticPlace != null ? { semanticPlace } : {}),
    ...(swimlaneRise != null ? { swimlaneRise } : {}),
    ...(reorder != null ? { reorder } : {}),
    ...(crossingMin != null ? { crossingMin } : {}),
    ...(subnetDeBand != null ? { subnetDeBand } : {}),
    ...(deBandLevel != null ? { deBandLevel } : {}),
    ...(rankSeparate != null ? { rankSeparate } : {}),
    ...(straighten != null ? { straighten } : {}),
    ...(coordRepack != null ? { coordRepack } : {}),
    ...(deDensify != null ? { deDensify } : {}),
    ...(columnPacking != null ? { columnPacking } : {}),
    ...(profile != null ? { profile } : {}),
    ...(staircaseBandOverlap != null ? { staircaseBandOverlap } : {}),
    ...(strataNsRank != null ? { strataNsRank } : {}),
    ...(strataSweeps != null ? { strataSweeps } : {}),
    ...(strataCoordRefine != null ? { strataCoordRefine } : {}),
    ...(strataRankSeparate != null ? { strataRankSeparate } : {}),
    ...(strataPackedScoring != null ? { strataPackedScoring } : {}),
    ...(strataPackedEps != null ? { strataPackedEps } : {}),
    ...(strataEdgeRouting != null ? { strataEdgeRouting } : {}),
    ...(strataBandCompact != null ? { strataBandCompact } : {}),
    ...(strataBandDepth != null ? { strataBandDepth } : {}),
    ...(strataSift != null ? { strataSift } : {}),
    ...(strataPenW != null ? { strataPenW } : {}),
    ...(strataCrossW != null ? { strataCrossW } : {}),
    ...(strataEdgeCap != null ? { strataEdgeCap } : {}),
    ...(lodEnabled != null ? { lodEnabled } : {}),
    ...(lodPreset != null ? { lodPreset } : {}),
    ...(minimap != null ? { minimap } : {}),
    ...(edgeLayerPins != null ? { edgeLayerPins } : {}),
    ...(runtimePerformance != null ? { runtimePerformance } : {}),
    ...(focusDirection != null ? { focusDirection } : {}),
    ...(focusMaxHops != null ? { focusMaxHops } : {}),
  };
};

export const hasTerraformDemoAutoImportQuery = (search: string): boolean =>
  parseTerraformDemoUrlParams(search) != null;

/**
 * Serialize demo params back into a `/demo?…` URL — the inverse of
 * {@link parseTerraformDemoUrlParams}. Emits the canonical param names the parser
 * reads (booleans as `1`/`0`, enums verbatim), skipping any field left `undefined`,
 * so `parseTerraformDemoUrlParams(build(x)) === x` round-trips for any params `x`.
 */
export const buildTerraformDemoUrl = (
  params: TerraformDemoUrlParams,
  options?: { origin?: string; pathname?: string },
): string => {
  const sp = new URLSearchParams();
  sp.set("preset", params.presetId);
  const setBool = (name: string, value?: boolean): void => {
    if (value !== undefined) {
      sp.set(name, value ? "1" : "0");
    }
  };
  const setEnum = (name: string, value?: string): void => {
    if (value != null && value !== "") {
      sp.set(name, value);
    }
  };
  const setNum = (name: string, value?: number): void => {
    if (value != null) {
      sp.set(name, String(value));
    }
  };

  setEnum("view", params.view);
  setEnum("pack", params.pack);
  setBool("compact", params.compact);
  setEnum("pipelineVariant", params.pipelineVariant);
  setBool("packed", params.packed);
  setBool("packedPullLeft", params.packedPullLeft);
  setBool("ancillary", params.ancillary);
  setBool("privateApiRegional", params.privateApiRegional);
  setBool("semanticPlace", params.semanticPlace);
  setBool("swimlaneRise", params.swimlaneRise);
  setBool("reorder", params.reorder);
  setBool("crossingMin", params.crossingMin);
  setEnum("deBandLevel", params.deBandLevel);
  setBool("subnetDeBand", params.subnetDeBand);
  setBool("rankSeparate", params.rankSeparate);
  setBool("straighten", params.straighten);
  setBool("coordRepack", params.coordRepack);
  setBool("deDensify", params.deDensify);
  setEnum("columnPacking", params.columnPacking);
  setEnum("profile", params.profile);
  setBool("staircaseBandOverlap", params.staircaseBandOverlap);
  setBool("strataNsRank", params.strataNsRank);
  setNum("strataSweeps", params.strataSweeps);
  setBool("strataCoordRefine", params.strataCoordRefine);
  setBool("strataRankSep", params.strataRankSeparate);
  setBool("strataPackedScoring", params.strataPackedScoring);
  setNum("strataPackedEps", params.strataPackedEps);
  setBool("strataEdgeRouting", params.strataEdgeRouting);
  setBool("strataBandCompact", params.strataBandCompact);
  setEnum("strataBandDepth", params.strataBandDepth);
  setBool("strataSift", params.strataSift);
  setNum("strataPenW", params.strataPenW);
  setNum("strataCrossW", params.strataCrossW);
  setNum("strataEdgeCap", params.strataEdgeCap);

  // ─── Runtime canvas view settings ───
  setBool("lodEnabled", params.lodEnabled);
  setEnum("lodPreset", params.lodPreset);
  setBool("minimap", params.minimap);
  if (params.edgeLayerPins) {
    const enabled = EDGE_LAYER_CODES.filter(
      ([key]) => params.edgeLayerPins![key],
    ).map(([, code]) => code);
    sp.set("layers", enabled.length > 0 ? enabled.join(",") : "none");
  }
  if (params.runtimePerformance) {
    const enabled = RUNTIME_PERF_CODES.filter(
      ([key]) => params.runtimePerformance![key],
    ).map(([, code]) => code);
    sp.set("canvasPerf", enabled.length > 0 ? enabled.join(",") : "none");
    sp.set(
      "canvasPerfZoom",
      String(params.runtimePerformance.lowZoomThreshold),
    );
  }
  // `"both"` is the default and is never emitted — only the two non-default
  // codes round-trip through the URL.
  if (params.focusDirection === "dependencies") {
    sp.set("focusdir", "deps");
  } else if (params.focusDirection === "dependents") {
    sp.set("focusdir", "dependents");
  }
  // `Infinity` never hits JSON — encoded as the string "all" here. Finite
  // non-null caps (W11 F5) are emitted numerically so they round-trip.
  if (params.focusMaxHops === Infinity) {
    sp.set("focushops", "all");
  } else if (params.focusMaxHops != null) {
    sp.set("focushops", String(params.focusMaxHops));
  }

  const pathname = options?.pathname ?? "/demo";
  const origin = options?.origin ?? "";
  return `${origin}${pathname}?${sp.toString()}`;
};

/**
 * Resolve the AppState relationship-focus pair from parsed share/demo params
 * (W11 F2). The share codec omits both params at their defaults while both
 * AppState fields are browser-persisted, so a recipient with stale non-default
 * local state (e.g. `dependents`/unlimited) would silently keep it when
 * opening a "default" share URL. Omitted params therefore mean EXPLICIT
 * defaults (`"both"` / `null`) and the auto-import must always set the pair.
 * `Infinity` (`focushops=all`) maps to the JSON-safe stored sentinel `-1`;
 * finite caps are stored verbatim.
 */
export const resolveTerraformFocusSettingsFromDemoParams = (
  params: Pick<TerraformDemoUrlParams, "focusDirection" | "focusMaxHops">,
): {
  terraformFocusDirection: TerraformFocusDirection;
  terraformFocusMaxHops: number | null;
} => ({
  terraformFocusDirection: params.focusDirection ?? "both",
  terraformFocusMaxHops:
    params.focusMaxHops === undefined
      ? null
      : params.focusMaxHops === Infinity
      ? -1
      : params.focusMaxHops,
});

/** The dialog/hook settings the demo URL captures (mirrors the import option threading). */
export type TerraformDemoSettingsSnapshot = {
  presetId: string;
  view: TerraformView;
  pipelineCompact: boolean;
  pipelineLayoutVariant: PipelineLayoutVariant;
  pipelinePacked: boolean;
  pipelinePackedPullLeft: boolean;
  pipelineIncludeAncillary: boolean;
  pipelinePrivateApiRegional: boolean;
  pipelineSemanticPlacement: boolean;
  pipelineSwimlaneLaneRise: boolean;
  pipelineReorder: boolean;
  pipelineCrossingMin: boolean;
  pipelineDeBandLevel: DeBandLevel;
  pipelineRankSeparate: boolean;
  pipelineStraighten: boolean;
  pipelineCoordRepack: boolean;
  pipelineColumnPacking: "spread" | "none" | "compact" | "shorten";
  /** The primary RCLL Layout control — `"custom"` once any flag is touched directly. */
  pipelineLayoutProfile: RcllLayoutProfile | "custom";
  pipelineStaircaseBandOverlap: boolean;
  moduleLayoutMode: ModulePackingMode;
  // ─── Strata (rcll-v2) engine flags — S0a: accepted + threaded, unused until the
  // engine lands (M1). All opt-in, default off/0. ───
  strataNetworkSimplexRank: boolean;
  strataSweeps: number;
  strataCoordinateRefine: boolean;
  strataRankSeparate: boolean;
  strataPackedScoring: boolean;
  strataPackedScoringEpsilon: number;
  strataEdgeRouting: boolean;
  strataBandCompact: boolean;
  /** v3.2 band-depth slider. Optional (unlike the other Strata flags above)
   * so a snapshot literal that predates this field still type-checks;
   * defaults to `"account"` at every consumer. */
  strataBandDepth?: StrataHullRole;
  /** OD-15 crossings-≻-length relocate lever. Default off. */
  strataSiftRelocate: boolean;
  /** Relocate objective weight on penetrations. Default 1. */
  strataCrossWeightPenetration: number;
  /** Relocate objective weight on edge-edge crossings. Default 1. */
  strataCrossWeightEdge: number;
  /** Edge-edge regression cap. Optional — absent inherits
   * `strataPackedScoringEpsilon`. */
  strataEdgeCrossCap?: number;
};

/**
 * Collect the demo params for the *currently relevant* settings, scoped by view so the URL
 * stays clean: the Semantic view carries none, Module carries `pack`, and Pipeline/RCLL carry
 * their own controls. For RCLL a named Layout profile serializes as `profile=…` (the import
 * fans it back into the flags); only a `"custom"` profile spells out the eight RCLL flags,
 * since explicit flags win over the profile downstream.
 */
export const collectTerraformDemoParams = (
  snapshot: TerraformDemoSettingsSnapshot,
): TerraformDemoUrlParams => {
  const base: TerraformDemoUrlParams = {
    presetId: snapshot.presetId,
    view: snapshot.view,
  };

  if (snapshot.view === "module") {
    return {
      ...base,
      ...(snapshot.moduleLayoutMode !== "default"
        ? { pack: snapshot.moduleLayoutMode }
        : {}),
    };
  }

  if (snapshot.view === "pipeline") {
    return {
      ...base,
      compact: snapshot.pipelineCompact,
      pipelineVariant: snapshot.pipelineLayoutVariant,
      packed: snapshot.pipelinePacked,
      ...(snapshot.pipelinePackedPullLeft ? { packedPullLeft: true } : {}),
      ancillary: snapshot.pipelineIncludeAncillary,
      semanticPlace: snapshot.pipelineSemanticPlacement,
      // `privateApiRegional` is strata-only (see the strata branch below); the
      // pipeline view never applies it, so it is not serialized here — keeping
      // non-strata share URLs byte-identical to before the flag existed.
    };
  }

  if (snapshot.view === "rcll") {
    // `compact` + `ancillary` are independent of the Layout profile, so always emit them.
    // `privateApiRegional` is strata-only (see the strata branch); not serialized here.
    const rcll: TerraformDemoUrlParams = {
      ...base,
      compact: snapshot.pipelineCompact,
      ancillary: snapshot.pipelineIncludeAncillary,
    };
    if (snapshot.pipelineLayoutProfile !== "custom") {
      return { ...rcll, profile: snapshot.pipelineLayoutProfile };
    }
    return {
      ...rcll,
      swimlaneRise: snapshot.pipelineSwimlaneLaneRise,
      rankSeparate: snapshot.pipelineRankSeparate,
      deBandLevel: snapshot.pipelineDeBandLevel,
      staircaseBandOverlap: snapshot.pipelineStaircaseBandOverlap,
      reorder: snapshot.pipelineReorder,
      crossingMin: snapshot.pipelineCrossingMin,
      straighten: snapshot.pipelineStraighten,
      coordRepack: snapshot.pipelineCoordRepack,
      columnPacking: snapshot.pipelineColumnPacking,
    };
  }

  if (snapshot.view === "strata") {
    // Strata engine flags are ALWAYS emitted explicitly (both states). Since the
    // W5 default flip the dialog seeds K=4+A7 ON, so a truthy-only emit would
    // make a "turned OFF" share URL silently re-import with the defaults ON —
    // explicit values keep parse(build(x)) faithful in both directions.
    // strataNsRank stays truthy-only (no UI control; S0a passthrough).
    return {
      ...base,
      compact: snapshot.pipelineCompact,
      ancillary: snapshot.pipelineIncludeAncillary,
      // Strata defaults private-API regional placement ON, so — like the K=4+A7
      // engine flags above — emit it EXPLICITLY in both states. A truthy-only
      // emit would drop an "explicit OFF" toggle from the share URL and silently
      // re-import with the default ON. (pipeline/rcll keep truthy-only: they
      // default the flag OFF, so absent already round-trips faithfully.)
      privateApiRegional: snapshot.pipelinePrivateApiRegional,
      ...(snapshot.strataNetworkSimplexRank ? { strataNsRank: true } : {}),
      strataSweeps: snapshot.strataSweeps,
      strataCoordRefine: snapshot.strataCoordinateRefine,
      strataRankSeparate: snapshot.strataRankSeparate,
      // Round 9: default-off, no dialog default flip — truthy-only like NS.
      ...(snapshot.strataPackedScoring ? { strataPackedScoring: true } : {}),
      // W8b: default-0 — truthy-only (a 0 budget is the absent-param default).
      ...(snapshot.strataPackedScoringEpsilon
        ? { strataPackedEps: snapshot.strataPackedScoringEpsilon }
        : {}),
      // Package C spike (W9): default-off — truthy-only, like packed scoring.
      ...(snapshot.strataEdgeRouting ? { strataEdgeRouting: true } : {}),
      // W10 (SDEC-63): default-off — truthy-only, like packed scoring.
      ...(snapshot.strataBandCompact ? { strataBandCompact: true } : {}),
      // v3.2 band-depth slider: emit only when it diverges from the default
      // cut. `strataBandDepth` is a TRUTHY string at every value (including
      // the default `"account"`), so — unlike the booleans above — this must
      // compare explicitly to the default, never `&&`-truthy-gate.
      ...((snapshot.strataBandDepth ?? "account") !== "account"
        ? { strataBandDepth: snapshot.strataBandDepth }
        : {}),
      // OD-15 relocate + its weights: default-off/1/1 — truthy/non-default-only,
      // like the packed-scoring levers above.
      ...(snapshot.strataSiftRelocate ? { strataSift: true } : {}),
      ...(snapshot.strataCrossWeightPenetration !== 1
        ? { strataPenW: snapshot.strataCrossWeightPenetration }
        : {}),
      ...(snapshot.strataCrossWeightEdge !== 1
        ? { strataCrossW: snapshot.strataCrossWeightEdge }
        : {}),
      // Edge-edge regression cap has no default — emit whenever explicitly set.
      ...(snapshot.strataEdgeCrossCap !== undefined
        ? { strataEdgeCap: snapshot.strataEdgeCrossCap }
        : {}),
    };
  }

  // Semantic view carries no extra layout controls.
  return base;
};

/** Convenience: collect + serialize a settings snapshot into a shareable `/demo?…` URL. */
export const buildTerraformDemoUrlFromSettings = (
  snapshot: TerraformDemoSettingsSnapshot,
  options?: { origin?: string; pathname?: string },
): string =>
  buildTerraformDemoUrl(collectTerraformDemoParams(snapshot), options);
