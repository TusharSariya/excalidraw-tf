import React from "react";

import { isLinearElement } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { OPTION_HELP } from "./TerraformImportPipelineSettings";

import { useExcalidrawElements } from "./App";

import type { OptionHelpKey } from "./TerraformImportPipelineSettings";
import type { StrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";

/** The five `customData.terraformRoutedBy` stamp classes, in the order the live
 * diagnostic lists them, each mapped to a plain word. Mirrors the five edge
 * stampers (the clip pass + the three routers + the style pass). `clip` runs
 * FIRST among all the edge passes, so it heads the list. */
const STRATA_ROUTED_BY_LABELS = {
  clip: "clipped",
  channel: "channels",
  route: "rerouted",
  border: "border exits",
  style: "styled",
} as const;

type StrataRoutedBy = keyof typeof STRATA_ROUTED_BY_LABELS;

/** One of the Routing segmented control's five one-hot presets, or the
 * transient "custom" state a composed URL (2+ routers on) lands in. */
type StrataRoutingPreset =
  | "off"
  | "flow"
  | "around"
  | "channels"
  | "border"
  | "custom";

/**
 * Derive the Routing control's active preset from the four raw router booleans
 * (the container-boundary clip pass + the three routers). The mapping is
 * ONE-HOT: exactly one router on ↔ one preset. Two or more on is a composed
 * combination no single preset represents → "custom" (only reachable from a
 * URL; picking any preset writes the one-hot booleans back). This is
 * presentation only — it reads the same booleans the URL/options already carry
 * and changes no semantics.
 */
const strataRoutingPreset = (
  edgeRouting: boolean,
  channelRoute: boolean,
  borderRoute: boolean,
  edgeClip: boolean,
): StrataRoutingPreset => {
  const active = [edgeRouting, channelRoute, borderRoute, edgeClip].filter(
    Boolean,
  ).length;
  if (active === 0) {
    return "off";
  }
  if (active >= 2) {
    return "custom";
  }
  if (edgeClip) {
    return "flow";
  }
  if (edgeRouting) {
    return "around";
  }
  if (channelRoute) {
    return "channels";
  }
  return "border";
};

/**
 * Live edge-reshape stats read straight off the current scene (never stored
 * meta): how many edge-layer arrows are declared vs. how many carry a real
 * reshaped polyline (`terraformRoutedPolyline === true` AND > 2 points),
 * grouped by the stampers' `terraformRoutedBy` provenance. Computed at render so
 * it always reflects the canvas as it is now.
 */
const computeStrataEdgeStats = (
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  let declared = 0;
  let reshaped = 0;
  const by: Record<StrataRoutedBy, number> = {
    clip: 0,
    channel: 0,
    route: 0,
    border: 0,
    style: 0,
  };
  for (const element of elements) {
    const customData = element.customData ?? {};
    // Only the declared dataflow layer is styleable — aggregated
    // topologyFrameFlow connectors (and other views' layers) are excluded by
    // design and would inflate the denominator into a false amber state.
    if (
      customData.terraformEdgeLayer !== "declaredDataFlow" ||
      element.isDeleted
    ) {
      continue;
    }
    declared += 1;
    if (
      customData.terraformRoutedPolyline === true &&
      isLinearElement(element) &&
      element.points.length > 2
    ) {
      reshaped += 1;
      const provenance: unknown = customData.terraformRoutedBy;
      if (
        provenance === "clip" ||
        provenance === "channel" ||
        provenance === "route" ||
        provenance === "border" ||
        provenance === "style"
      ) {
        by[provenance] += 1;
      }
    }
  }
  return { declared, reshaped, by };
};

/** A single segment of a `role="radiogroup"` segmented control. */
type StrataRadioSegment = {
  label: string;
  active: boolean;
  helpKey: OptionHelpKey;
  onSelect: () => void;
};

/**
 * The "Edge routing & style" section of {@link TerraformStrataSettings} — a
 * VISIBLE titled section (no longer a collapsed `<details>`). Style first, then
 * a Routing segmented control mapping ONE-HOT onto the three raw router booleans,
 * then a live scene diagnostic, then a DEV-only drawer that still exposes the raw
 * router toggles for composition. URL params and option semantics are unchanged
 * — this only changes how the same booleans are presented.
 *
 * Extracted from the parent (mirroring the "Height & packing" split) to keep that
 * file under the `max-lines` cap; the hover/sticky help state stays owned by the
 * parent (the help panel is shared), so the parent passes its `option` factory
 * plus the two setters down.
 */
export const TerraformStrataSettingsEdges = ({
  option,
  setHoverKey,
  setStickyKey,
  strataEdgeRouting,
  strataBorderRoute,
  strataChannelRoute,
  strataEdgeClip,
  strataEdgeSmooth,
  strataEdgeStyle,
  setStrataEdgeRouting,
  setStrataBorderRoute,
  setStrataChannelRoute,
  setStrataEdgeClip,
  setStrataEdgeSmooth,
  setStrataEdgeStyle,
}: {
  /** The parent's segmented-button factory — a closure over its hover/sticky
   * help state, reused for the DEV drawer's binary toggles. */
  option: (
    label: string,
    pressed: boolean,
    helpKey: OptionHelpKey,
    onClick: () => void,
  ) => React.ReactNode;
  setHoverKey: (key: OptionHelpKey | null) => void;
  setStickyKey: (key: OptionHelpKey) => void;
  strataEdgeRouting: boolean;
  strataBorderRoute: boolean;
  strataChannelRoute: boolean;
  strataEdgeClip: boolean;
  /** Loop-3 E3.1 GLEE smoothing pass over stamped routed polylines —
   * composes with every Routing preset, so it is a raw toggle (no segment). */
  strataEdgeSmooth: boolean;
  strataEdgeStyle: StrataEdgeStyle;
  setStrataEdgeRouting: (edgeRouting: boolean) => void;
  setStrataBorderRoute: (borderRoute: boolean) => void;
  setStrataChannelRoute: (channelRoute: boolean) => void;
  setStrataEdgeClip: (edgeClip: boolean) => void;
  setStrataEdgeSmooth: (edgeSmooth: boolean) => void;
  setStrataEdgeStyle: (edgeStyle: StrataEdgeStyle) => void;
}) => {
  // Live scene for the edge diagnostic — the same non-deleted element array the
  // canvas renders (ExcalidrawElementsContext). Read at render so the stats
  // always reflect the current canvas; in isolation (tests) the context default
  // is [] → the pre-import state. Never a stored meta value.
  const sceneElements = useExcalidrawElements();
  const edgeStats = computeStrataEdgeStats(sceneElements);

  // Routing preset (one-hot view of the three raw router booleans) + the
  // composed-URL escape hatch. A URL can seed 2+ routers, which no single preset
  // represents; the "Custom" segment + banner let a non-DEV user keep or reset
  // that combination instead of dead-ending. Dismissed on Keep or on any preset.
  const routingPreset = strataRoutingPreset(
    strataEdgeRouting,
    strataChannelRoute,
    strataBorderRoute,
    strataEdgeClip,
  );
  const routingIsCustom = routingPreset === "custom";
  const [routingBannerDismissed, setRoutingBannerDismissed] =
    React.useState(false);
  const applyRoutingPreset = (
    preset: Exclude<StrataRoutingPreset, "custom">,
  ) => {
    // One-hot write — presentation only; URL/option semantics are unchanged.
    // Clip runs first and owns its edges; the three routers only see the rest,
    // so a single active flag is a faithful one-hot for every preset.
    setStrataEdgeClip(preset === "flow");
    setStrataEdgeRouting(preset === "around");
    setStrataChannelRoute(preset === "channels");
    setStrataBorderRoute(preset === "border");
    setRoutingBannerDismissed(true);
  };

  // Segmented control rendered as a proper `role="radiogroup"` (Style + Routing):
  // one selected radio at a time, roving tabindex, and ArrowLeft/Right (and
  // Up/Down) move BOTH selection and focus to the adjacent segment. Drives the
  // same shared hover/sticky help panel as `option`. Binary DEV toggles keep the
  // plain aria-pressed `option` factory (no roving focus) by design.
  const renderRadioGroup = (
    ariaLabel: string,
    labelContent: React.ReactNode,
    segments: readonly StrataRadioSegment[],
  ) => {
    const activeIndex = Math.max(
      0,
      segments.findIndex((segment) => segment.active),
    );
    const moveSelection = (
      event: React.KeyboardEvent<HTMLDivElement>,
      delta: number,
    ) => {
      event.preventDefault();
      const nextIndex =
        (activeIndex + delta + segments.length) % segments.length;
      const next = segments[nextIndex];
      if (!next) {
        return;
      }
      setStickyKey(next.helpKey);
      next.onSelect();
      const radios =
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        );
      radios[nextIndex]?.focus();
    };
    return (
      <div role="radiogroup" aria-label={ariaLabel}>
        <span className="TerraformImportModal__controlLabel">
          {labelContent}
        </span>
        <div
          className="TerraformImportModal__segmentedControl"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              moveSelection(event, 1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              moveSelection(event, -1);
            }
          }}
        >
          {segments.map((segment, index) => (
            <button
              key={segment.label}
              type="button"
              role="radio"
              aria-checked={segment.active}
              tabIndex={index === activeIndex ? 0 : -1}
              className={`TerraformImportModal__segmentedButton${
                segment.active
                  ? " TerraformImportModal__segmentedButton--active"
                  : ""
              }`}
              title={OPTION_HELP[segment.helpKey].body}
              onMouseEnter={() => setHoverKey(segment.helpKey)}
              onMouseLeave={() => setHoverKey(null)}
              onFocus={() => setHoverKey(segment.helpKey)}
              onBlur={() => setHoverKey(null)}
              onClick={() => {
                setStickyKey(segment.helpKey);
                segment.onSelect();
              }}
            >
              {segment.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const styleSegments: StrataRadioSegment[] = [
    {
      label: "Straight",
      active: strataEdgeStyle === "straight",
      helpKey: "strata.edgestyle.straight",
      onSelect: () => setStrataEdgeStyle("straight"),
    },
    {
      label: "Step",
      active: strataEdgeStyle === "step",
      helpKey: "strata.edgestyle.step",
      onSelect: () => setStrataEdgeStyle("step"),
    },
    {
      label: "Curve",
      active: strataEdgeStyle === "curve",
      helpKey: "strata.edgestyle.curve",
      onSelect: () => setStrataEdgeStyle("curve"),
    },
  ];

  const routingSegments: StrataRadioSegment[] = [
    {
      label: "Off",
      active: routingPreset === "off",
      helpKey: "strata.routing.off",
      onSelect: () => applyRoutingPreset("off"),
    },
    {
      label: "Flow",
      active: routingPreset === "flow",
      helpKey: "strata.routing.flow",
      onSelect: () => applyRoutingPreset("flow"),
    },
    {
      label: "Around boxes",
      active: routingPreset === "around",
      helpKey: "strata.routing.around",
      onSelect: () => applyRoutingPreset("around"),
    },
    {
      label: "Through channels",
      active: routingPreset === "channels",
      helpKey: "strata.routing.channels",
      onSelect: () => applyRoutingPreset("channels"),
    },
    {
      label: "Border exits",
      active: routingPreset === "border",
      helpKey: "strata.routing.border",
      onSelect: () => applyRoutingPreset("border"),
    },
  ];
  if (routingIsCustom) {
    // Transient 5th segment — only while the (URL-seeded) combination is custom.
    // Clicking it acknowledges (keeps) the combination; arrowing/picking any
    // preset replaces it via the one-hot write.
    routingSegments.push({
      label: "Custom",
      active: true,
      helpKey: "strata.routing.custom",
      onSelect: () => setRoutingBannerDismissed(true),
    });
  }

  // Honest live diagnostic (never a fabricated flattened count — the scene
  // can't prove by-design-straight vs. flattened post-hoc). Green when every
  // declared edge is reshaped or the style is Straight (nothing to reshape);
  // amber when fewer edges are reshaped than declared under a reshaping style.
  const { declared, reshaped, by } = edgeStats;
  const routersPresent = by.clip + by.channel + by.route + by.border > 0;
  let edgeDiagnostic: React.ReactNode;
  if (declared === 0) {
    edgeDiagnostic = (
      <div className="TerraformImportModal__edgeDiagnostic TerraformImportModal__edgeDiagnostic--muted">
        Edge stats appear after import
      </div>
    );
  } else {
    // Scene-derived ONLY — never the form selection (the line is labelled
    // "Current scene"; the controls describe the NEXT import). A scene that is
    // fully reshaped OR fully straight is healthy (green); a PARTIAL state is
    // the anomaly signal (amber) — that split is exactly what the repaired
    // flatten bug looked like.
    const verb = "reshaped";
    const green = reshaped === declared || reshaped === 0;
    let breakdown = "";
    if (routersPresent) {
      const parts: string[] = [];
      (["clip", "channel", "route", "border", "style"] as const).forEach(
        (key) => {
          if (by[key] > 0) {
            parts.push(`${by[key]} ${STRATA_ROUTED_BY_LABELS[key]}`);
          }
        },
      );
      const straight = declared - reshaped;
      if (straight > 0) {
        parts.push(`${straight} straight`);
      }
      if (parts.length > 0) {
        breakdown = ` (${parts.join(" · ")})`;
      }
    }
    edgeDiagnostic = (
      <div
        className={`TerraformImportModal__edgeDiagnostic${
          green ? "" : " TerraformImportModal__edgeDiagnostic--warn"
        }`}
        aria-live="polite"
      >
        <span
          className="TerraformImportModal__edgeDiagnosticDot"
          aria-hidden="true"
        />
        Current scene: {reshaped} of {declared} edges {verb}
        {breakdown}
      </div>
    );
  }

  return (
    <div className="TerraformImportModal__settingsSection">
      <div className="TerraformImportModal__settingsSectionHeader">
        Edge routing &amp; style
      </div>
      {routingIsCustom && !routingBannerDismissed && (
        <div
          className="TerraformImportModal__dependencyHint TerraformImportModal__routingCustomBanner"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">ⓘ</span>
          <span>This link uses a custom routing combination.</span>
          <button
            type="button"
            className="TerraformImportModal__dependencyHintAction"
            onClick={() => setRoutingBannerDismissed(true)}
          >
            Keep it
          </button>
          <button
            type="button"
            className="TerraformImportModal__dependencyHintAction"
            onClick={() => applyRoutingPreset("off")}
          >
            Reset to Off
          </button>
        </div>
      )}
      {renderRadioGroup(
        "Strata edge style",
        <>
          Style <span>reshape data-flow edges</span>
        </>,
        styleSegments,
      )}
      {renderRadioGroup(
        "Strata edge routing preset",
        <>
          Routing <span>send edges around or between cards</span>
        </>,
        routingSegments,
      )}
      {edgeDiagnostic}
      {/* DEV-only composition drawer: the four raw router toggles (and their
          coupling hints) that the one-hot Routing presets stand in for. Non-DEV
          users never see or need these — the presets + the Custom escape hatch
          cover every reachable combination. The help aside's technical
          "Implements"/refs block is likewise DEV-gated in the parent. */}
      {import.meta.env.DEV && (
        <details className="TerraformImportModal__advancedDisclosure TerraformImportModal__routingDevDrawer">
          <summary
            className="TerraformImportModal__advancedSummary"
            aria-label="Developer routing passes"
          >
            Developer: routing passes
          </summary>
          <div role="group" aria-label="Strata container-boundary clip">
            <span className="TerraformImportModal__controlLabel">
              Clip edges to container borders{" "}
              <span>
                terminate each cross-container arrow on the facing box borders
                (right-of-source → left-of-target), crossing walls straight-on
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option("Off", !strataEdgeClip, "strata.edgeclip.off", () =>
                setStrataEdgeClip(false),
              )}
              {option("On", strataEdgeClip, "strata.edgeclip.on", () =>
                setStrataEdgeClip(true),
              )}
            </div>
            {strataEdgeClip &&
              (strataEdgeRouting ||
                strataBorderRoute ||
                strataChannelRoute) && (
                <div className="TerraformImportModal__couplingHint">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Flow owns eligible edges; the other routers only see the
                    rest — clip runs first and stamps every eligible net-forward
                    cross-container edge, so they touch only what it leaves.
                  </span>
                </div>
              )}
          </div>
          <div role="group" aria-label="Strata edge routing">
            <span className="TerraformImportModal__controlLabel">
              Route edges around boxes{" "}
              <span>
                detour arrows that would tunnel through unrelated boxes
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option("Off", !strataEdgeRouting, "strata.edgerouting.off", () =>
                setStrataEdgeRouting(false),
              )}
              {option("On", strataEdgeRouting, "strata.edgerouting.on", () =>
                setStrataEdgeRouting(true),
              )}
            </div>
          </div>
          <div role="group" aria-label="Strata container-exit routing">
            <span className="TerraformImportModal__controlLabel">
              Exit containers through the nearest side{" "}
              <span>
                route an edge leaving its own container out the facing side
                instead of slashing diagonally across the interior
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option("Off", !strataBorderRoute, "strata.borderroute.off", () =>
                setStrataBorderRoute(false),
              )}
              {option("On", strataBorderRoute, "strata.borderroute.on", () =>
                setStrataBorderRoute(true),
              )}
            </div>
            {strataBorderRoute && strataEdgeRouting && (
              <div className="TerraformImportModal__couplingHint">
                <span aria-hidden="true">ⓘ</span>
                <span>
                  Composes with <strong>Route edges around boxes</strong> — they
                  rewrite disjoint edge sets (own-container exits vs detours
                  around unrelated boxes) and run in sequence.
                </span>
              </div>
            )}
          </div>
          <div role="group" aria-label="Strata channel routing">
            <span className="TerraformImportModal__controlLabel">
              Route edges through inter-rank channels{" "}
              <span>
                the owner's dummy-column idea: send each cross-rank arrow out a
                perpendicular stub, down a vertical track in the gap between
                columns, then into its target — Manhattan geometry instead of
                shallow diagonals
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option(
                "Off",
                !strataChannelRoute,
                "strata.channelroute.off",
                () => setStrataChannelRoute(false),
              )}
              {option("On", strataChannelRoute, "strata.channelroute.on", () =>
                setStrataChannelRoute(true),
              )}
            </div>
            {strataChannelRoute && (strataEdgeRouting || strataBorderRoute) && (
              <div className="TerraformImportModal__couplingHint">
                <span aria-hidden="true">ⓘ</span>
                <span>
                  Runs first and owns the polyline topology — the other routers
                  only touch edges it left as chords.
                </span>
              </div>
            )}
          </div>
          <div role="group" aria-label="Strata edge smoothing">
            <span className="TerraformImportModal__controlLabel">
              Smooth routed edges{" "}
              <span>
                Smooths routed edges: rounds corners, straightens kinks, and
                draws exactly the computed path.
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option("Off", !strataEdgeSmooth, "strata.edgesmooth.off", () =>
                setStrataEdgeSmooth(false),
              )}
              {option("On", strataEdgeSmooth, "strata.edgesmooth.on", () =>
                setStrataEdgeSmooth(true),
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
};

TerraformStrataSettingsEdges.displayName = "TerraformStrataSettingsEdges";
