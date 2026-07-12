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
  type FrozenRowsArtifact,
  type GateRegister,
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
      expect(artifact, `${cell.id}: artifact ${cell.artifact} loaded`).toBeTruthy();
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
