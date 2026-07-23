import React from "react";

import { isLinearElement } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { OPTION_HELP } from "./TerraformImportPipelineSettings";

import { useExcalidrawElements } from "./App";

import type { OptionHelpKey } from "./TerraformImportPipelineSettings";
import type { StrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";

/** The `customData.terraformRoutedBy` stamp classes the live diagnostic lists,
 * each mapped to a plain word. `clip` returns with the box-endpoints milestone;
 * `style` is the edge-style pass. */
const STRATA_ROUTED_BY_LABELS = {
  clip: "clipped",
  style: "styled",
} as const;

type StrataRoutedBy = keyof typeof STRATA_ROUTED_BY_LABELS;

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
      if (provenance === "clip" || provenance === "style") {
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
 * The "Edge style & spacing" section of {@link TerraformStrataSettings} — a
 * VISIBLE titled section: the Style segmented control (reshape data-flow edges),
 * the two Spacing segmented controls (Column gap / Row gap), then a live scene
 * diagnostic. URL params and option semantics are unchanged — this only changes
 * how the same options are presented.
 *
 * Extracted from the parent (mirroring the "Height & packing" split) to keep that
 * file under the `max-lines` cap; the hover/sticky help state stays owned by the
 * parent (the help panel is shared), so the parent passes its two setters down.
 */
export const TerraformStrataSettingsEdges = ({
  setHoverKey,
  setStickyKey,
  strataEdgeStyle,
  strataBoxEndpoints,
  strataColumnGap,
  strataRowGap,
  setStrataEdgeStyle,
  setStrataBoxEndpoints,
  setStrataColumnGap,
  setStrataRowGap,
}: {
  setHoverKey: (key: OptionHelpKey | null) => void;
  setStickyKey: (key: OptionHelpKey) => void;
  strataEdgeStyle: StrataEdgeStyle;
  /** M5 box-endpoint anchoring: OFF ⇒ endpoints on the resource card, ON ⇒ on
   * the labeled leaf-cluster frame border. */
  strataBoxEndpoints: boolean;
  /** E3.3 inter-column gutter override (px). `undefined` ⇒ default (150). */
  strataColumnGap: number | undefined;
  /** E3.3 row-gap scale factor. `undefined` ⇒ default (1). */
  strataRowGap: number | undefined;
  setStrataEdgeStyle: (edgeStyle: StrataEdgeStyle) => void;
  setStrataBoxEndpoints: (boxEndpoints: boolean) => void;
  /** E3.3 — `undefined` clears back to the default gap. */
  setStrataColumnGap: (columnGap: number | undefined) => void;
  /** E3.3 — `undefined` clears back to the default factor. */
  setStrataRowGap: (rowGap: number | undefined) => void;
}) => {
  // Live scene for the edge diagnostic — the same non-deleted element array the
  // canvas renders (ExcalidrawElementsContext). Read at render so the stats
  // always reflect the current canvas; in isolation (tests) the context default
  // is [] → the pre-import state. Never a stored meta value.
  const sceneElements = useExcalidrawElements();
  const edgeStats = computeStrataEdgeStats(sceneElements);

  // Segmented control rendered as a proper `role="radiogroup"` (Style + Spacing):
  // one selected radio at a time, roving tabindex, and ArrowLeft/Right (and
  // Up/Down) move BOTH selection and focus to the adjacent segment. Drives the
  // same shared hover/sticky help panel as the parent's `option` factory.
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
      label: "Curve",
      active: strataEdgeStyle === "curve",
      helpKey: "strata.edgestyle.curve",
      onSelect: () => setStrataEdgeStyle("curve"),
    },
  ];

  // M5 box-endpoint anchoring — a one-hot boolean segmented control (mirrors the
  // Style row). "Resource" is OFF (endpoints on the card, today's default);
  // "Box" is ON (endpoints on the labeled leaf-cluster frame border). Inert until
  // M6 wires the geometry; the value still threads through every seam meanwhile.
  const endpointsSegments: StrataRadioSegment[] = [
    {
      label: "Resource",
      active: !strataBoxEndpoints,
      helpKey: "strata.endpoints.resource",
      onSelect: () => setStrataBoxEndpoints(false),
    },
    {
      label: "Box",
      active: strataBoxEndpoints,
      helpKey: "strata.endpoints.box",
      onSelect: () => setStrataBoxEndpoints(true),
    },
  ];

  // E3.3 Spacing — two independent one-hot segmented controls. Each writes the
  // NUMERIC option (or clears to undefined for "Default"). The active segment is
  // derived from the current value; a URL-seeded off-preset value simply lands on
  // none-active (Default reads active as the fallback) but still applies — the
  // controls describe the NEXT import, the value keeps threading regardless.
  const columnGapSegments: StrataRadioSegment[] = [
    {
      label: "Default 150",
      active: strataColumnGap === undefined,
      helpKey: "strata.spacing.columngap.default",
      onSelect: () => setStrataColumnGap(undefined),
    },
    {
      label: "Wide 200",
      active: strataColumnGap === 200,
      helpKey: "strata.spacing.columngap.wide",
      onSelect: () => setStrataColumnGap(200),
    },
    {
      label: "Extra 250",
      active: strataColumnGap === 250,
      helpKey: "strata.spacing.columngap.extra",
      onSelect: () => setStrataColumnGap(250),
    },
  ];
  const rowGapSegments: StrataRadioSegment[] = [
    {
      label: "Default",
      active: strataRowGap === undefined,
      helpKey: "strata.spacing.rowgap.default",
      onSelect: () => setStrataRowGap(undefined),
    },
    {
      label: "1.25×",
      active: strataRowGap === 1.25,
      helpKey: "strata.spacing.rowgap.wide",
      onSelect: () => setStrataRowGap(1.25),
    },
    {
      label: "1.5×",
      active: strataRowGap === 1.5,
      helpKey: "strata.spacing.rowgap.extra",
      onSelect: () => setStrataRowGap(1.5),
    },
  ];

  // Honest live diagnostic (never a fabricated flattened count — the scene
  // can't prove by-design-straight vs. flattened post-hoc). Green when every
  // declared edge is reshaped or the style is Straight (nothing to reshape);
  // amber when fewer edges are reshaped than declared under a reshaping style.
  const { declared, reshaped, by } = edgeStats;
  const clippedPresent = by.clip > 0;
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
    if (clippedPresent) {
      const parts: string[] = [];
      (["clip", "style"] as const).forEach((key) => {
        if (by[key] > 0) {
          parts.push(`${by[key]} ${STRATA_ROUTED_BY_LABELS[key]}`);
        }
      });
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
        Edge style &amp; spacing
      </div>
      {renderRadioGroup(
        "Strata edge style",
        <>
          Style <span>reshape data-flow edges</span>
        </>,
        styleSegments,
      )}
      {renderRadioGroup(
        "Strata edge endpoints",
        <>
          Endpoints <span>where data-flow edges terminate</span>
        </>,
        endpointsSegments,
      )}
      {renderRadioGroup(
        "Strata column gap",
        <>
          Column gap <span>widen the gutters between columns for arrows</span>
        </>,
        columnGapSegments,
      )}
      {renderRadioGroup(
        "Strata row gap",
        <>
          Row gap <span>widen the vertical space between stacked cards</span>
        </>,
        rowGapSegments,
      )}
      {edgeDiagnostic}
    </div>
  );
};

TerraformStrataSettingsEdges.displayName = "TerraformStrataSettingsEdges";
