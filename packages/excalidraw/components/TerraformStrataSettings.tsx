import React from "react";

import {
  OPTION_HELP,
  type OptionHelpKey,
} from "./TerraformImportPipelineSettings";

/**
 * Strata (rcll-v2) view settings — WP-4-UI.
 *
 * A dedicated, focused sibling of {@link TerraformImportPipelineSettings}
 * (mirrors how `view === "module"` gets its own `TerraformModulePackingSettings`
 * rather than being crammed into the rcll/pipeline component): Strata's option
 * set is small and has nothing to do with the rcll/pipeline levers that
 * component owns (columnPacking, laneSplit, deBand, …), so reusing it would
 * mean either passing ~30 irrelevant pipeline props at the mount site or
 * making that component's whole prop surface optional. Instead this component
 * imports the SAME `OPTION_HELP` map (so the two new entries live in one
 * canonical explanation dictionary) and reuses the same segmented-button
 * toggle primitive + hover/sticky help-panel pattern, scoped to just the two
 * engine passes exposed so far.
 *
 * All three toggles are opt-in, default OFF (`useTerraformImportDialog.ts`
 * seeds `strataSweeps = 0` / `strataCoordinateRefine = false` /
 * `strataRankSeparate = false`) — this component only renders the control; it
 * does not change any default.
 *
 * Future OD-15 ("de-band") strata toggle lands as an additional `role="group"`
 * block in the same `__layoutSettingsGrid`, below the three here.
 */
export const TerraformStrataSettings = ({
  strataSweeps,
  strataCoordinateRefine,
  strataRankSeparate,
  setStrataSweeps,
  setStrataCoordinateRefine,
  setStrataRankSeparate,
}: {
  strataSweeps: number;
  strataCoordinateRefine: boolean;
  strataRankSeparate: boolean;
  setStrataSweeps: (sweeps: number) => void;
  setStrataCoordinateRefine: (coordinateRefine: boolean) => void;
  setStrataRankSeparate: (rankSeparate: boolean) => void;
}) => {
  const [hoverKey, setHoverKey] = React.useState<OptionHelpKey | null>(null);
  const [stickyKey, setStickyKey] = React.useState<OptionHelpKey>(
    strataSweeps === 4 ? "strata.ordering.on" : "strata.ordering.off",
  );
  const activeKey = hoverKey ?? stickyKey;
  const activeHelp = OPTION_HELP[activeKey];

  const option = (
    label: string,
    pressed: boolean,
    helpKey: OptionHelpKey,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className={`TerraformImportModal__segmentedButton${
        pressed ? " TerraformImportModal__segmentedButton--active" : ""
      }`}
      aria-pressed={pressed}
      title={OPTION_HELP[helpKey].body}
      onMouseEnter={() => setHoverKey(helpKey)}
      onMouseLeave={() => setHoverKey(null)}
      onFocus={() => setHoverKey(helpKey)}
      onBlur={() => setHoverKey(null)}
      onClick={() => {
        setStickyKey(helpKey);
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="TerraformImportModal__layoutSettings">
      <div className="TerraformImportModal__layoutSettingsHeader">
        <strong>Strata settings</strong>
        <span>Opt-in passes for the next-gen compound layout (rcll-v2).</span>
      </div>
      <div className="TerraformImportModal__layoutSettingsBody">
        <div className="TerraformImportModal__layoutSettingsGrid">
          <div role="group" aria-label="Strata layer ordering">
            <span className="TerraformImportModal__controlLabel">
              Layer ordering{" "}
              <span>reorder bands to cut edge crossings (K=4)</span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option("Off", strataSweeps !== 4, "strata.ordering.off", () =>
                setStrataSweeps(0),
              )}
              {option("On", strataSweeps === 4, "strata.ordering.on", () =>
                setStrataSweeps(4),
              )}
            </div>
          </div>
          <div role="group" aria-label="Strata straighten">
            <span className="TerraformImportModal__controlLabel">
              Straighten (A7){" "}
              <span>nudge containers vertically so edges run straighter</span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option(
                "Off",
                !strataCoordinateRefine,
                "strata.straighten.off",
                () => setStrataCoordinateRefine(false),
              )}
              {option(
                "On",
                strataCoordinateRefine,
                "strata.straighten.on",
                () => setStrataCoordinateRefine(true),
              )}
            </div>
          </div>
          <div role="group" aria-label="Strata compact height">
            <span className="TerraformImportModal__controlLabel">
              Compact height{" "}
              <span>
                separate sibling stacks to shorten the canvas (rankSeparate)
              </span>
            </span>
            <div className="TerraformImportModal__segmentedControl">
              {option(
                "Off",
                !strataRankSeparate,
                "strata.rankseparate.off",
                () => setStrataRankSeparate(false),
              )}
              {option("On", strataRankSeparate, "strata.rankseparate.on", () =>
                setStrataRankSeparate(true),
              )}
            </div>
          </div>
          {/* Future: OD-15 "de-band" toggle lands here as an additional
              role="group" block in this same grid. */}
        </div>
        <aside
          className="TerraformImportModal__layoutHelp"
          aria-live="polite"
          aria-label="Option explanation"
        >
          <strong className="TerraformImportModal__layoutHelpTitle">
            {activeHelp.title}
          </strong>
          <p className="TerraformImportModal__layoutHelpBody">
            {activeHelp.body}
          </p>
          <div className="TerraformImportModal__layoutHelpDev">
            <span className="TerraformImportModal__layoutHelpDevLabel">
              Implements
            </span>
            <span className="TerraformImportModal__layoutHelpDevText">
              {activeHelp.dev.implements}
            </span>
            {activeHelp.dev.refs && activeHelp.dev.refs.length > 0 && (
              <span className="TerraformImportModal__layoutHelpDevRefs">
                {activeHelp.dev.refs.join(" · ")}
              </span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

TerraformStrataSettings.displayName = "TerraformStrataSettings";
