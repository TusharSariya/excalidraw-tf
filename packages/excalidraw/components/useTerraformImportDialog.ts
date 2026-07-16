import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApp, useExcalidrawSetAppState } from "./App";
import {
  type TerraformImportWarning,
  type TerraformPlanParsingSources,
  type TerraformPlanDotBundle,
} from "./terraformPlanParsing";
import { parseRawStateJson } from "./terraformImportMerge";
import {
  runTerraformImportWithView,
  runTerraformPresetImport,
} from "./terraformPresetImport";
import { DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS } from "./terraformModuleLayoutOptions";
import {
  BUILTIN_TERRAFORM_IMPORT_PRESETS,
  deleteTerraformImportPreset,
  listTerraformImportPresets,
  saveTerraformImportPreset,
  type TerraformImportPreset,
  updateTerraformImportPreset,
} from "./terraformImportPresets";
import {
  chooseTerraformImportPresetRootDirectory,
  type TerraformImportPresetWarning,
} from "./terraformImportPresetLoader";
import {
  fetchTerraformImportArtifactsFromApi,
  fetchTerraformImportPresetFromApi,
  saveTerraformImportArtifactViaApi,
  saveTerraformImportCompositionViaApi,
  syncTerraformImportPresetFromDiskViaApi,
} from "./terraformImportPresetsApi";
import {
  inferStackIdFromFileName,
  MAX_PLAN_BUNDLES,
  newBundleRow,
  readFileText,
  toPresetId,
  type PlanDotBundleRow,
  type PipelineLayoutVariant,
  type RcllLayoutProfileSelection,
  type TerraformView,
} from "./terraformImportDialogUtils";
import {
  DEFAULT_RCLL_LAYOUT_PROFILE,
  resolveRcllLayoutProfile,
  type DeBandLevel,
  type RcllLayoutProfile,
} from "./terraformPipelineLayoutProfiles";
import { buildTerraformDemoUrlFromSettings } from "./terraformDemoUrlParams";
import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";

import type { StrataHullRole } from "./terraformPipelineStrataTypes";

import type {
  TerraformImportArtifact,
  TerraformImportArtifactKind,
} from "./terraformImportPresetsTypes";

type UseTerraformImportDialogProps = {
  onCloseRequest: () => void;
  onImportSuccess?: () => void;
  onImportFail?: () => void;
};

export const useTerraformImportDialog = ({
  onCloseRequest,
  onImportSuccess,
  onImportFail,
}: UseTerraformImportDialogProps) => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();

  const [bundles, setBundles] = useState<PlanDotBundleRow[]>(() => [
    newBundleRow(),
  ]);
  const [stateFiles, setStateFiles] = useState<File[]>([]);
  const [tfdFiles, setTfdFiles] = useState<File[]>([]);
  const [view, setView] = useState<TerraformView>("semantic");
  const [pipelineCompact, setPipelineCompact] = useState(true);
  const [pipelineLayoutVariant, setPipelineLayoutVariant] =
    useState<PipelineLayoutVariant>("classic");
  const [pipelinePacked, setPipelinePacked] = useState(false);
  const [pipelinePackedPullLeft, setPipelinePackedPullLeft] = useState(false);
  const [pipelineIncludeAncillary, setPipelineIncludeAncillary] =
    useState(false);
  const [pipelineSemanticPlacement, setPipelineSemanticPlacement] =
    useState(false);
  // RCLL M4 (rcll-only): swimlane lanes rise to share Y rows. Not reset on view
  // switch — it is the one dial the RCLL view owns.
  const [pipelineSwimlaneLaneRise, setPipelineSwimlaneLaneRise] =
    useState(false);
  // RCLL M6 (rcll-only): per-container barycenter crossing-min reorder. Like the
  // swimlane dial, not reset on view switch — the RCLL view owns it.
  const [pipelineReorder, setPipelineReorder] = useState(false);
  // RCLL M6c (rcll-only): container-aware crossing minimization — the hierarchical
  // superset of the leaf reorder (the guard makes it win when both are on). RCLL-owned.
  const [pipelineCrossingMin, setPipelineCrossingMin] = useState(false);
  const [pipelineDeBandLevel, setPipelineDeBandLevel] =
    useState<DeBandLevel>("none");
  // RCLL M8r (rcll-only): whole-model-global sibling-separation ranking. Gated in
  // the UI to require the lane-rise (solo = taller/wider — see toggle guards).
  const [pipelineRankSeparate, setPipelineRankSeparate] = useState(false);
  // RCLL M5 (rcll-only): Brandes–Köpf leaf straightening.
  const [pipelineStraighten, setPipelineStraighten] = useState(false);
  // RCLL M5b (rcll-only): coordinated per-column permutation re-pack (refines straighten).
  const [pipelineCoordRepack, setPipelineCoordRepack] = useState(false);
  // RCLL "Column packing" tri-state (rcll-only): `spread` = M5b de-density (pull-right),
  // `compact` = M5c column compaction (pull-left), `none` = neither. Default `none`.
  const [pipelineColumnPacking, setPipelineColumnPacking] = useState<
    "spread" | "none" | "compact" | "shorten"
  >("none");
  // RCLL M3b / DEC-1 (rcll-only): X-disjoint cycle groups rise to share Y. Default
  // ON (true) — turning it off (Stacked) makes cyclic groups taller.
  const [pipelineStaircaseBandOverlap, setPipelineStaircaseBandOverlap] =
    useState(true);
  // Strata (rcll-v2) OD-1/OD-2/A7 flags (strata-only), threaded end-to-end
  // (URL → here → sceneContext → builder → scene meta); UI toggles in
  // TerraformStrataSettings.tsx (SDEC-49). K=4 + A7 seed ON: the W5 repaired-stats
  // battery showed K=0 is the worst arm on every metric while K=4+A7 is the
  // validated arm (first task-metric win over v2) — owner-directed default flip,
  // superseding SDEC-48's opt-in ruling (see the decision log).
  const [strataNetworkSimplexRank, setStrataNetworkSimplexRank] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataNetworkSimplexRank as boolean,
  );
  const [strataSweeps, setStrataSweeps] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSweeps as number,
  );
  const [strataCoordinateRefine, setStrataCoordinateRefine] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCoordinateRefine as boolean,
  );
  // Strata OD-14 (strata-only): whole-model sibling-separation ranking (the
  // height lever). Deliberately default-OFF: W5 measured it as a trade — shorter
  // canvas + better crossing angles bought with MORE crossings on dependency
  // paths (it flips the K=4+A7 task-metric win to a loss).
  const [strataRankSeparate, setStrataRankSeparate] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataRankSeparate as boolean,
  );
  // Strata round 9 (SDEC-57, strata-only): packed-hull whole-layout candidate
  // scoring — fixes the blind local-crossings acceptance (R9-F1). Default OFF
  // pending its v3.2 gate battery.
  const [strataPackedScoring, setStrataPackedScoring] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoring as boolean,
  );
  // Strata W8b (strata-only): ε-constraint crossings budget for the packed
  // scorer. Default 0 = the strict round-9 rule; REPORT lever — a nonzero
  // default is an owner adjudication, never a silent pick.
  const [strataPackedScoringEpsilon, setStrataPackedScoringEpsilon] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoringEpsilon as number,
  );
  // Strata G-DESCENT converge (strata-only): return the best-seen adopted
  // snapshot instead of the packed descent's last rolling incumbent. Default
  // OFF (byte-identical off); inert unless strataPackedScoringEpsilon >= 1.
  const [strataPackedConverge, setStrataPackedConverge] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedConverge as boolean,
  );
  // Strata transitive-adopt (strata-only): replace the ε adoption gate with a
  // strict total order so the descent can't adopt-then-drop a layout for a
  // strictly worse one. Default OFF (byte-identical off); descent-scoped;
  // gated on the preference-calibration work.
  const [strataTransitiveAdopt, setStrataTransitiveAdopt] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataTransitiveAdopt as boolean,
  );
  // P4 pure-sink account block clamp (strata-only): post-A7 pass that rigid-
  // translates a whole dead-end account subtree left. Default OFF (byte-identical).
  const [strataBlockClamp, setStrataBlockClamp] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBlockClamp as boolean,
  );
  // P2 within-column transpose (strata-only): post-A7 pass that swaps Y-adjacent
  // X-overlapping sibling pairs to remove leftover crossings. Default OFF
  // (envelope-preserving, byte-identical).
  const [strataTranspose, setStrataTranspose] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataTranspose as boolean,
  );
  // Strata P5 (Lever C, strata-only): per-hull implied-height maintain-or-
  // decrease referee on the sink-pull-in / block-clamp adoptions. Default OFF
  // (inert under phase 1 — byte-identical).
  const [strataHeightGate, setStrataHeightGate] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataHeightGate as boolean,
  );
  // Strata Package C spike (W9, strata-only): post-A7 obstacle-avoiding edge
  // routing — penetrating edges only. Default OFF pending its gate battery.
  const [strataEdgeRouting, setStrataEdgeRouting] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataEdgeRouting as boolean,
  );
  // Strata P3-pierce (strata-only): clean single-side container-exit routing.
  // Default OFF / byte-identical pending owner adjudication.
  const [strataBorderRoute, setStrataBorderRoute] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBorderRoute as boolean,
  );
  // Strata band-depth slider (v3.2, strata-only): the deepest role still
  // banded — deeper roles pack X-disjoint siblings into shared rows. Default
  // "account" reproduces today's fixed role→policy map byte-identically.
  // Legacy `strataBandCompact` boolean lives on only as an engine-side alias
  // for `strataBandDepth: "root"` (old share links); this hook's UI state is
  // the enum directly and no longer forwards the boolean.
  const [strataBandDepth, setStrataBandDepth] = useState<StrataHullRole>(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBandDepth as StrataHullRole,
  );
  // OD-15 crossings-≻-length relocate (strata-only). Default OFF pending its
  // gate battery.
  const [strataSiftRelocate, setStrataSiftRelocate] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSiftRelocate as boolean,
  );
  // Relocate objective weights (strata-only, inert without strataSiftRelocate).
  const [strataCrossWeightPenetration, setStrataCrossWeightPenetration] =
    useState(
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCrossWeightPenetration as number,
    );
  const [strataCrossWeightEdge, setStrataCrossWeightEdge] = useState(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCrossWeightEdge as number,
  );
  // Edge-edge regression cap — OPTIONAL, no seeded default (absent ⇒ the
  // engine inherits `strataPackedScoringEpsilon`).
  const [strataEdgeCrossCap, setStrataEdgeCrossCap] = useState<
    number | undefined
  >(undefined);
  // Private REST APIs at account+region level instead of nested in a VPC.
  // Strata-only: seeded ON (the strata view is the only one wired for it), but
  // `runTerraformImportWithView` view-scopes the value so it never reaches a
  // non-strata engine/worker call — those keep forcing it false, byte-identical
  // to today. The toggle is exposed only in the strata settings panel.
  const [pipelinePrivateApiRegional, setPipelinePrivateApiRegional] =
    useState(true);
  const [moduleLayoutOptions, setModuleLayoutOptions] = useState(
    DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
  );

  // RCLL "Layout" — the outcome-first PRIMARY control. A named profile fans out into the
  // RCLL flags above (the values actually threaded to import); touching any of those
  // levers directly (from the Advanced disclosure) flips this to "custom" so the primary
  // control never lies about what is active. Default `balanced` = today's flag defaults.
  const [pipelineLayoutProfile, setPipelineLayoutProfileState] =
    useState<RcllLayoutProfileSelection>(DEFAULT_RCLL_LAYOUT_PROFILE);

  // Apply a named profile: expand its bundle into the RCLL flag setters (raw, so the
  // fan-out itself does not mark "custom"), then record the profile as the primary choice.
  const applyPipelineLayoutProfile = useCallback(
    (profile: RcllLayoutProfile) => {
      const flags = resolveRcllLayoutProfile(profile);
      setPipelineSwimlaneLaneRise(flags.swimlaneLaneRise);
      setPipelineRankSeparate(flags.rankSeparate);
      setPipelineDeBandLevel(flags.deBandLevel);
      setPipelineStaircaseBandOverlap(flags.staircaseBandOverlap);
      setPipelineReorder(flags.reorder);
      setPipelineCrossingMin(flags.crossingMin);
      setPipelineStraighten(flags.straighten);
      setPipelineCoordRepack(flags.coordRepack);
      setPipelineColumnPacking(flags.columnPacking);
      setPipelineLayoutProfileState(profile);
    },
    [],
  );

  // Wrap each individual RCLL-flag setter so an Advanced edit flips the primary control to
  // "custom". `markCustom` only downgrades a named profile — re-applying a profile resets it.
  const markLayoutCustom = useCallback(
    () => setPipelineLayoutProfileState("custom"),
    [],
  );
  const setPipelineSwimlaneLaneRiseCustom = useCallback(
    (v: boolean) => {
      setPipelineSwimlaneLaneRise(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineReorderCustom = useCallback(
    (v: boolean) => {
      setPipelineReorder(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineCrossingMinCustom = useCallback(
    (v: boolean) => {
      setPipelineCrossingMin(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineDeBandLevelCustom = useCallback(
    (v: DeBandLevel) => {
      setPipelineDeBandLevel(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineRankSeparateCustom = useCallback(
    (v: boolean) => {
      setPipelineRankSeparate(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineStraightenCustom = useCallback(
    (v: boolean) => {
      setPipelineStraighten(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineCoordRepackCustom = useCallback(
    (v: boolean) => {
      setPipelineCoordRepack(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineColumnPackingCustom = useCallback(
    (v: "spread" | "none" | "compact" | "shorten") => {
      setPipelineColumnPacking(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );
  const setPipelineStaircaseBandOverlapCustom = useCallback(
    (v: boolean) => {
      setPipelineStaircaseBandOverlap(v);
      markLayoutCustom();
    },
    [markLayoutCustom],
  );

  // RCLL view delegates to the compound builder at M0 (its own algorithm lands
  // across later milestones) and does not expose the height/placement dials.
  // Strata (S0a) is the same v2-passthrough situation. Reset the shared dials so
  // stale panel state can't ride along into either import.
  const handleSetView = useCallback((next: TerraformView) => {
    setView(next);
    if (next === "rcll" || next === "strata") {
      setPipelinePacked(false);
      setPipelinePackedPullLeft(false);
      setPipelineSemanticPlacement(false);
    }
  }, []);
  const [loading, setLoading] = useState(false);
  const [layoutProgress, setLayoutProgress] = useState<string | null>(null);
  const layoutAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Strata (rcll-v2) failure-contract fallback marker (v3.0 §8.4 / v3.1 §5). Not
  // yet emitted by any engine at S0a; wired ahead of the engine landing (W2).
  const [rcllV2Degraded, setRcllV2Degraded] = useState<{
    stage: string;
    reason: string;
  } | null>(null);
  const [importWarnings, setImportWarnings] = useState<
    TerraformImportWarning[] | null
  >(null);
  const [importDone, setImportDone] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(
    BUILTIN_TERRAFORM_IMPORT_PRESETS[0]?.id ?? "",
  );
  const [presetWarnings, setPresetWarnings] = useState<
    TerraformImportPresetWarning[]
  >([]);
  const [availablePresets, setAvailablePresets] = useState<
    TerraformImportPreset[]
  >([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [activePreset, setActivePreset] =
    useState<TerraformImportPreset | null>(null);
  const [artifacts, setArtifacts] = useState<TerraformImportArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactRepoName, setArtifactRepoName] = useState("my-infra");
  const [artifactRelativePath, setArtifactRelativePath] = useState("");
  const [artifactKind, setArtifactKind] =
    useState<TerraformImportArtifactKind>("plan");
  const [artifactUploadFile, setArtifactUploadFile] = useState<File | null>(
    null,
  );

  const refreshPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const presets = await listTerraformImportPresets();
      setAvailablePresets(presets);
      setSelectedPresetId((current) => {
        if (
          presets.length > 0 &&
          !presets.some((preset) => preset.id === current)
        ) {
          return presets[0]!.id;
        }
        return current;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load import presets.",
      );
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  const refreshArtifacts = useCallback(async () => {
    if (!import.meta.env.DEV) {
      return;
    }
    setArtifactsLoading(true);
    try {
      setArtifacts(await fetchTerraformImportArtifactsFromApi());
    } catch {
      // Artifact library is optional outside dev API.
    } finally {
      setArtifactsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);

  useEffect(() => {
    return () => {
      layoutAbortRef.current?.abort();
    };
  }, []);

  const selectedPreset = useMemo(() => {
    const fromApi = availablePresets.find(
      (preset) => preset.id === selectedPresetId,
    );
    if (fromApi) {
      return fromApi;
    }
    return (
      BUILTIN_TERRAFORM_IMPORT_PRESETS.find(
        (preset) => preset.id === selectedPresetId,
      ) ?? null
    );
  }, [availablePresets, selectedPresetId]);

  const completeBundles = bundles.filter((b) => b.planFile && b.dotFile);
  const partialBundles = bundles.filter(
    (b) => (b.planFile && !b.dotFile) || (!b.planFile && b.dotFile),
  );
  const hasPlanMode = completeBundles.length > 0;
  const stateOnly =
    stateFiles.length > 0 &&
    completeBundles.length === 0 &&
    partialBundles.length === 0;
  const canImport = hasPlanMode || stateOnly || activePreset != null;
  const canUseSemanticView =
    hasPlanMode || stateFiles.length > 0 || activePreset != null;
  const semanticViewDisabled = loading || !canUseSemanticView;
  const usingPresetManifest = activePreset != null;

  const updateBundle = (id: string, patch: Partial<PlanDotBundleRow>) => {
    setBundles((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const addBundle = () => {
    if (bundles.length >= MAX_PLAN_BUNDLES) {
      return;
    }
    setBundles((rows) => [...rows, newBundleRow()]);
  };

  const removeBundle = (id: string) => {
    setBundles((rows) => {
      const next = rows.filter((row) => row.id !== id);
      return next.length > 0 ? next : [newBundleRow()];
    });
  };

  const completeImport = (
    warnings: TerraformImportWarning[] | undefined,
    extraWarnings: TerraformImportPresetWarning[] = [],
    degraded: { stage: string; reason: string } | null = null,
  ) => {
    onImportSuccess?.();
    setImportDone(true);
    setPresetWarnings(extraWarnings);
    setRcllV2Degraded(degraded);
    if (warnings?.length) {
      setImportWarnings(warnings);
    } else if (extraWarnings.length === 0 && !degraded) {
      onCloseRequest();
    }
  };

  const runImportFromSources = async (
    sources: TerraformPlanParsingSources,
    opts: {
      importedTfdTexts?: string[];
      extraWarnings?: TerraformImportPresetWarning[];
      preset?: TerraformImportPreset | null;
    } = {},
  ) => {
    const { importWarnings: warnings, rcllV2Degraded: degraded } =
      await runTerraformImportWithView({
        app,
        setAppState,
        sources,
        view,
        moduleLayoutOptions,
        pipelineCompact,
        pipelineLayoutVariant,
        pipelinePacked,
        pipelinePackedPullLeft,
        pipelineIncludeAncillary,
        // Threaded for every view; `runTerraformImportWithView` view-scopes it
        // (non-strata → false), so the strata-ON seed never leaks to another
        // pipeline.
        pipelinePrivateApiRegional,
        pipelineSemanticPlacement,
        pipelineSwimlaneLaneRise,
        pipelineReorder,
        pipelineCrossingMin,
        pipelineDeBandLevel,
        pipelineRankSeparate,
        pipelineStraighten,
        pipelineCoordRepack,
        pipelineColumnPacking,
        pipelineStaircaseBandOverlap,
        strataNetworkSimplexRank,
        strataSweeps,
        strataCoordinateRefine,
        strataRankSeparate,
        strataPackedScoring,
        strataPackedScoringEpsilon,
        strataPackedConverge,
        strataTransitiveAdopt,
        strataBlockClamp,
        strataTranspose,
        strataHeightGate,
        strataEdgeRouting,
        strataBorderRoute,
        strataBandDepth,
        strataSiftRelocate,
        strataCrossWeightPenetration,
        strataCrossWeightEdge,
        // Optional-only forward: no explicit `undefined` key (absent ⇒ engine
        // inherits `strataPackedScoringEpsilon`).
        ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
        importedTfdTexts: opts.importedTfdTexts,
        preset: opts.preset ?? null,
        signal: layoutAbortRef.current?.signal,
        onLayoutProgress: (p) => {
          const label =
            p.total > 0 ? `${p.phase} (${p.done}/${p.total})` : p.phase;
          setLayoutProgress(label);
        },
      });
    completeImport(warnings, opts.extraWarnings ?? [], degraded ?? null);
  };

  const buildPresetPayload = async (
    presetId: string,
    presetName: string,
    rootPath: string,
  ): Promise<TerraformImportPreset> => {
    if (completeBundles.length > 0) {
      const stacks = await Promise.all(
        completeBundles.map(async (row, index) => {
          const label = row.label.trim() || `Stack ${index + 1}`;
          const inferredId = inferStackIdFromFileName(
            row.planFile?.name || label,
            index,
          );
          const planPath = `${inferredId}/${row.planFile?.name || "plan.json"}`;
          const dotPath = `${inferredId}/${row.dotFile?.name || "graph.dot"}`;
          const statePath = `${inferredId}/terraform.tfstate`;
          const matchingState = stateFiles.find((file) =>
            file.name.includes(inferredId),
          );
          return {
            id: inferredId,
            label,
            planPath,
            dotPath,
            statePath,
            planText: await readFileText(row.planFile!),
            dotText: await readFileText(row.dotFile!),
            ...(matchingState
              ? { stateText: await readFileText(matchingState) }
              : {}),
          };
        }),
      );
      const embeddedTfd =
        tfdFiles.length > 0
          ? await Promise.all(
              tfdFiles.map(async (file) => ({
                path: file.name,
                text: await readFileText(file),
              })),
            )
          : [];
      return {
        id: presetId,
        name: presetName,
        builtin: false,
        description: "User-defined Terraform import preset.",
        rootPath,
        view,
        stacks,
        tfdPaths:
          embeddedTfd.length > 0
            ? embeddedTfd.map((file) => file.path)
            : ["pipeline.tfd"],
        tfdFiles: embeddedTfd,
        hasContent: true,
      };
    }

    const sourcePreset = activePreset ?? selectedPreset;
    if (sourcePreset) {
      const withContent = await fetchTerraformImportPresetFromApi(
        sourcePreset.id,
        { includeContent: true },
      );
      return {
        ...withContent,
        id: presetId,
        name: presetName,
        builtin: false,
        rootPath,
        view,
        hasContent: true,
      };
    }

    throw new Error(
      "Add plan + graph files to store in the preset, or select a preset that already has DB content.",
    );
  };

  const handleImport = async () => {
    if (!usingPresetManifest && partialBundles.length > 0) {
      setError(
        "Each plan + graph row must have both files, or remove the row. You can also import state file(s) alone.",
      );
      return;
    }
    if (!canImport) {
      return;
    }
    layoutAbortRef.current?.abort();
    layoutAbortRef.current = new AbortController();
    setLoading(true);
    setLayoutProgress(null);
    setError(null);
    setImportWarnings(null);
    setPresetWarnings([]);
    setImportDone(false);
    setRcllV2Degraded(null);
    try {
      if (activePreset) {
        const {
          importWarnings: warnings,
          presetSources,
          rcllV2Degraded: degraded,
        } = await runTerraformPresetImport(app, setAppState, activePreset, {
          view,
          moduleLayoutOptions,
          pipelineCompact,
          pipelineLayoutVariant,
          pipelinePacked,
          pipelinePackedPullLeft,
          pipelineIncludeAncillary,
          // View-scoped downstream (non-strata → false); the strata-ON seed
          // never reaches another pipeline's engine call.
          pipelinePrivateApiRegional,
          pipelineSemanticPlacement,
          pipelineSwimlaneLaneRise,
          pipelineReorder,
          pipelineCrossingMin,
          pipelineDeBandLevel,
          pipelineRankSeparate,
          pipelineStraighten,
          pipelineCoordRepack,
          pipelineColumnPacking,
          pipelineStaircaseBandOverlap,
          strataNetworkSimplexRank,
          strataSweeps,
          strataCoordinateRefine,
          strataRankSeparate,
          strataPackedScoring,
          strataPackedScoringEpsilon,
          strataPackedConverge,
          strataTransitiveAdopt,
          strataBlockClamp,
          strataTranspose,
          strataHeightGate,
          strataEdgeRouting,
          strataBorderRoute,
          strataBandDepth,
          strataSiftRelocate,
          strataCrossWeightPenetration,
          strataCrossWeightEdge,
          // Optional-only forward: no explicit `undefined` key (absent ⇒ engine
          // inherits `strataPackedScoringEpsilon`).
          ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
          signal: layoutAbortRef.current?.signal,
          onLayoutProgress: (p) => {
            const label =
              p.total > 0 ? `${p.phase} (${p.done}/${p.total})` : p.phase;
            setLayoutProgress(label);
          },
        });
        completeImport(warnings, presetSources.warnings, degraded ?? null);
        return;
      }

      const planDotBundles: TerraformPlanDotBundle[] = [];
      for (const row of completeBundles) {
        const [planText, dotText] = await Promise.all([
          readFileText(row.planFile!),
          readFileText(row.dotFile!),
        ]);
        try {
          planDotBundles.push({
            plan: JSON.parse(planText),
            dotText,
            label: row.label.trim() || row.planFile!.name,
          });
        } catch {
          throw new Error(
            `Plan file "${row.planFile!.name}" must be valid JSON.`,
          );
        }
      }

      const states: unknown[] = [];
      const stateLabels: string[] = [];
      for (const file of stateFiles) {
        const parsed = parseRawStateJson(await readFileText(file));
        if (!parsed.ok) {
          throw new Error(`${file.name}: ${parsed.error}`);
        }
        states.push(parsed.state);
        stateLabels.push(file.name);
      }

      const tfdTexts = await Promise.all(tfdFiles.map((f) => readFileText(f)));
      const tfdLabels = tfdFiles.map((f) => f.name);

      await runImportFromSources(
        {
          planDotBundles,
          states,
          stateLabels,
          tfdTexts,
          tfdLabels,
        },
        { importedTfdTexts: tfdTexts },
      );
    } catch (err) {
      console.error("Import error:", err);
      onImportFail?.();
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
      setLayoutProgress(null);
      layoutAbortRef.current = null;
    }
  };

  const handleLoadPresetAndImport = async () => {
    const preset = selectedPreset ?? activePreset;
    if (!preset) {
      return;
    }
    layoutAbortRef.current?.abort();
    layoutAbortRef.current = new AbortController();
    setLoading(true);
    setLayoutProgress(null);
    setError(null);
    setImportWarnings(null);
    setPresetWarnings([]);
    setImportDone(false);
    setRcllV2Degraded(null);
    try {
      const {
        importWarnings: warnings,
        presetSources,
        rcllV2Degraded: degraded,
      } = await runTerraformPresetImport(app, setAppState, preset, {
        view,
        moduleLayoutOptions,
        pipelineCompact,
        pipelineLayoutVariant,
        pipelinePacked,
        pipelinePackedPullLeft,
        pipelineIncludeAncillary,
        pipelineSemanticPlacement,
        pipelineSwimlaneLaneRise,
        pipelineReorder,
        pipelineCrossingMin,
        pipelineDeBandLevel,
        pipelineRankSeparate,
        pipelineStraighten,
        pipelineCoordRepack,
        pipelineColumnPacking,
        pipelineStaircaseBandOverlap,
        strataNetworkSimplexRank,
        strataSweeps,
        strataCoordinateRefine,
        strataRankSeparate,
        strataPackedScoring,
        strataPackedScoringEpsilon,
        strataPackedConverge,
        strataTransitiveAdopt,
        strataBlockClamp,
        strataTranspose,
        strataHeightGate,
        strataEdgeRouting,
        strataBorderRoute,
        strataBandDepth,
        // Keep this handler's strata option shape identical to the regular
        // preset-import path above: the sift/sink-pull-in operators consume
        // these weights + cap, so dropping them here would make the same UI
        // state adopt differently between the two import buttons.
        strataSiftRelocate,
        strataCrossWeightPenetration,
        strataCrossWeightEdge,
        ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
        signal: layoutAbortRef.current?.signal,
        onLayoutProgress: (p) => {
          const label =
            p.total > 0 ? `${p.phase} (${p.done}/${p.total})` : p.phase;
          setLayoutProgress(label);
        },
      });
      completeImport(warnings, presetSources.warnings, degraded ?? null);
    } catch (err) {
      console.error("Preset import error:", err);
      onImportFail?.();
      setError(err instanceof Error ? err.message : "Preset import failed");
    } finally {
      setLoading(false);
      setLayoutProgress(null);
      layoutAbortRef.current = null;
    }
  };

  const handleSaveAsPreset = async () => {
    const nameInput = window.prompt("Preset name");
    if (!nameInput) {
      return;
    }
    const presetName = nameInput.trim();
    if (!presetName) {
      return;
    }
    const rootPathInput = window.prompt(
      "Preset root path",
      selectedPreset?.rootPath ||
        "packages/backend/terraform/staging-multi-state",
    );
    if (!rootPathInput) {
      return;
    }
    const presetId = toPresetId(presetName);
    if (!presetId) {
      setError("Preset name must contain letters or numbers.");
      return;
    }
    try {
      const preset = await buildPresetPayload(
        presetId,
        presetName,
        rootPathInput.trim(),
      );
      await saveTerraformImportPreset(preset);
      setSelectedPresetId(preset.id);
      await refreshPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preset.");
    }
  };

  const handleUpdatePreset = async () => {
    if (!selectedPreset || selectedPreset.builtin) {
      return;
    }
    try {
      const updated = await buildPresetPayload(
        selectedPreset.id,
        selectedPreset.name,
        selectedPreset.rootPath,
      );
      await updateTerraformImportPreset(selectedPreset.id, updated);
      await refreshPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update preset.");
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset || selectedPreset.builtin) {
      return;
    }
    const confirmed = window.confirm(`Delete preset "${selectedPreset.name}"?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteTerraformImportPreset(selectedPreset.id);
      setSelectedPresetId(BUILTIN_TERRAFORM_IMPORT_PRESETS[0]?.id ?? "");
      setActivePreset(null);
      await refreshPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete preset.");
    }
  };

  const handleUsePresetManifest = () => {
    if (!selectedPreset) {
      return;
    }
    setActivePreset(selectedPreset);
    setView(selectedPreset.view);
    setError(null);
  };

  const handleClearPresetManifest = () => {
    setActivePreset(null);
  };

  const handleSyncPresetFromDisk = async () => {
    if (!selectedPreset) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await syncTerraformImportPresetFromDiskViaApi(selectedPreset.id);
      await refreshPresets();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sync preset from disk.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChoosePresetFolder = async () => {
    try {
      await chooseTerraformImportPresetRootDirectory();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to choose preset folder.",
      );
    }
  };

  const handleRegisterArtifact = async () => {
    if (!artifactUploadFile || !artifactRelativePath.trim()) {
      setError(
        "Choose a file and enter repoName/relativePath for the artifact.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await saveTerraformImportArtifactViaApi({
        repoName: artifactRepoName.trim() || "my-infra",
        relativePath: artifactRelativePath.trim(),
        kind: artifactKind,
        content: await readFileText(artifactUploadFile),
      });
      setArtifactUploadFile(null);
      setArtifactRelativePath("");
      await refreshArtifacts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to register artifact.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveComposition = async () => {
    const nameInput = window.prompt("Composition name");
    if (!nameInput?.trim()) {
      return;
    }
    if (tfdFiles.length === 0) {
      setError("Upload at least one .tfd file to save as a composition.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tfdContent = await readFileText(tfdFiles[0]!);
      await saveTerraformImportCompositionViaApi({
        id: toPresetId(nameInput),
        name: nameInput.trim(),
        defaultView: view,
        tfdContent,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save composition.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Shareable `/demo?…` URL that round-trips the current preset + layout settings, so a
  // configured scene can be reproduced (or handed off) from the URL alone. Only preset-backed
  // imports are encodable — uploaded files have no stable URL — so it is null without a preset.
  const demoSettingsUrl = useMemo(() => {
    if (!selectedPresetId) {
      return null;
    }
    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;
    return buildTerraformDemoUrlFromSettings(
      {
        presetId: selectedPresetId,
        view,
        pipelineCompact,
        pipelineLayoutVariant,
        pipelinePacked,
        pipelinePackedPullLeft,
        pipelineIncludeAncillary,
        // Strata exposes a toggle for this (default ON); the share URL round-
        // trips its current state. The strata serialize branch emits it in both
        // states so an explicit OFF survives share→reload. For non-strata views
        // it stays truthy-only downstream and the engine ignores it anyway.
        pipelinePrivateApiRegional,
        pipelineSemanticPlacement,
        pipelineSwimlaneLaneRise,
        pipelineReorder,
        pipelineCrossingMin,
        pipelineDeBandLevel,
        pipelineRankSeparate,
        pipelineStraighten,
        pipelineCoordRepack,
        pipelineColumnPacking,
        pipelineLayoutProfile,
        pipelineStaircaseBandOverlap,
        strataNetworkSimplexRank,
        strataSweeps,
        strataCoordinateRefine,
        strataRankSeparate,
        strataPackedScoring,
        strataPackedScoringEpsilon,
        strataPackedConverge,
        strataTransitiveAdopt,
        strataBlockClamp,
        strataTranspose,
        strataHeightGate,
        strataEdgeRouting,
        strataBorderRoute,
        // Legacy alias field on `TerraformDemoSettingsSnapshot` — the UI writes
        // the band-depth cut exclusively via `strataBandDepth` below; always
        // false so a new share URL never re-emits the old `strataBandCompact`
        // param (the required-legacy-field snapshot shape is unchanged here).
        strataBandCompact: false,
        strataBandDepth,
        strataSiftRelocate,
        strataCrossWeightPenetration,
        strataCrossWeightEdge,
        strataEdgeCrossCap,
        moduleLayoutMode: moduleLayoutOptions.mode,
      },
      { origin },
    );
  }, [
    selectedPresetId,
    view,
    pipelineCompact,
    pipelineLayoutVariant,
    pipelinePacked,
    pipelinePackedPullLeft,
    pipelineIncludeAncillary,
    pipelinePrivateApiRegional,
    pipelineSemanticPlacement,
    pipelineSwimlaneLaneRise,
    pipelineReorder,
    pipelineCrossingMin,
    pipelineDeBandLevel,
    pipelineRankSeparate,
    pipelineStraighten,
    pipelineCoordRepack,
    pipelineColumnPacking,
    pipelineLayoutProfile,
    pipelineStaircaseBandOverlap,
    strataNetworkSimplexRank,
    strataSweeps,
    strataCoordinateRefine,
    strataRankSeparate,
    strataPackedScoring,
    strataPackedScoringEpsilon,
    strataPackedConverge,
    strataTransitiveAdopt,
    strataBlockClamp,
    strataTranspose,
    strataHeightGate,
    strataEdgeRouting,
    strataBorderRoute,
    strataBandDepth,
    strataSiftRelocate,
    strataCrossWeightPenetration,
    strataCrossWeightEdge,
    strataEdgeCrossCap,
    moduleLayoutOptions.mode,
  ]);

  return {
    bundles,
    stateFiles,
    tfdFiles,
    view,
    pipelineCompact,
    pipelineLayoutVariant,
    pipelinePacked,
    pipelinePackedPullLeft,
    pipelineIncludeAncillary,
    pipelinePrivateApiRegional,
    pipelineSemanticPlacement,
    pipelineSwimlaneLaneRise,
    pipelineReorder,
    pipelineCrossingMin,
    pipelineDeBandLevel,
    pipelineRankSeparate,
    pipelineStraighten,
    pipelineCoordRepack,
    pipelineColumnPacking,
    pipelineLayoutProfile,
    pipelineStaircaseBandOverlap,
    strataNetworkSimplexRank,
    strataSweeps,
    strataCoordinateRefine,
    strataRankSeparate,
    strataPackedScoring,
    strataPackedScoringEpsilon,
    strataPackedConverge,
    strataTransitiveAdopt,
    strataBlockClamp,
    strataTranspose,
    strataHeightGate,
    strataEdgeRouting,
    strataBorderRoute,
    strataBandDepth,
    strataSiftRelocate,
    strataCrossWeightPenetration,
    strataCrossWeightEdge,
    strataEdgeCrossCap,
    moduleLayoutOptions,
    loading,
    layoutProgress,
    error,
    importWarnings,
    importDone,
    rcllV2Degraded,
    selectedPresetId,
    presetWarnings,
    availablePresets,
    presetsLoading,
    activePreset,
    artifacts,
    artifactsLoading,
    artifactRepoName,
    artifactRelativePath,
    artifactKind,
    artifactUploadFile,
    selectedPreset,
    demoSettingsUrl,
    canImport,
    canUseSemanticView,
    semanticViewDisabled,
    usingPresetManifest,
    stateOnly,
    setStateFiles,
    setTfdFiles,
    setView: handleSetView,
    setPipelineCompact,
    setPipelineLayoutVariant,
    setPipelinePacked,
    setPipelinePackedPullLeft,
    setPipelineIncludeAncillary,
    setPipelinePrivateApiRegional,
    setPipelineSemanticPlacement,
    // The RCLL-flag setters are the "custom"-marking wrappers, so any Advanced edit
    // flips the primary Layout control to "Custom" (the raw setters stay internal).
    setPipelineSwimlaneLaneRise: setPipelineSwimlaneLaneRiseCustom,
    setPipelineReorder: setPipelineReorderCustom,
    setPipelineCrossingMin: setPipelineCrossingMinCustom,
    setPipelineDeBandLevel: setPipelineDeBandLevelCustom,
    setPipelineRankSeparate: setPipelineRankSeparateCustom,
    setPipelineStraighten: setPipelineStraightenCustom,
    setPipelineCoordRepack: setPipelineCoordRepackCustom,
    setPipelineColumnPacking: setPipelineColumnPackingCustom,
    setPipelineStaircaseBandOverlap: setPipelineStaircaseBandOverlapCustom,
    setPipelineLayoutProfile: applyPipelineLayoutProfile,
    setStrataNetworkSimplexRank,
    setStrataSweeps,
    setStrataCoordinateRefine,
    setStrataRankSeparate,
    setStrataPackedScoring,
    setStrataPackedScoringEpsilon,
    setStrataPackedConverge,
    setStrataTransitiveAdopt,
    setStrataBlockClamp,
    setStrataTranspose,
    setStrataHeightGate,
    setStrataEdgeRouting,
    setStrataBorderRoute,
    setStrataBandDepth,
    setStrataSiftRelocate,
    setStrataCrossWeightPenetration,
    setStrataCrossWeightEdge,
    setStrataEdgeCrossCap,
    setModuleLayoutOptions,
    setSelectedPresetId,
    setArtifactRepoName,
    setArtifactRelativePath,
    setArtifactKind,
    setArtifactUploadFile,
    updateBundle,
    addBundle,
    removeBundle,
    handleImport,
    handleLoadPresetAndImport,
    handleSaveAsPreset,
    handleUpdatePreset,
    handleDeletePreset,
    handleUsePresetManifest,
    handleClearPresetManifest,
    handleSyncPresetFromDisk,
    handleChoosePresetFolder,
    handleRegisterArtifact,
    handleSaveComposition,
  };
};
