/** Vitest globs excluded from `yarn test:fast` (run via full suite / `yarn test:slow`). */
export const SLOW_TEST_PATTERNS = [
  "**/terraformImportPerf.test.ts",
  "**/terraformLayoutSnapshot.test.ts",
  "**/terraformMultiImport.integration.test.ts",
  "**/tests/terraformMultiImportApp.test.tsx",
  "**/terraformTopologySubnetContainment.test.ts",
  "**/terraformTopologySubnetPlacement.test.ts",
  "**/terraformStackDebug.test.ts",
  "**/terraformLayoutWorkerParity.test.ts",
  "**/terraformPipelineLayoutV2.test.ts",
  "**/terraformImportPrepCache.test.ts",
  // S2-3: report-only strata research batteries — each self-describes as
  // "report-emitting; measurement/harness ONLY; owns NO gate" and does full
  // multi-arm engine rebuilds on real presets (minutes of wall-clock for
  // near-zero regression protection). Their `expect`s are fixture-integrity
  // smoke checks, not metric gates. Quarantined out of the default + `test:fast`
  // lanes so a rename's loud-failure blast radius is the lanes that actually
  // gate. Coverage stays in the full / `test:slow` lane.
  "**/terraformPipelineStrataBandCompactBattery.test.ts",
  "**/terraformPipelineStrataPackedScoringBattery.test.ts",
  "**/terraformPipelineStrataHopSweepBattery.test.ts",
  "**/terraformPipelineStrataTaskTracingBattery.test.ts",
  "**/terraformPipelineStrataRankScorerFactorial.test.ts",
  "**/terraformPipelineStrataEpsilonFrontier.test.ts",
  "**/terraformPipelineStrataJointNsProbe.test.ts",
  "**/terraformPipelineStrataChurnTriple.test.ts",
] as const;
