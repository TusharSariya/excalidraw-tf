import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

import { useApp, useExcalidrawSetAppState } from "./App";
import {
  isDemoPathname,
  parseTerraformDemoUrlParams,
  resolveTerraformFocusSettingsFromDemoParams,
  type TerraformDemoUrlParams,
} from "./terraformDemoUrlParams";
import { getTerraformImportPreset } from "./terraformImportPresets";
import {
  resolveModuleLayoutOptionsForDemo,
  runTerraformPresetImport,
} from "./terraformPresetImport";
import { patchTerraformRuntimePerformanceSettings } from "./terraformRuntimePerformance";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import {
  reconcileTerraformVisibility,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";
import {
  updateTerraformImportSessionLodEnabled,
  updateTerraformImportSessionLodPreset,
  updateTerraformImportSessionMinimapEnabled,
} from "./terraformImportSession";

import "./TerraformDemoAutoImport.scss";

import type { AppClassProperties, AppState } from "../types";
import type { TerraformView } from "./terraformImportDialogUtils";

type TerraformDemoAutoImportProps = {
  onImportSuccess?: () => void;
  onImportFail?: () => void;
};

/**
 * Apply the runtime view settings carried by a canvas-share URL once the scene is imported:
 * LOD/minimap/pins land in AppState (and the import session, so re-sharing stays faithful),
 * edge-layer pins additionally drive a visibility reconcile, and the dev canvas-performance
 * experiments patch their (localStorage-backed, dev-only) store.
 */
const applyCanvasViewSettings = (
  app: AppClassProperties,
  setAppState: ReturnType<typeof useExcalidrawSetAppState>,
  params: TerraformDemoUrlParams,
): void => {
  // Only the keys the URL carried — cast past the setter's non-partial `Pick` signature
  // (React merges the provided keys, leaving the rest untouched).
  const appStatePatch = {
    ...(params.lodEnabled !== undefined
      ? { terraformLodEnabled: params.lodEnabled }
      : {}),
    ...(params.lodPreset !== undefined
      ? { terraformLodPreset: params.lodPreset }
      : {}),
    ...(params.minimap !== undefined
      ? { terraformMinimapEnabled: params.minimap }
      : {}),
    // NOTE: `terraformEdgeLayerPins` is browser-persisted too and only patched
    // when the URL carries `layers=…`, so a recipient's stale non-default pins
    // survive a "default" share URL — the same staleness the focus pair fixes
    // below (W11 F2). Left as-is deliberately: changing pins behavior is out
    // of scope for W11 (see w11 diff-review disposition F2).
    ...(params.edgeLayerPins
      ? { terraformEdgeLayerPins: params.edgeLayerPins }
      : {}),
    // W11 F2 — ALWAYS set the focus pair: the share codec omits defaults, and
    // both fields are browser-persisted, so an omitted param must be applied
    // as the explicit default ("both" / null) rather than leaving a stale
    // persisted non-default value in place. Infinity → the JSON-safe -1
    // sentinel inside the helper.
    ...resolveTerraformFocusSettingsFromDemoParams(params),
  };
  if (Object.keys(appStatePatch).length > 0) {
    setAppState(appStatePatch as Pick<AppState, keyof typeof appStatePatch>);
  }

  if (params.lodEnabled !== undefined) {
    updateTerraformImportSessionLodEnabled(params.lodEnabled);
  }
  if (params.lodPreset !== undefined) {
    updateTerraformImportSessionLodPreset(params.lodPreset);
  }
  if (params.minimap !== undefined) {
    updateTerraformImportSessionMinimapEnabled(params.minimap);
  }

  // Edge-layer pins only take visual effect once visibility is reconciled against the
  // freshly-imported elements (same path the "Terraform layers" menu uses).
  if (params.edgeLayerPins) {
    const allElements = app.scene.getElementsIncludingDeleted();
    app.scene.replaceAllElements(
      reconcileTerraformVisibility(repairTerraformEdgeBindings(allElements), {
        pins: params.edgeLayerPins,
        hoverPeekKey: null,
      }),
    );
  }

  if (params.runtimePerformance) {
    patchTerraformRuntimePerformanceSettings(params.runtimePerformance);
  }
};

type DemoImportStatus = "idle" | "loading" | "error";

export const TerraformDemoAutoImport = ({
  onImportSuccess,
  onImportFail,
}: TerraformDemoAutoImportProps) => {
  const app = useApp();
  const setAppState = useExcalidrawSetAppState();
  const layoutAbortRef = useRef<AbortController | null>(null);
  const startedForSearchRef = useRef<string | null>(null);
  const [status, setStatus] = useState<DemoImportStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  // Strata (rcll-v2) failure-contract fallback marker (v3.0 §8.4 / v3.1 §5). Not
  // yet emitted by any engine at S0a; wired ahead of the engine landing (W2).
  // Rendered independently of `status`/`message` so it survives past the
  // "loading…" message clearing on a successful import.
  const [rcllV2Degraded, setRcllV2Degraded] = useState<{
    stage: string;
    reason: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      layoutAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !isDemoPathname(window.location.pathname)
    ) {
      return;
    }

    const search = window.location.search;
    const params = parseTerraformDemoUrlParams(search);
    if (!params) {
      setStatus("idle");
      setMessage(null);
      return;
    }

    if (startedForSearchRef.current === search) {
      return;
    }
    startedForSearchRef.current = search;

    layoutAbortRef.current?.abort();
    layoutAbortRef.current = new AbortController();
    const { signal } = layoutAbortRef.current;

    const run = async () => {
      setStatus("loading");
      setMessage(`Loading preset "${params.presetId}"…`);
      setRcllV2Degraded(null);

      try {
        const preset = await getTerraformImportPreset(params.presetId);
        if (!preset) {
          throw new Error(`Preset "${params.presetId}" was not found.`);
        }

        const view: TerraformView = params.view ?? preset.view;
        const moduleLayoutOptions = resolveModuleLayoutOptionsForDemo(
          params.pack,
        );

        const { rcllV2Degraded: degraded } = await runTerraformPresetImport(
          app,
          setAppState,
          preset,
          {
            view,
            moduleLayoutOptions,
            pipelineCompact: params.compact,
            pipelineLayoutVariant: params.pipelineVariant,
            pipelinePacked: params.packed,
            pipelinePackedPullLeft: params.packedPullLeft,
            pipelineIncludeAncillary: params.ancillary,
            pipelinePrivateApiRegional: params.privateApiRegional,
            pipelineSemanticPlacement: params.semanticPlace,
            pipelineSwimlaneLaneRise: params.swimlaneRise,
            pipelineReorder: params.reorder,
            pipelineCrossingMin: params.crossingMin,
            pipelineDeBandLevel: params.deBandLevel,
            pipelineSubnetDeBand: params.subnetDeBand,
            pipelineRankSeparate: params.rankSeparate,
            pipelineStraighten: params.straighten,
            pipelineCoordRepack: params.coordRepack,
            pipelineDeDensify: params.deDensify,
            pipelineColumnPacking: params.columnPacking,
            pipelineLayoutProfile: params.profile,
            pipelineStaircaseBandOverlap: params.staircaseBandOverlap,
            // Absent strata params fall back to the SDEC-54 validated default
            // (K=4 + A7) — a bare `view=strata` URL must not regress to K=0.
            ...resolveStrataDemoOptions(params),
            signal,
            onLayoutProgress: (progress) => {
              const label =
                progress.total > 0
                  ? `${progress.phase} (${progress.done}/${progress.total})`
                  : progress.phase;
              setMessage(label);
            },
          },
        );
        setRcllV2Degraded(degraded ?? null);

        // Reapply the runtime view settings the share URL carried (LOD, minimap, edge
        // layers, dev canvas-performance) on top of the freshly-imported scene.
        applyCanvasViewSettings(app, setAppState, params);

        setStatus("idle");
        setMessage(null);
        onImportSuccess?.();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("Demo auto-import error:", err);
        onImportFail?.();
        setStatus("error");
        setMessage(
          err instanceof Error ? err.message : "Demo preset import failed.",
        );
      } finally {
        if (layoutAbortRef.current?.signal === signal) {
          layoutAbortRef.current = null;
        }
      }
    };

    void run();
  }, [app, onImportFail, onImportSuccess, setAppState]);

  return (
    <>
      {status !== "idle" && message && (
        <div
          className={clsx(
            "TerraformDemoAutoImport",
            status === "error" && "TerraformDemoAutoImport--error",
          )}
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </div>
      )}
      {rcllV2Degraded && (
        <div
          className="TerraformDemoAutoImport TerraformDemoAutoImport--degraded"
          role="status"
          aria-live="polite"
        >
          Strata fell back to v2 ({rcllV2Degraded.stage}):{" "}
          {rcllV2Degraded.reason}
        </div>
      )}
    </>
  );
};
