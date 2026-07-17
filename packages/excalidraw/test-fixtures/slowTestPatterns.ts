/** Vitest globs excluded from `yarn test:fast` (run via full suite / `yarn test:slow`). */
export const SLOW_TEST_PATTERNS = [
  "**/terraformImportPerf.test.ts",
  "**/terraformLayoutSnapshot.test.ts",
  "**/terraformMultiImport.integration.test.ts",
  "**/tests/terraformMultiImportApp.test.tsx",
  "**/terraformTopologySubnetContainment.test.ts",
  "**/terraformTopologySubnetPlacement.test.ts",
  "**/terraformStackDebug.test.ts",
  "**/terraformPipelineTfdBind.test.ts",
  // Heavy RCLL layout-engine integration tests (each rebuilds the full pipeline
  // many times; measured 154-655s on CI). Quarantined into the sharded slow lane
  // so `yarn test:fast` stays fast. terraformPipelineRcll.test.ts (655s, the
  // single biggest file) is later split into ~3 sibling files so it is not a
  // per-shard wall-clock floor; update the pattern below when that lands.
  "**/terraformPipelineRcll.test.ts",
  "**/terraformLayoutWorkerParity.test.ts",
  "**/terraformPipelineRankSeparate.test.ts",
  "**/terraformPipelineRcllAncillaryIntegration.test.ts",
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
  "**/terraformPipelineStrataW12HeldoutScaleBattery.test.ts",
  "**/terraformPipelineStrataRankScorerFactorial.test.ts",
  "**/terraformPipelineStrataRepairedStats.test.ts",
  "**/terraformPipelineStrataEpsilonFrontier.test.ts",
  "**/terraformPipelineStrataJointNsProbe.test.ts",
  "**/terraformPipelineStrataChurnTriple.test.ts",
  "**/terraformPipelineStrataHighlightSpike.test.ts",
  "**/terraformPipelineStrataRoutingSpike.test.ts",
] as const;
