import React from "react";

import {
  OPTION_HELP,
  type OptionHelpKey,
} from "./TerraformImportPipelineSettings";

import { TerraformStrataSettingsHeight } from "./TerraformStrataSettingsHeight";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";

// Re-exported from their new home so this module's public surface is unchanged
// by the "Height & packing" extraction — both moved with the section that is
// their only consumer.
export {
  STRATA_BAND_DEPTH_ORDER,
  STRATA_DEBAND_ORDER,
} from "./TerraformStrataSettingsHeight";

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
 * The OD-15 "de-band" toggle landed as an additional `role="group"` block in the
 * same `__layoutSettingsGrid`, beside Band depth (the two rewrite the same
 * axis). Any further toggle lands the same way.
 */
export const TerraformStrataSettings = ({
  strataSweeps,
  strataCoordinateRefine,
  strataRankSeparate,
  strataPackedScoring,
  strataPackedScoringEpsilon,
  strataBlockClamp,
  strataTranspose,
  strataHeightGate,
  strataEdgeRouting,
  strataBorderRoute,
  strataBandDepth,
  strataDeBandLevel,
  pipelineCompact,
  pipelineIncludeAncillary,
  strataSiftRelocate,
  strataCrossWeightPenetration,
  strataCrossWeightEdge,
  strataEdgeCrossCap,
  setStrataSweeps,
  setStrataCoordinateRefine,
  setStrataRankSeparate,
  setStrataPackedScoring,
  setStrataPackedScoringEpsilon,
  setStrataBlockClamp,
  setStrataTranspose,
  setStrataHeightGate,
  setStrataEdgeRouting,
  setStrataBorderRoute,
  setStrataBandDepth,
  setStrataDeBandLevel,
  setPipelineCompact,
  setPipelineIncludeAncillary,
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
  strataBlockClamp: boolean;
  strataTranspose: boolean;
  strataHeightGate: boolean;
  strataEdgeRouting: boolean;
  strataBorderRoute: boolean;
  strataBandDepth: StrataHullRole;
  strataDeBandLevel: DeBandLevel;
  /** Content filter, not an engine pass — already honored end-to-end by the
   * strata engine; this component only renders the control. */
  pipelineCompact: boolean;
  /** Content filter, not an engine pass. Honored end-to-end by the strata
   * engine since the §3d band-injection stage landed (it used to reach only the
   * builder, which hardcoded includeAncillary:false); this component only
   * renders the control. Costs substantial scene height — see
   * OPTION_HELP["strata.resources.all"]. */
  pipelineIncludeAncillary: boolean;
  strataSiftRelocate: boolean;
  strataCrossWeightPenetration: number;
  strataCrossWeightEdge: number;
  strataEdgeCrossCap: number | undefined;
  setStrataSweeps: (sweeps: number) => void;
  setStrataCoordinateRefine: (coordinateRefine: boolean) => void;
  setStrataRankSeparate: (rankSeparate: boolean) => void;
  setStrataPackedScoring: (packedScoring: boolean) => void;
  setStrataPackedScoringEpsilon: (epsilon: number) => void;
  setStrataBlockClamp: (blockClamp: boolean) => void;
  setStrataTranspose: (transpose: boolean) => void;
  setStrataHeightGate: (heightGate: boolean) => void;
  setStrataEdgeRouting: (edgeRouting: boolean) => void;
  setStrataBorderRoute: (borderRoute: boolean) => void;
  setStrataBandDepth: (bandDepth: StrataHullRole) => void;
  setStrataDeBandLevel: (deBandLevel: DeBandLevel) => void;
  setPipelineCompact: (compact: boolean) => void;
  setPipelineIncludeAncillary: (includeAncillary: boolean) => void;
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
  // The crossing objective weights + edge-crossing cap feed ALL FOUR relocate
  // operators — the OD-15 sift/vertical-relocate, the
  // P4 pure-sink account block clamp, and the P2 within-column transpose — so the
  // tuning disclosure is live whenever ANY is on (matching the engine, which
  // forwards penW/crossW/cap when sift OR block-clamp OR transpose
  // is enabled).
  const weightsActive =
    strataSiftRelocate || strataBlockClamp || strataTranspose;

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
          {/* Content filters come FIRST, above every engine-pass section —
              mirroring the RCLL branch of TerraformImportPipelineSettings, which
              puts phaseHeader("Content", "how much to draw") + the detail group
              ahead of every layout phase. Detail is a content filter, not a
              layout pass; it must not sit among Readability/Height/Edges/
              Placement. `compact` is already honored end-to-end by the strata
              engine (terraformPipelineStrata.ts: `options?.compact !== false`
              → preparePipelineLayout); this control is pure exposure.
              Resources sits directly under Detail — the same content pair, in
              the same order, as the RCLL branch's detailGroup + resourcesGroup.
              It is authored locally rather than imported: that component's
              `resourcesGroup` is function-local and closes over its own state.
              Both arms are content filters; neither is a layout pass. */}
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Content
            </div>
            <div role="group" aria-label="Strata detail level">
              <span className="TerraformImportModal__controlLabel">
                Detail <span>how much of each cluster to draw</span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option("Compact", pipelineCompact, "detail.compact", () =>
                  setPipelineCompact(true),
                )}
                {option("Full", !pipelineCompact, "detail.full", () =>
                  setPipelineCompact(false),
                )}
              </div>
            </div>
            <div role="group" aria-label="Strata resource scope">
              <span className="TerraformImportModal__controlLabel">
                Resources <span>which resources appear in the diagram</span>
              </span>
              <div className="TerraformImportModal__segmentedControl">
                {option(
                  "Dataflow only",
                  !pipelineIncludeAncillary,
                  "strata.resources.dataflow",
                  () => setPipelineIncludeAncillary(false),
                )}
                {option(
                  "All resources",
                  pipelineIncludeAncillary,
                  "strata.resources.all",
                  () => setPipelineIncludeAncillary(true),
                )}
              </div>
            </div>
          </div>
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
            {/* Advanced (owner-decisions.md 2026-07-17 declutter): niche
                structural pass (A1 honest-null on P2), behind a collapsed
                disclosure rather than the always-visible Standard surface. */}
            <details className="TerraformImportModal__advancedDisclosure">
              <summary
                className="TerraformImportModal__advancedSummary"
                aria-label="Advanced pure-sink packing"
              >
                Advanced: pure-sink packing
              </summary>
              <div role="group" aria-label="Strata compact pure-sink accounts">
                <span className="TerraformImportModal__controlLabel">
                  Compact pure-sink accounts{" "}
                  <span>
                    pull a whole dead-end account left toward the resources it
                    depends on
                  </span>
                </span>
                <div className="TerraformImportModal__segmentedControl">
                  {option(
                    "Off",
                    !strataBlockClamp,
                    "strata.blockclamp.off",
                    () => setStrataBlockClamp(false),
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
            </details>
          </div>
          <TerraformStrataSettingsHeight
            option={option}
            setHoverKey={setHoverKey}
            setStickyKey={setStickyKey}
            strataRankSeparate={strataRankSeparate}
            strataHeightGate={strataHeightGate}
            strataBlockClamp={strataBlockClamp}
            strataBandDepth={strataBandDepth}
            strataDeBandLevel={strataDeBandLevel}
            strataPackedScoring={strataPackedScoring}
            strataPackedScoringEpsilon={strataPackedScoringEpsilon}
            setStrataRankSeparate={setStrataRankSeparate}
            setStrataHeightGate={setStrataHeightGate}
            setStrataBandDepth={setStrataBandDepth}
            setStrataDeBandLevel={setStrataDeBandLevel}
            setStrataPackedScoring={setStrataPackedScoring}
            setStrataPackedScoringEpsilon={setStrataPackedScoringEpsilon}
          />
          <div className="TerraformImportModal__settingsSection">
            <div className="TerraformImportModal__settingsSectionHeader">
              Edges
            </div>
            {/* Advanced (owner-decisions.md 2026-07-17): edge routing is a niche
                +192cr/−140pierce trade (SDEC-61 closed-adverse), so both edge
                passes live behind a collapsed disclosure — off the always-visible
                Standard surface. */}
            <details className="TerraformImportModal__advancedDisclosure">
              <summary
                className="TerraformImportModal__advancedSummary"
                aria-label="Advanced edge routing"
              >
                Advanced: edge routing
              </summary>
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
                  {option(
                    "On",
                    strataEdgeRouting,
                    "strata.edgerouting.on",
                    () => setStrataEdgeRouting(true),
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
                  {option(
                    "On",
                    strataBorderRoute,
                    "strata.borderroute.on",
                    () => setStrataBorderRoute(true),
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
            </details>
          </div>
          {/* Private API placement is no longer a control. owner-decisions.md
              2026-07-17 (Q9): private REST APIs are ALWAYS regional in strata —
              the engine clamps `pipelinePrivateApiRegional` true at the
              terraformLayoutCore sceneContext seam, so there is nothing to
              toggle. The legacy `privateApiRegional` URL param is still parsed
              (reversibility) but inert for strata. */}
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
