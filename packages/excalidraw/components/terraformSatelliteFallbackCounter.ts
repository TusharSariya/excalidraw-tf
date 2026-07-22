/**
 * Standalone fallback-usage counter for the `nodesByType` index optimization (TODO-3).
 *
 * Kept in its own dependency-free module rather than inside
 * `terraformTopologySatelliteEngine.ts` so the satellite link files (which need to call
 * `recordNodesByTypeFallbackScan()` from their own scan sites) can import it without
 * creating an import cycle — the engine module already value-imports from several link
 * files (e.g. `mergeTerraformPlanResourceValues` from `terraformTopologyIamLinks.ts`).
 *
 * Perf-loop E02 extends the module with three sibling counters so the profiler JSON can
 * show engagement (not just correctness): index HITS (a scan site that resolved through
 * `nodesByType`), plus the per-(address, kind) satellite-cluster memo HITS / MISSES added
 * in E01. All are plain integer counters — trivially cheap, always incremented — flushed
 * to the profiler once per build by `withSatelliteClusterMemoScope` (gated on the profiler
 * being enabled). Read directly in tests via the getters.
 */

let fallbackScanCount = 0;
let indexHitCount = 0;
let satMemoHitCount = 0;
let satMemoMissCount = 0;

/**
 * Call from a scan site when it falls back to `Object.keys(nodes)` despite `nodesByType`
 * being supplied to the enclosing call — i.e. the index existed but this specific site
 * never received it. Proves the *complexity* claim (not just correctness): a
 * correctness-only equivalence check would still pass even if a site silently kept doing
 * the full O(N) scan.
 */
export function recordNodesByTypeFallbackScan(): void {
  fallbackScanCount += 1;
}

/** Call from a scan site that resolved candidates through the `nodesByType` index. */
export function recordNodesByTypeIndexHit(): void {
  indexHitCount += 1;
}

/** Perf-loop E01: per-(address, kind) satellite-cluster memo hit. */
export function recordSatelliteClusterMemoHit(): void {
  satMemoHitCount += 1;
}

/** Perf-loop E01: per-(address, kind) satellite-cluster memo miss (computed fresh). */
export function recordSatelliteClusterMemoMiss(): void {
  satMemoMissCount += 1;
}

export function resetFallbackScanCount(): void {
  fallbackScanCount = 0;
}

/** Reset every E02 satellite-index / memo counter (called at each outer build scope). */
export function resetSatelliteInstrumentationCounters(): void {
  fallbackScanCount = 0;
  indexHitCount = 0;
  satMemoHitCount = 0;
  satMemoMissCount = 0;
}

export function getFallbackScanCount(): number {
  return fallbackScanCount;
}

export function getNodesByTypeIndexHitCount(): number {
  return indexHitCount;
}

export function getSatelliteClusterMemoHitCount(): number {
  return satMemoHitCount;
}

export function getSatelliteClusterMemoMissCount(): number {
  return satMemoMissCount;
}
