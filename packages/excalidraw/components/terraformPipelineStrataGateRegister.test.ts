/**
 * v3.2 gate-register assertion suite (R8-F3 repair) — ALWAYS-ON and, unlike
 * the report-emitting battery harnesses, this file DOES assert.
 *
 * Design choice (documented per the migration directive): candidate rows are
 * frozen SNAPSHOTS beside the baseline rows (live candidate rebuild is a
 * multi-arm scene build — too slow for an always-on suite), so every check
 * here is pure math over loaded JSON and runs in milliseconds. The flag-gated
 * freeze harness (terraformPipelineStrataFreezeBaselines.test.ts) is the live
 * rebuild path; after any engine change, regen the artifacts and re-adjudicate
 * docs/strata-baselines/gateRegister.json.
 *
 * Asserted properties:
 *  1. Every manifest SHA-256 matches the artifact bytes (no silent drift).
 *  2. Artifacts recompute internally (row populations sane, keys unique+sorted).
 *  3. Every gateRegister cell's claimed status matches the verdict recomputed
 *     from the frozen rows — a claim that doesn't recompute goes RED naming
 *     the cell, and FAIL-WAIVED never renders as PASS (claimMismatch()).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimMismatch,
  recomputeCell,
  recomputeScalarCell,
  scalarClaimMismatch,
  scalarLowerIsBetter,
  SDEC_TOKEN_RE,
  type FrozenRowsArtifact,
  type GateRegister,
  type GateRegisterScalarCell,
  type ScalarMetricId,
} from "./terraformPipelineStrataGateRegister";

const BASE_DIR = join(__dirname, "../../../docs/strata-baselines");

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(BASE_DIR, name), "utf8")) as T;

const manifest = readJson<{
  schemaVersion: number;
  files: Record<string, string>;
}>("V32_BASELINE_MANIFEST.json");

const register = readJson<GateRegister>("gateRegister.json");

const artifacts = new Map<string, FrozenRowsArtifact>();
for (const name of Object.keys(manifest.files)) {
  artifacts.set(name, readJson<FrozenRowsArtifact>(name));
}

describe("v3.2 gate register (always-on assertions)", () => {
  it("manifest SHA-256 pins match artifact bytes", () => {
    expect(Object.keys(manifest.files).length).toBeGreaterThan(0);
    for (const [name, expectedSha] of Object.entries(manifest.files)) {
      const bytes = readFileSync(join(BASE_DIR, name));
      const actual = createHash("sha256").update(bytes).digest("hex");
      expect(actual, `SHA drift in ${name} — regen + re-adjudicate`).toBe(
        expectedSha,
      );
    }
  });

  it("artifacts recompute internally (populations, key hygiene)", () => {
    for (const [name, artifact] of artifacts) {
      expect(artifact.schemaVersion, name).toBe(1);
      expect(artifact.arms.A_v2_baseline, `${name}: baseline arm`).toBeTruthy();
      for (const [armLabel, arm] of Object.entries(artifact.arms)) {
        const ctx = `${name}/${armLabel}`;
        expect(arm.paths.length, `${ctx}: path rows`).toBeGreaterThan(0);
        // keys unique + ascending (canonical order is load-bearing for the
        // deterministic bootstrap pairing).
        for (const rows of [
          arm.sliceB.map((r) => r.key),
          arm.paths.map((r) => r.pathKey),
        ]) {
          for (let i = 1; i < rows.length; i++) {
            expect(rows[i]! > rows[i - 1]!, `${ctx}: keys sorted+unique`).toBe(
              true,
            );
          }
        }
        for (const r of arm.paths) {
          const recomputedRt =
            Math.round(
              (1.39 * r.k + 0.01699 * r.con + 0.654 * r.cr + 0.295 * r.br) *
                100,
            ) / 100;
          // Tolerance 0.02: con is stored rounded to 2dp, so rtHat (rounded
          // from the unrounded con) can differ from the recompute by one ulp
          // of the rounding grid on each term.
          expect(
            Math.abs(recomputedRt - r.rtHat),
            `${ctx}/${r.pathKey}: rtHat recompute`,
          ).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it("every register claim recomputes (FAIL-WAIVED never renders as PASS)", () => {
    expect(register.cells.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    const ids = new Set<string>();
    for (const cell of register.cells) {
      expect(ids.has(cell.id), `duplicate cell id ${cell.id}`).toBe(false);
      ids.add(cell.id);
      const artifact = artifacts.get(cell.artifact);
      expect(
        artifact,
        `${cell.id}: artifact ${cell.artifact} loaded`,
      ).toBeTruthy();
      const rc = recomputeCell(cell, artifact!);
      const mismatch = claimMismatch(cell, rc);
      if (mismatch) {
        mismatches.push(mismatch);
      }
    }
    expect(
      mismatches,
      `gate-register claims failed to recompute:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  });

  const scalarCells = register.scalarCells ?? [];
  const scalarById = new Map(scalarCells.map((c) => [c.id, c]));
  const resolveScalar = (id: string): GateRegisterScalarCell | undefined =>
    scalarById.get(id);

  // The decision log is committed; grep it so a well-formed but nonexistent
  // SDEC token still fails (Fix 4 — SDEC citation existence).
  const decisionLog = readFileSync(
    join(BASE_DIR, "../strata-view-decision-log.md"),
    "utf8",
  );
  const sdecExistsInLog = (token: string): boolean =>
    new RegExp(`(^|[^0-9A-Za-z-])${token}([^0-9]|$)`).test(decisionLog);

  it("scalar cells (M-H / M-TCR / M-ANG probes) are schema-valid and recompute", () => {
    expect(scalarCells.length).toBeGreaterThan(0);
    const validMetrics = new Set<ScalarMetricId>([
      "hullPenetrationsProbe",
      "batteryCrossings",
      "sharpShare",
    ]);
    const validStatuses = new Set(["PASS", "PARITY", "FAIL-WAIVED", "REPORT"]);
    const mismatches: string[] = [];
    const ids = new Set<string>();
    for (const cell of scalarCells) {
      expect(ids.has(cell.id), `duplicate scalar cell id ${cell.id}`).toBe(
        false,
      );
      ids.add(cell.id);
      // Honest cell class is mandatory. All current cells are recorded
      // measurements (report-observation), which assert nothing.
      expect(
        cell.kind === "report-observation" || cell.kind === "comparative",
        `${cell.id}: kind`,
      ).toBe(true);
      expect(
        cell.kind,
        `${cell.id}: all seeded cells are report-observation`,
      ).toBe("report-observation");
      expect(validMetrics.has(cell.metric), `${cell.id}: metric id`).toBe(true);
      expect(validStatuses.has(cell.claimedStatus), `${cell.id}: status`).toBe(
        true,
      );
      expect(typeof cell.preset, `${cell.id}: preset`).toBe("string");
      expect(
        cell.preset.length,
        `${cell.id}: preset non-empty`,
      ).toBeGreaterThan(0);
      // v3.2: a claim must name its exact configuration.
      expect(
        cell.configuration.length,
        `${cell.id}: configuration named`,
      ).toBeGreaterThan(0);
      expect(Number.isFinite(cell.value), `${cell.id}: numeric value`).toBe(
        true,
      );
      expect(
        cell.evidence.length,
        `${cell.id}: evidence pointer`,
      ).toBeGreaterThan(0);
      // Direction is derived in code from the metric, never read from the cell.
      expect(scalarLowerIsBetter(cell.metric), `${cell.id}: direction`).toBe(
        true,
      );
      // A baselineRef, when present, must resolve to a real register cell (the
      // v2→I→P chain) — never a duplicated number.
      if (cell.baselineRef !== undefined) {
        expect(
          resolveScalar(cell.baselineRef),
          `${cell.id}: baselineRef ${cell.baselineRef} resolves`,
        ).toBeTruthy();
      }
      // FAIL-WAIVED must cite a well-formed SDEC that exists in the log.
      if (cell.claimedStatus === "FAIL-WAIVED") {
        expect(
          cell.sdec && SDEC_TOKEN_RE.test(cell.sdec),
          `${cell.id}: sdec`,
        ).toBe(true);
        expect(
          sdecExistsInLog(cell.sdec!),
          `${cell.id}: cited ${cell.sdec} exists in decision log`,
        ).toBe(true);
      }
      const mismatch = scalarClaimMismatch(cell, resolveScalar);
      if (mismatch) {
        mismatches.push(mismatch);
      }
    }
    expect(
      mismatches,
      `scalar-register claims failed to recompute:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  });

  it("recomputeScalarCell derives direction from the metric (hard-coded), not the cell", () => {
    // Both are lower-is-better, so a smaller value is PASS regardless of any
    // per-cell field (there is none). Uses the resolved comparator.
    const base: GateRegisterScalarCell = {
      id: "unit/base",
      kind: "comparative",
      metric: "batteryCrossings",
      preset: "Px",
      configuration: "unit",
      value: 100,
      claimedStatus: "REPORT",
      adjudication: "unit",
      evidence: "unit",
    };
    const resolve = (id: string) => (id === "unit/base" ? base : undefined);
    const better = recomputeScalarCell(
      { ...base, id: "unit/better", value: 80, baselineRef: "unit/base" },
      resolve,
    );
    const worse = recomputeScalarCell(
      { ...base, id: "unit/worse", value: 120, baselineRef: "unit/base" },
      resolve,
    );
    const equal = recomputeScalarCell(
      { ...base, id: "unit/equal", value: 100, baselineRef: "unit/base" },
      resolve,
    );
    expect(better.computed).toBe("PASS");
    expect(worse.computed).toBe("FAIL");
    expect(equal.computed).toBe("PARITY");
    // No comparator → pure REPORT.
    expect(recomputeScalarCell(base, resolve).computed).toBe("REPORT");
  });

  it("negative path: report-observation with a non-REPORT status is flagged", () => {
    const obs = scalarCells.find((c) => c.kind === "report-observation")!;
    expect(obs, "register has a report-observation cell").toBeTruthy();
    for (const status of ["PASS", "PARITY", "FAIL-WAIVED"] as const) {
      expect(
        scalarClaimMismatch(
          {
            ...obs,
            claimedStatus: status,
            // give FAIL-WAIVED a legal SDEC so the failure is purely the kind
            sdec: status === "FAIL-WAIVED" ? "SDEC-1" : undefined,
          },
          resolveScalar,
        ),
        `report-observation claiming ${status} must be flagged`,
      ).not.toBeNull();
    }
  });

  it("negative path: a comparative scalar cell is unmintable (schema-ready only)", () => {
    const donor = scalarCells.find((c) => c.baselineRef !== undefined)!;
    // Missing pinned artifact → rejected on the artifact requirement.
    const noArtifact = scalarClaimMismatch(
      { ...donor, kind: "comparative", claimedStatus: "PASS" },
      resolveScalar,
    );
    expect(
      noArtifact,
      "comparative without a pinned artifact must be flagged",
    ).not.toBeNull();
    expect(noArtifact).toContain("pinned artifact");
    // Even WITH a well-formed pinned artifact, comparative is rejected today —
    // no scalar pinned artifact exists (this is the anti-mint property).
    const withArtifact = scalarClaimMismatch(
      {
        ...donor,
        kind: "comparative",
        claimedStatus: "PASS",
        pinnedArtifact: {
          path: "docs/strata-baselines/nope.json",
          sha256: "0",
        },
      },
      resolveScalar,
    );
    expect(withArtifact, "comparative is not yet mintable").not.toBeNull();
    expect(withArtifact).toContain("not yet mintable");
  });

  it("negative path: an unresolvable baselineRef is flagged", () => {
    const donor = scalarCells.find((c) => c.baselineRef !== undefined)!;
    expect(
      scalarClaimMismatch(
        { ...donor, baselineRef: "does/not/exist" },
        resolveScalar,
      ),
      "a dangling baselineRef must be flagged",
    ).not.toBeNull();
  });

  it("negative path: FAIL-WAIVED needs a well-formed, existing SDEC", () => {
    const obs = scalarCells.find((c) => c.kind === "report-observation")!;
    // Comparative FAIL-WAIVED with a malformed SDEC → flagged on the SDEC.
    const malformed = scalarClaimMismatch(
      {
        ...obs,
        kind: "comparative",
        claimedStatus: "FAIL-WAIVED",
        sdec: "SDEC-",
      },
      resolveScalar,
    );
    expect(malformed, "malformed SDEC must be flagged").not.toBeNull();
    expect(malformed).toContain("SDEC");
    // A well-formed but nonexistent SDEC is caught by the decision-log grep.
    expect(SDEC_TOKEN_RE.test("SDEC-99999"), "SDEC-99999 is well-formed").toBe(
      true,
    );
    expect(
      sdecExistsInLog("SDEC-99999"),
      "SDEC-99999 must not exist in the decision log",
    ).toBe(false);
    // A well-formed one that does exist passes the regex + log checks.
    expect(SDEC_TOKEN_RE.test("SDEC-1")).toBe(true);
    expect(sdecExistsInLog("SDEC-1")).toBe(true);
  });

  it("negative path: a relabeled claim is detected (the R8-F3 property)", () => {
    // Take a real PASS cell and claim it FAIL-WAIVED, and vice versa — both
    // relabelings must be flagged. This locks the property the register
    // exists for: statuses cannot drift from what the frozen rows support.
    const pass = register.cells.find((c) => c.claimedStatus === "PASS")!;
    const waived = register.cells.find(
      (c) => c.claimedStatus === "FAIL-WAIVED",
    )!;
    expect(pass, "register has a PASS cell").toBeTruthy();
    expect(waived, "register has a FAIL-WAIVED cell").toBeTruthy();
    const passArtifact = artifacts.get(pass.artifact)!;
    const waivedArtifact = artifacts.get(waived.artifact)!;
    expect(
      claimMismatch(
        { ...pass, claimedStatus: "FAIL-WAIVED" },
        recomputeCell(pass, passArtifact),
      ),
      "stale waiver over a computed PASS must be flagged",
    ).not.toBeNull();
    expect(
      claimMismatch(
        { ...waived, claimedStatus: "PASS" },
        recomputeCell(waived, waivedArtifact),
      ),
      "a computed FAIL relabeled as PASS must be flagged",
    ).not.toBeNull();
  });
});
