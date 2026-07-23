import React from "react";

import { OPTION_HELP } from "./TerraformImportPipelineSettings";

import { strataDeBandFeasible } from "./terraformPipelineStrataTypes";

import type { OptionHelpKey } from "./TerraformImportPipelineSettings";
import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
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

/** The de-band ladder rungs the slider offers, deepest first (dissolving a level
 * cascades to every deeper one, so deepest = smallest change). `provider` is
 * deliberately ABSENT: it absorbs into the root, which is pinned banded at every
 * cut (v3.1 §1.4), so it can only ever produce one vertical stack of every
 * resource — shipping it would be a trap, not a rung. */
export const STRATA_DEBAND_ORDER: readonly Exclude<
  DeBandLevel,
  "none" | "provider"
>[] = ["subnet", "vpc", "region", "account"];

const STRATA_DEBAND_LABELS: Record<
  Exclude<DeBandLevel, "none" | "provider">,
  string
> = {
  subnet: "Zones",
  vpc: "VPCs",
  region: "Regions",
  account: "Accounts",
};

/** The container that ABSORBS the lifted resources, in user words — mirrors the
 * engine's `STRATA_DEBAND_ABSORBING_ROLE` for the suppression hint. */
const STRATA_DEBAND_ABSORBING_LABELS: Record<DeBandLevel, string> = {
  none: "parent",
  subnet: "VPC",
  vpc: "region",
  region: "account",
  account: "provider",
  provider: "canvas root",
};

/**
 * The "Height & packing" section of {@link TerraformStrataSettings} — the
 * height/packing-axis levers (compact height, height gate, band depth, de-band,
 * packed edge scoring and its sub-controls).
 *
 * Extracted verbatim from the parent purely to keep that file under the
 * `max-lines` cap (it was eslint-red at 922/800 BEFORE this split, and grows one
 * `role="group"` per toggle by design). This is a mechanical move, not a
 * redesign: the section renders the identical DOM it did inline.
 *
 * The hover/sticky help state deliberately stays OWNED BY THE PARENT — the
 * help panel is shared with every other section, so lifting it here would
 * change behavior. The parent passes its `option` factory down, plus the two
 * setters the band-depth slider needs to drive that same shared panel directly.
 */
export const TerraformStrataSettingsHeight = ({
  option,
  setHoverKey,
  setStickyKey,
  strataRankSeparate,
  strataHeightGate,
  strataBlockClamp,
  strataBandDepth,
  strataDeBandLevel,
  strataPackedScoring,
  strataPackedScoringEpsilon,
  setStrataRankSeparate,
  setStrataHeightGate,
  setStrataBandDepth,
  setStrataDeBandLevel,
  setStrataPackedScoring,
  setStrataPackedScoringEpsilon,
}: {
  /** The parent's segmented-button factory — a closure over its hover/sticky
   * help state, passed down so this section drives the same shared panel. */
  option: (
    label: string,
    pressed: boolean,
    helpKey: OptionHelpKey,
    onClick: () => void,
  ) => React.ReactNode;
  setHoverKey: (key: OptionHelpKey | null) => void;
  setStickyKey: (key: OptionHelpKey) => void;
  strataRankSeparate: boolean;
  strataHeightGate: boolean;
  /** Not a control here — the height gate is refereed inside this pass, so it
   * only gates which of the two height-gate hints shows. */
  strataBlockClamp: boolean;
  strataBandDepth: StrataHullRole;
  strataDeBandLevel: DeBandLevel;
  strataPackedScoring: boolean;
  strataPackedScoringEpsilon: number;
  setStrataRankSeparate: (rankSeparate: boolean) => void;
  setStrataHeightGate: (heightGate: boolean) => void;
  setStrataBandDepth: (bandDepth: StrataHullRole) => void;
  setStrataDeBandLevel: (deBandLevel: DeBandLevel) => void;
  setStrataPackedScoring: (packedScoring: boolean) => void;
  setStrataPackedScoringEpsilon: (epsilon: number) => void;
}) => {
  const currentDepthIndex = STRATA_BAND_DEPTH_ORDER.indexOf(strataBandDepth);
  // Which side of the rankSeparate × packedScoring hard exclusion last auto-
  // disabled the other, so the CLICKED control can explain what just happened
  // (the flip was previously silent). Set in the On handlers; cleared whenever an
  // Off handler makes the note moot.
  const [lastExclusion, setLastExclusion] = React.useState<
    "compactDisabledPacked" | "packedDisabledCompact" | null
  >(null);
  // Mirror of the engine's own gate (same predicate, imported — not re-derived)
  // so the panel tells the user the level will be dropped BEFORE they import and
  // wonder why nothing changed. The engine suppresses regardless; this is the
  // visible half of the honest-meta contract.
  const deBandSuppressed = !strataDeBandFeasible(
    strataDeBandLevel,
    strataBandDepth,
  );
  // The height gate is refereed INSIDE the block-clamp pass, so its hint
  // lights only when that consumer is on. The OD-15 sift and the transpose are
  // not consumers (transpose is envelope-preserving — hull height is
  // invariant), so reusing `weightsActive` would imply an effect that cannot
  // exist.
  const heightGateMoversActive = strataBlockClamp;

  return (
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
          {option("Off", !strataRankSeparate, "strata.rankseparate.off", () => {
            setLastExclusion(null);
            setStrataRankSeparate(false);
          })}
          {/* Hard mutual exclusion (owner-decisions.md 2026-07-17 line 12):
              rankSeparate × packedScoring — enabling either auto-disables the
              other, so the UI can never emit the on/on state the engine would
              silently resolve (packedScoring wins). Without this cross-disable
              the default-ON packedScoring makes Compact height a silent no-op
              (rankSeparate suppressed at layout). M5: surface the flip with a
              coupling hint at the clicked control instead of doing it silently. */}
          {option("On", strataRankSeparate, "strata.rankseparate.on", () => {
            setLastExclusion(
              strataPackedScoring ? "compactDisabledPacked" : null,
            );
            setStrataRankSeparate(true);
            setStrataPackedScoring(false);
          })}
        </div>
        {lastExclusion === "compactDisabledPacked" && (
          <div
            className="TerraformImportModal__couplingHint"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true">ⓘ</span>
            <span>
              Turned off <strong>Packed edge scoring</strong> — the two can't
              run together, so switching on Compact height disabled it.
            </span>
          </div>
        )}
      </div>
      {/* Advanced (owner-decisions.md 2026-07-17 declutter): the height gate is
          inert groundwork with a single consumer (block clamp), so it lives
          behind a collapsed disclosure rather than the always-visible Standard
          surface. */}
      <details className="TerraformImportModal__advancedDisclosure">
        <summary
          className="TerraformImportModal__advancedSummary"
          aria-label="Advanced height gate"
        >
          Advanced: height gate
        </summary>
        <div
          role="group"
          aria-label="Strata keep containers from growing taller"
        >
          <span className="TerraformImportModal__controlLabel">
            Keep containers from growing taller{" "}
            <span>
              check each clamp move against every container it touches, and keep
              it only if nothing ends up taller
            </span>
          </span>
          <div className="TerraformImportModal__segmentedControl">
            {option("Off", !strataHeightGate, "strata.heightgate.off", () =>
              setStrataHeightGate(false),
            )}
            {option("On", strataHeightGate, "strata.heightgate.on", () =>
              setStrataHeightGate(true),
            )}
          </div>
          {strataHeightGate && !heightGateMoversActive && (
            <div className="TerraformImportModal__couplingHint">
              <span aria-hidden="true">ⓘ</span>
              <span>
                Does nothing on its own — turn on{" "}
                <strong>Compact pure-sink accounts</strong>, the pass it
                referees.
              </span>
            </div>
          )}
          {strataHeightGate && heightGateMoversActive && (
            <div className="TerraformImportModal__couplingHint">
              <span aria-hidden="true">ⓘ</span>
              <span>
                Usually no visible change: nothing yet makes a container taller,
                so this check rarely has anything to catch. Mainly groundwork
                for a later pass.
              </span>
            </div>
          )}
        </div>
      </details>
      <div role="group" aria-label="Strata band depth">
        <span className="TerraformImportModal__controlLabel">
          Band depth{" "}
          <span>
            deepest level that stays a full-width band — everything below packs
            X-disjoint siblings into shared rows
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
        <div className="TerraformImportModal__depthReadout" aria-live="polite">
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
      {/* De-band sits beside Band depth deliberately: the two rewrite the
          SAME axis (band depth picks each surviving hull's policy, de-band
          picks which hulls exist) and the engine suppresses an infeasible
          pairing. `provider` is omitted from the ladder — it absorbs into
          the root, which is pinned banded, so it is dead at every cut. */}
      <div role="group" aria-label="Strata dissolve containers">
        <span className="TerraformImportModal__controlLabel">
          Dissolve containers{" "}
          <span>
            drop this level's boxes and pack its resources straight into the
            parent
          </span>
        </span>
        <div className="TerraformImportModal__segmentedControl">
          {option(
            "Off",
            strataDeBandLevel === "none",
            "strata.deband.none",
            () => setStrataDeBandLevel("none"),
          )}
          {/* `option` returns a bare <button>, so the list needs its own
              key wrapper — every other segmented control in this file is
              a fixed pair and never hit this. */}
          {STRATA_DEBAND_ORDER.map((level) => (
            <React.Fragment key={level}>
              {option(
                STRATA_DEBAND_LABELS[level],
                strataDeBandLevel === level,
                // Per-rung help key: the rungs' measured costs differ
                // (subnet wins, vpc regresses height/pierce, region and
                // account are unmeasured), so they cannot share one key.
                `strata.deband.${level}`,
                () => setStrataDeBandLevel(level),
              )}
            </React.Fragment>
          ))}
        </div>
        {deBandSuppressed && (
          <div
            className="TerraformImportModal__dependencyHint"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true">ⓘ</span>
            <span>
              Ignored at this <strong>Band depth</strong> — the{" "}
              {STRATA_DEBAND_ABSORBING_LABELS[strataDeBandLevel]} that would
              absorb these resources is still a full-width band, so each one
              would land on its own row (one tall stack). Move Band depth
              shallower, or pick a deeper level to dissolve.
            </span>
          </div>
        )}
      </div>
      <div role="group" aria-label="Strata packed edge scoring">
        <span className="TerraformImportModal__controlLabel">
          Packed edge scoring{" "}
          <span>score region and VPC sibling order on real edge geometry</span>
        </span>
        <div className="TerraformImportModal__segmentedControl">
          {option(
            "Off",
            !strataPackedScoring,
            "strata.packedscoring.off",
            () => {
              setLastExclusion(null);
              setStrataPackedScoring(false);
            },
          )}
          {/* Other direction of the same hard exclusion (see Compact height
              above): enabling packed edge scoring auto-disables Compact height
              (rankSeparate). packedScoring is the engine's tiebreaker winner, so
              this is also the state the app default sits in (packedScoring ON,
              rankSeparate OFF). M5: surface the flip with a coupling hint at the
              clicked control instead of doing it silently. */}
          {option("On", strataPackedScoring, "strata.packedscoring.on", () => {
            setLastExclusion(
              strataRankSeparate ? "packedDisabledCompact" : null,
            );
            setStrataPackedScoring(true);
            setStrataRankSeparate(false);
          })}
        </div>
        {lastExclusion === "packedDisabledCompact" && (
          <div
            className="TerraformImportModal__couplingHint"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true">ⓘ</span>
            <span>
              Turned off <strong>Compact height</strong> — the two can't run
              together, so switching on Packed edge scoring disabled it.
            </span>
          </div>
        )}
      </div>
      {strataPackedScoring && (
        <div role="group" aria-label="Strata packed crossing budget">
          <span className="TerraformImportModal__controlLabel">
            Crossing budget (ε){" "}
            <span>
              extra crossings the packed scorer may accept for shorter, cleaner
              edges (W8b ε-constraint; 0 = strict)
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
      {/* 'Keep best order found' (strataPackedConverge) and 'Stable adoption
          rule' (strataTransitiveAdopt) were REMOVED from the panel
          (owner-decisions.md 2026-07-17): both are byte-identical no-ops
          (transitiveAdopt also wasted ~8.6s/layout) and their packedScoring
          render-gate is now default-ON, so they would render for every user.
          The URL parser + preset bridge keep accepting the legacy params as
          inert no-ops for old URLs (state still round-trips in
          useTerraformImportDialog); only the controls are gone. */}
      {/* The former W8 "Measured to conflict … prefer one or the other" advisory
          is gone: rankSeparate × packedScoring is now a HARD exclusion enforced
          at both toggle handlers (owner-decisions.md 2026-07-17 line 12), so the
          on/on state it described can no longer be reached from the UI. */}
    </div>
  );
};

TerraformStrataSettingsHeight.displayName = "TerraformStrataSettingsHeight";
