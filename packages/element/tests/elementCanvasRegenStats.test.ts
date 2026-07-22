import {
  elementCanvasRegenStats,
  resetElementCanvasRegenStats,
} from "../src/renderElement";

/**
 * The regen counter is the deterministic primary metric for the Terraform LOD
 * A/B (docs/terraform-canvas-runtime-performance.md). These tests pin the two
 * properties the benchmark relies on: it is disabled by default (no prod cost),
 * and reset is exact. The live increment-on-zoom behaviour is exercised by the
 * benchmark's `--suite lod` run, where zoom regens must drop as the LOD preset
 * gets more aggressive.
 */
describe("elementCanvasRegenStats", () => {
  beforeEach(() => {
    elementCanvasRegenStats.enabled = false;
    resetElementCanvasRegenStats();
  });

  it("is disabled by default so production builds pay no instrumentation cost", () => {
    expect(elementCanvasRegenStats.enabled).toBe(false);
  });

  it("starts zeroed", () => {
    expect(elementCanvasRegenStats.total).toBe(0);
    expect(elementCanvasRegenStats.zoom).toBe(0);
    expect(elementCanvasRegenStats.byCause).toEqual({
      miss: 0,
      zoom: 0,
      theme: 0,
      boundText: 0,
      imageCrop: 0,
      frameOpacity: 0,
      arrowAngle: 0,
    });
  });

  it("reset zeroes all counters (including byCause) without touching the enabled flag", () => {
    elementCanvasRegenStats.enabled = true;
    elementCanvasRegenStats.total = 42;
    elementCanvasRegenStats.zoom = 17;
    elementCanvasRegenStats.byCause.miss = 5;
    elementCanvasRegenStats.byCause.zoom = 17;
    elementCanvasRegenStats.byCause.frameOpacity = 20;

    resetElementCanvasRegenStats();

    expect(elementCanvasRegenStats.total).toBe(0);
    expect(elementCanvasRegenStats.zoom).toBe(0);
    expect(elementCanvasRegenStats.byCause).toEqual({
      miss: 0,
      zoom: 0,
      theme: 0,
      boundText: 0,
      imageCrop: 0,
      frameOpacity: 0,
      arrowAngle: 0,
    });
    // reset is a measurement boundary, not a teardown — it must leave the
    // counter armed so the next workload keeps counting.
    expect(elementCanvasRegenStats.enabled).toBe(true);
  });
});
