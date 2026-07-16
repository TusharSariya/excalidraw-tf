import React from "react";

import {
  OPTION_HELP,
  type OptionHelpKey,
} from "./TerraformImportPipelineSettings";

import type { StrataHullRole } from "./terraformPipelineStrataTypes";

/** Depth order for the band-depth slider, shallowest (root, always banded) to
 * deepest (subnetZone, always packed) — the slider's index domain. UI-local
 * mirror of the engine's `StrataHullRole` depth order (no runtime import of
 * the engine module needed; the type import above is type-only). */
export const STRATA_BAND_DEPTH_ORDER: readonly StrataHullRole[] = [
  "root",
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
];

const STRATA_BAND_DEPTH_LABELS: Record<StrataHullRole, string> = {
  root: "Root",
  provider: "Provider",
  account: "Account",
  region: "Region",
  vpc: "VPC",
  subnetZone: "Zone",
};

/** Deep cuts (index >= this) are the experimental, "usually wider" stops. */
const STRATA_BAND_DEPTH_EXPERIMENTAL_FROM = 3; // region

/** One-line, per-role live description of what the current band-depth cut does,
 * keyed by the deepest role that stays a full-width band. */
const STRATA_BAND_DEPTH_READOUT: Record<StrataHullRole, string> = {
  root: "Only Root stays banded; providers and below pack into shared rows.",
  provider: "Providers stay full-width; accounts and below pack.",
  account:
    "Providers and accounts stay full-width bands; regions and below pack.",
  region: "Down to regions stay full-width; VPCs and below pack.",
  vpc: "Down to VPCs stay full-width; only subnet zones pack.",
  subnetZone: "Every level stays a full-width band.",
};

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
 * Defaults (owner-directed flip, W5 repaired-stats battery): K=4 ordering and
 * A7 straighten seed ON (`useTerraformImportDialog.ts` seeds
 * `strataSweeps = 4` / `strataCoordinateRefine = true`) — the validated arm,
 * first task-metric win over v2; rankSeparate stays OFF (a height/angle vs
 * path-tracing trade). This component only renders the control; it does not
 * change any default.
 *
 * Future OD-15 ("de-band") strata toggle lands as an additional `role="group"`
 * block in the same `__layoutSettingsGrid`, below the three here.
 */
export const TerraformStrataSettings = ({
  strataSweeps,
  strataCoordinateRefine,
  strataRankSeparate,
  strataPackedScoring,
  strataPackedScoringEpsilon,
  strataPackedConverge,
  strataTransitiveAdopt,
  strataSinkPullIn,
  strataBlockClamp,
  strataTranspose,
  strataEdgeRouting,
  strataBorderRoute,
  strataBandDepth,
  strataSiftRelocate,
  strataCrossWeightPenetration,
  strataCrossWeightEdge,
  strataEdgeCrossCap,
  pipelinePrivateApiRegional,
  setPipelinePrivateApiRegional,
  setStrataSweeps,
  setStrataCoordinateRefine,
  setStrataRankSeparate,
  setStrataPackedScoring,
  setStrataPackedScoringEpsilon,
  setStrataPackedConverge,
  setStrataTransitiveAdopt,
  setStrataSinkPullIn,
  setStrataBlockClamp,
  setStrataTranspose,
  setStrataEdgeRouting,
  setStrataBorderRoute,
  setStrataBandDepth,
  setStrataSiftRelocate,
  setStrataCrossWeightPenetration,
  setStrataCrossWeightEdge,
  setStrataEdgeCrossCap,
}: {
  strataSweeps: number;
  strataCoordinateRefine: boolean;
  strataRankSeparate: boolean;
  strataPackedScoring: boolean;
  strataPackedScoringEpsilon: number;
  strataPackedConverge: boolean;
  strataTransitiveAdopt: boolean;
  strataSinkPullIn: boolean;
  strataBlockClamp: boolean;
  strataTranspose: boolean;
  strataEdgeRouting: boolean;
  strataBorderRoute: boolean;
  strataBandDepth: StrataHullRole;
  strataSiftRelocate: boolean;
  strataCrossWeightPenetration: number;
  strataCrossWeightEdge: number;
  strataEdgeCrossCap: number | undefined;
  pipelinePrivateApiRegional: boolean;
  setPipelinePrivateApiRegional: (privateApiRegional: boolean) => void;
  setStrataSweeps: (sweeps: number) => void;
  setStrataCoordinateRefine: (coordinateRefine: boolean) => void;
  setStrataRankSeparate: (rankSeparate: boolean) => void;
  setStrataPackedScoring: (packedScoring: boolean) => void;
  setStrataPackedScoringEpsilon: (epsilon: number) => void;
  setStrataPackedConverge: (packedConverge: boolean) => void;
  setStrataTransitiveAdopt: (transitiveAdopt: boolean) => void;
  setStrataSinkPullIn: (sinkPullIn: boolean) => void;
  setStrataBlockClamp: (blockClamp: boolean) => void;
  setStrataTranspose: (transpose: boolean) => void;
  setStrataEdgeRouting: (edgeRouting: boolean) => void;
  setStrataBorderRoute: (borderRoute: boolean) => void;
  setStrataBandDepth: (bandDepth: StrataHullRole) => void;
  setStrataSiftRelocate: (siftRelocate: boolean) => void;
  setStrataCrossWeightPenetration: (penetrationWeight: number) => void;
  setStrataCrossWeightEdge: (edgeWeight: number) => void;
  setStrataEdgeCrossCap: (cap: number | undefined) => void;
}) => {
  const [hoverKey, setHoverKey] = React.useState<OptionHelpKey | null>(null);
  const [stickyKey, setStickyKey] = React.useState<OptionHelpKey>(
    strataSweeps === 4 ? "strata.ordering.on" : "strata.ordering.off",
  );
  // Advanced crossing-weight disclosure, collapsed by default. Its open state is
  // driven from React (not the native <details> toggle) so it can be force-closed
  // and made non-interactive whenever the master "Reduce hull crossings" flag is
  // off — the tuning weights are inert without it.
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const activeKey = hoverKey ?? stickyKey;
  const activeHelp = OPTION_HELP[activeKey];
  const currentDepthIndex = STRATA_BAND_DEPTH_ORDER.indexOf(strataBandDepth);
  // The crossing objective weights + edge-crossing cap feed ALL FOUR relocate
  // operators — the OD-15 sift/vertical-relocate, the P1 leaf-sink pull-in, the
  // P4 pure-sink account block clamp, and the P2 within-column transpose — so the
  // tuning disclosure is live whenever ANY is on (matching the engine, which
  // forwards penW/crossW/cap when sift OR sink-pull-in OR block-clamp OR transpose
  // is enabled).
  const weightsActive =
    strataSiftRelocate ||
    strataSinkPullIn ||
    strataBlockClamp ||
    strataTranspose;

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
        <span>
          Layout passes for the next-gen compound layout (rcll-v2) — ordering +
          straighten on by default.
        </span>
      </div>
      <div className="TerraformImportModal__layoutSettingsBody">
        <div className="TerraformImportModal__layoutSettingsGrid">
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Readability
            </div>
            <div role="group" aria-label="Strata layer ordering">
              <span className="TerraformImportModal__controlLabel">
                Layer ordering <span>reorder bands to cut crossing arrows</span>
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
            <div role="group" aria-label="Strata transpose crossing reduction">
              <span className="TerraformImportModal__controlLabel">
                Transpose crossing reduction{" "}
                <span>
                  swap neighbouring boxes within a band to remove leftover
                  crossings
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option("Off", !strataTranspose, "strata.transpose.off", () =>
                  setStrataTranspose(false),
                )}
                {option("On", strataTranspose, "strata.transpose.on", () =>
                  setStrataTranspose(true),
                )}
              </div>
              {strataTranspose && strataSweeps !== 4 && (
                <div
                  className="TerraformImportModal__dependencyHint"
                  role="status"
                  aria-live="polite"
                >
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Turn on <strong>Layer ordering</strong> too — transpose
                    refines the ordering pass and is most effective with it on.
                  </span>
                  <button
                    type="button"
                    className="TerraformImportModal__dependencyHintAction"
                    onClick={() => setStrataSweeps(4)}
                  >
                    Turn on
                  </button>
                </div>
              )}
            </div>
            <div role="group" aria-label="Strata straighten">
              <span className="TerraformImportModal__controlLabel">
                Straighten edges{" "}
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
            <div role="group" aria-label="Strata reduce hull crossings">
              <span className="TerraformImportModal__controlLabel">
                Reduce hull crossings{" "}
                <span>sift and relocate containers to cut crossing arrows</span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Off",
                  !strataSiftRelocate,
                  "strata.siftrelocate.off",
                  () => setStrataSiftRelocate(false),
                )}
                {option(
                  "On",
                  strataSiftRelocate,
                  "strata.siftrelocate.on",
                  () => setStrataSiftRelocate(true),
                )}
              </div>
              {strataSiftRelocate && !strataPackedScoring && (
                <div
                  className="TerraformImportModal__dependencyHint"
                  role="status"
                  aria-live="polite"
                >
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Also enable <strong>Packed edge scoring</strong> to widen
                    the crossing-reduction candidates — the post-import
                    relocation still runs without it.
                  </span>
                  <button
                    type="button"
                    className="TerraformImportModal__dependencyHintAction"
                    onClick={() => setStrataPackedScoring(true)}
                  >
                    Turn on
                  </button>
                </div>
              )}
            </div>
            <details
              className={`TerraformImportModal__advancedDisclosure TerraformImportModal__strataAdvanced${
                weightsActive
                  ? ""
                  : " TerraformImportModal__strataAdvanced--disabled"
              }`}
              open={weightsActive && advancedOpen}
            >
              <summary
                className="TerraformImportModal__advancedSummary"
                aria-disabled={!weightsActive}
                aria-label="Advanced crossing weights"
                onClick={(event) => {
                  // Drive open state from React so the disclosure is inert while
                  // both relocate operators are off (native toggle would still
                  // fire).
                  event.preventDefault();
                  if (weightsActive) {
                    setAdvancedOpen((open) => !open);
                  }
                }}
              >
                Advanced crossing weights
              </summary>
              <div
                role="group"
                aria-label="Strata crossing objective weights"
                className="TerraformImportModal__strataAdvancedBody"
              >
                <label className="TerraformImportModal__strataWeight">
                  <span className="TerraformImportModal__controlLabel">
                    Penetration weight{" "}
                    <span>
                      how hard to punish arrows tunnelling through boxes
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={strataCrossWeightPenetration}
                    disabled={!weightsActive}
                    aria-label="Penetration weight"
                    title={OPTION_HELP["strata.crosspenweight"].body}
                    onMouseEnter={() => setHoverKey("strata.crosspenweight")}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => setHoverKey("strata.crosspenweight")}
                    onBlur={() => setHoverKey(null)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (
                        event.target.value !== "" &&
                        !Number.isNaN(value) &&
                        value >= 0
                      ) {
                        setStickyKey("strata.crosspenweight");
                        setStrataCrossWeightPenetration(Math.round(value));
                      }
                    }}
                  />
                </label>
                <label className="TerraformImportModal__strataWeight">
                  <span className="TerraformImportModal__controlLabel">
                    Edge-crossing weight{" "}
                    <span>how hard to punish two arrows crossing</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={strataCrossWeightEdge}
                    disabled={!weightsActive}
                    aria-label="Edge-crossing weight"
                    title={OPTION_HELP["strata.crossedgeweight"].body}
                    onMouseEnter={() => setHoverKey("strata.crossedgeweight")}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => setHoverKey("strata.crossedgeweight")}
                    onBlur={() => setHoverKey(null)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (
                        event.target.value !== "" &&
                        !Number.isNaN(value) &&
                        value >= 0
                      ) {
                        setStickyKey("strata.crossedgeweight");
                        setStrataCrossWeightEdge(Math.round(value));
                      }
                    }}
                  />
                </label>
                <label className="TerraformImportModal__strataWeight">
                  <span className="TerraformImportModal__controlLabel">
                    Edge-crossing cap (optional){" "}
                    <span>blank inherits the packed-scoring budget (ε)</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={strataEdgeCrossCap ?? ""}
                    disabled={!weightsActive}
                    placeholder="Inherits ε when blank"
                    aria-label="Edge-crossing cap (optional)"
                    title={OPTION_HELP["strata.edgecrosscap"].body}
                    onMouseEnter={() => setHoverKey("strata.edgecrosscap")}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => setHoverKey("strata.edgecrosscap")}
                    onBlur={() => setHoverKey(null)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setStickyKey("strata.edgecrosscap");
                      if (raw === "") {
                        setStrataEdgeCrossCap(undefined);
                        return;
                      }
                      const value = Number(raw);
                      if (!Number.isNaN(value) && value >= 0) {
                        setStrataEdgeCrossCap(Math.round(value));
                      }
                    }}
                  />
                </label>
              </div>
            </details>
            <div role="group" aria-label="Strata pull leaf sinks toward source">
              <span className="TerraformImportModal__controlLabel">
                Pull leaf sinks toward source{" "}
                <span>
                  move dead-end resources back next to what feeds them
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option("Off", !strataSinkPullIn, "strata.sinkpullin.off", () =>
                  setStrataSinkPullIn(false),
                )}
                {option("On", strataSinkPullIn, "strata.sinkpullin.on", () =>
                  setStrataSinkPullIn(true),
                )}
              </div>
              {strataSinkPullIn && !strataRankSeparate && (
                <div className="TerraformImportModal__couplingHint">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Primarily useful with <strong>Compact height</strong>{" "}
                    enabled — that pass is what strands sinks in far columns for
                    the pull-in to reclaim.
                  </span>
                </div>
              )}
            </div>
            <div role="group" aria-label="Strata compact pure-sink accounts">
              <span className="TerraformImportModal__controlLabel">
                Compact pure-sink accounts{" "}
                <span>
                  pull a whole dead-end account left toward the resources it
                  depends on
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option("Off", !strataBlockClamp, "strata.blockclamp.off", () =>
                  setStrataBlockClamp(false),
                )}
                {option("On", strataBlockClamp, "strata.blockclamp.on", () =>
                  setStrataBlockClamp(true),
                )}
              </div>
              {strataBlockClamp && !strataRankSeparate && (
                <div className="TerraformImportModal__couplingHint">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Primarily useful with <strong>Compact height</strong>{" "}
                    enabled — that pass is what strands whole accounts in the
                    far-right columns for the clamp to pull back.
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Height &amp; packing
            </div>
            <div role="group" aria-label="Strata compact height">
              <span className="TerraformImportModal__controlLabel">
                Compact height{" "}
                <span>separate sibling stacks to shorten the canvas</span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Off",
                  !strataRankSeparate,
                  "strata.rankseparate.off",
                  () => setStrataRankSeparate(false),
                )}
                {option(
                  "On",
                  strataRankSeparate,
                  "strata.rankseparate.on",
                  () => setStrataRankSeparate(true),
                )}
              </div>
            </div>
            <div role="group" aria-label="Strata band depth">
              <span className="TerraformImportModal__controlLabel">
                Band depth{" "}
                <span>
                  deepest level that stays a full-width band — everything below
                  packs X-disjoint siblings into shared rows
                </span>
              </span>
              <div className="TerraformImportModal__depthSlider">
                <span
                  className="TerraformImportModal__depthSliderAxisLabel"
                  aria-hidden="true"
                >
                  banded
                </span>
                <input
                  type="range"
                  className="TerraformImportModal__depthSliderInput"
                  min={0}
                  max={STRATA_BAND_DEPTH_ORDER.length - 1}
                  step={1}
                  value={STRATA_BAND_DEPTH_ORDER.indexOf(strataBandDepth)}
                  aria-label="Strata band depth"
                  aria-valuetext={STRATA_BAND_DEPTH_LABELS[strataBandDepth]}
                  title={OPTION_HELP["strata.banddepth"].body}
                  onMouseEnter={() => setHoverKey("strata.banddepth")}
                  onMouseLeave={() => setHoverKey(null)}
                  onFocus={() => setHoverKey("strata.banddepth")}
                  onBlur={() => setHoverKey(null)}
                  onChange={(event) => {
                    const raw = Number(event.target.value);
                    const idx = Number.isNaN(raw)
                      ? STRATA_BAND_DEPTH_ORDER.indexOf(strataBandDepth)
                      : Math.min(
                          STRATA_BAND_DEPTH_ORDER.length - 1,
                          Math.max(0, Math.round(raw)),
                        );
                    const nextRole = STRATA_BAND_DEPTH_ORDER[idx];
                    if (nextRole === undefined) {
                      return;
                    }
                    setStickyKey("strata.banddepth");
                    setStrataBandDepth(nextRole);
                  }}
                />
                <span
                  className="TerraformImportModal__depthSliderAxisLabel"
                  aria-hidden="true"
                >
                  packed
                </span>
              </div>
              <div
                className="TerraformImportModal__depthSliderTicks"
                aria-hidden="true"
              >
                {STRATA_BAND_DEPTH_ORDER.map((role, index) => (
                  <span
                    key={role}
                    className={`TerraformImportModal__depthSliderTick${
                      index === currentDepthIndex
                        ? " TerraformImportModal__depthSliderTick--active"
                        : ""
                    }`}
                  >
                    {STRATA_BAND_DEPTH_LABELS[role]}
                  </span>
                ))}
              </div>
              <div
                className="TerraformImportModal__depthReadout"
                aria-live="polite"
              >
                {STRATA_BAND_DEPTH_READOUT[strataBandDepth]}
                {currentDepthIndex >= STRATA_BAND_DEPTH_EXPERIMENTAL_FROM && (
                  <span className="TerraformImportModal__depthReadoutCaption">
                    Experimental — usually wider.
                  </span>
                )}
              </div>
              {currentDepthIndex < 2 && !strataRankSeparate && (
                <div className="TerraformImportModal__couplingHint">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Packing provider and account only reclaims height when{" "}
                    <strong>Compact height</strong> is on.
                  </span>
                </div>
              )}
            </div>
            <div role="group" aria-label="Strata packed edge scoring">
              <span className="TerraformImportModal__controlLabel">
                Packed edge scoring{" "}
                <span>
                  score region and VPC sibling order on real edge geometry
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Off",
                  !strataPackedScoring,
                  "strata.packedscoring.off",
                  () => setStrataPackedScoring(false),
                )}
                {option(
                  "On",
                  strataPackedScoring,
                  "strata.packedscoring.on",
                  () => setStrataPackedScoring(true),
                )}
              </div>
            </div>
            {strataPackedScoring && (
              <div role="group" aria-label="Strata packed crossing budget">
                <span className="TerraformImportModal__controlLabel">
                  Crossing budget (ε){" "}
                  <span>
                    extra crossings the packed scorer may accept for shorter,
                    cleaner edges (W8b ε-constraint; 0 = strict)
                  </span>
                </span>
                <select
                  className="TerraformImportModal__select"
                  aria-label="Packed scoring crossing budget epsilon"
                  value={String(strataPackedScoringEpsilon)}
                  onChange={(event) =>
                    setStrataPackedScoringEpsilon(Number(event.target.value))
                  }
                >
                  <option value="0">0 (strict)</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  {/* URL-set custom value (e.g. relative 0.01) stays visible. */}
                  {![0, 1, 2].includes(strataPackedScoringEpsilon) && (
                    <option value={String(strataPackedScoringEpsilon)}>
                      {strataPackedScoringEpsilon} (custom)
                    </option>
                  )}
                </select>
              </div>
            )}
            {strataPackedScoring && (
              <div role="group" aria-label="Strata keep best order found">
                <span className="TerraformImportModal__controlLabel">
                  Keep best order found{" "}
                  <span>
                    return the best order the packed scorer found, not the last
                    one it tried
                  </span>
                </span>
                <div className="TerraformImportModal__segmentedControl">
                  {option(
                    "Off",
                    !strataPackedConverge,
                    "strata.converge.off",
                    () => setStrataPackedConverge(false),
                  )}
                  {option(
                    "On",
                    strataPackedConverge,
                    "strata.converge.on",
                    () => setStrataPackedConverge(true),
                  )}
                </div>
                {strataPackedConverge && strataPackedScoringEpsilon === 0 && (
                  <div
                    className="TerraformImportModal__dependencyHint"
                    role="status"
                    aria-live="polite"
                  >
                    <span aria-hidden="true">ⓘ</span>
                    <span>
                      Only changes the layout when the{" "}
                      <strong>crossing budget (ε)</strong> is 1 or more.
                    </span>
                    <button
                      type="button"
                      className="TerraformImportModal__dependencyHintAction"
                      onClick={() => setStrataPackedScoringEpsilon(1)}
                    >
                      Set ε to 1
                    </button>
                  </div>
                )}
              </div>
            )}
            {strataPackedScoring && (
              <div role="group" aria-label="Strata stable adoption order">
                <span className="TerraformImportModal__controlLabel">
                  Stable adoption rule{" "}
                  <span>
                    compare layouts with one strict order so the scorer can't
                    accept a layout then drop it for a worse one (fixes rare
                    oscillation; experimental)
                  </span>
                </span>
                <div className="TerraformImportModal__segmentedControl">
                  {option(
                    "Off",
                    !strataTransitiveAdopt,
                    "strata.transitive.off",
                    () => setStrataTransitiveAdopt(false),
                  )}
                  {option(
                    "On",
                    strataTransitiveAdopt,
                    "strata.transitive.on",
                    () => setStrataTransitiveAdopt(true),
                  )}
                </div>
              </div>
            )}
            {strataRankSeparate && strataPackedScoring && (
              <div className="TerraformImportModal__controlNote">
                Measured to conflict (W8): rank separation rebuilds the column
                grid and packed edge scoring then optimizes global crossings at
                the expense of pair locality. Prefer one or the other.
              </div>
            )}
          </div>
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Edges
            </div>
            <div role="group" aria-label="Strata edge routing">
              <span className="TerraformImportModal__controlLabel">
                Route edges around boxes{" "}
                <span>
                  detour arrows that would tunnel through unrelated boxes
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Off",
                  !strataEdgeRouting,
                  "strata.edgerouting.off",
                  () => setStrataEdgeRouting(false),
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
                {option(
                  "Off",
                  !strataBorderRoute,
                  "strata.borderroute.off",
                  () => setStrataBorderRoute(false),
                )}
                {option("On", strataBorderRoute, "strata.borderroute.on", () =>
                  setStrataBorderRoute(true),
                )}
              </div>
              {strataBorderRoute && strataEdgeRouting && (
                <div className="TerraformImportModal__couplingHint">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    Composes with <strong>Route edges around boxes</strong> —
                    they rewrite disjoint edge sets (own-container exits vs
                    detours around unrelated boxes) and run in sequence.
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Placement
            </div>
            <div role="group" aria-label="Strata private API placement">
              <span className="TerraformImportModal__controlLabel">
                Private API placement{" "}
                <span>
                  place private APIs by account (region-level), not inside a VPC
                </span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Off",
                  !pipelinePrivateApiRegional,
                  "strata.privateapi.off",
                  () => setPipelinePrivateApiRegional(false),
                )}
                {option(
                  "On",
                  pipelinePrivateApiRegional,
                  "strata.privateapi.on",
                  () => setPipelinePrivateApiRegional(true),
                )}
              </div>
            </div>
          </div>
          {/* Future: OD-15 "de-band" toggle lands here as an additional
              role="group" block in the Height & packing section. */}
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
