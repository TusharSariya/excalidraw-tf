import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  layoutTerraformFromSources,
  type TerraformLayoutOptions,
} from "./terraformLayoutCore";
import {
  layoutTerraformViaWorkers,
  setTerraformLayoutWorkersEnabledForTests,
} from "./terraformLayoutWorkerClient";
import {
  buildTerraformLayoutSnapshot,
  type TerraformLayoutSnapshot,
} from "./terraformLayoutSnapshot";
import {
  stagingMultiStateLayoutSources,
  stagingMultiStatePipelineLayoutSources,
} from "./terraformLayoutSnapshotFixtures";

import type { TerraformExcalidrawScenePayload } from "./terraformSceneApply";
import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

function snapshotFromLayoutResult(
  result: Awaited<ReturnType<typeof layoutTerraformFromSources>>,
): TerraformLayoutSnapshot {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("layout failed");
  }
  return buildTerraformLayoutSnapshot(
    result.scene as Parameters<typeof buildTerraformLayoutSnapshot>[0],
  );
}

async function snapshotViaWorkers(
  sources: TerraformPlanParsingSources,
  options: Parameters<typeof layoutTerraformViaWorkers>[1],
): Promise<TerraformLayoutSnapshot> {
  const scene = await layoutTerraformViaWorkers(sources, options);
  return buildTerraformLayoutSnapshot(
    scene as Parameters<typeof buildTerraformLayoutSnapshot>[0],
  );
}

describe("terraform layout worker parity", () => {
  beforeAll(() => {
    if (process.env.VITEST_TERRAFORM_VERBOSE !== "1") {
      vi.spyOn(console, "log").mockImplementation(() => {});
    }
  });

  afterEach(() => {
    setTerraformLayoutWorkersEnabledForTests(null);
  });

  const views = [
    {
      name: "semantic",
      sources: () => stagingMultiStateLayoutSources(),
      coreOptions: { semanticLayout: true as const },
      workerOptions: { semanticLayout: true as const },
    },
    {
      name: "pipeline",
      sources: () => stagingMultiStatePipelineLayoutSources(),
      coreOptions: {
        semanticLayout: false as const,
        layoutMode: "pipeline" as const,
      },
      workerOptions: {
        semanticLayout: false as const,
        layoutMode: "pipeline" as const,
      },
    },
    {
      name: "module",
      sources: () => stagingMultiStateLayoutSources(),
      coreOptions: { semanticLayout: false as const },
      workerOptions: { semanticLayout: false as const },
    },
    {
      name: "strata",
      sources: () => stagingMultiStatePipelineLayoutSources(),
      coreOptions: {
        semanticLayout: false as const,
        layoutMode: "strata" as const,
      },
      workerOptions: {
        semanticLayout: false as const,
        layoutMode: "strata" as const,
      },
    },
    {
      name: "rcll",
      sources: () => stagingMultiStatePipelineLayoutSources(),
      coreOptions: {
        semanticLayout: false as const,
        layoutMode: "rcll" as const,
      },
      workerOptions: {
        semanticLayout: false as const,
        layoutMode: "rcll" as const,
      },
    },
  ] as const;

  // W14 WP3 — pipelineFull worker job. In vitest `typeof Worker === "undefined"`,
  // so `layoutTerraformViaWorkers` normally short-circuits to `runSequential`
  // before reaching the pipeline branch. To exercise the REAL dispatch chain
  // (client pipeline branch → runJobWithFallback → pool failure → the pipelineFull
  // case of runJobOnMainThread → layoutTerraformFromSources → toScenePayload), we
  // stub a `Worker` whose construction throws: the runtime guard then passes and
  // the pool transparently fails over to the main-thread dispatch — the same
  // no-worker path a browser would never hit but that mirrors the offloaded flow.
  async function withFailingWorker<T>(fn: () => Promise<T>): Promise<T> {
    const original = (globalThis as { Worker?: unknown }).Worker;
    class FailingWorker {
      constructor() {
        throw new Error("no Worker in vitest (forced main-thread fallback)");
      }
    }
    (globalThis as { Worker?: unknown }).Worker = FailingWorker;
    try {
      return await fn();
    } finally {
      if (original === undefined) {
        delete (globalThis as { Worker?: unknown }).Worker;
      } else {
        (globalThis as { Worker?: unknown }).Worker = original;
      }
    }
  }

  function stagingLocalstackPipelineSources(): TerraformPlanParsingSources {
    const sources = getTerraformImportPresetSourcesFromDb("staging-localstack");
    if (!sources) {
      throw new Error(
        "staging-localstack preset missing from the committed preset DB.",
      );
    }
    return sources as TerraformPlanParsingSources;
  }

  describe("pipelineFull worker job (W14 WP3)", () => {
    const pipelineArms: Array<{
      name: string;
      options: TerraformLayoutOptions;
    }> = [
      {
        name: "P2 staging-localstack pipeline",
        options: {
          semanticLayout: false,
          layoutMode: "pipeline",
        },
      },
      {
        name: "P2 staging-localstack strata (sweeps=4 + coordRefine)",
        options: {
          semanticLayout: false,
          layoutMode: "strata",
          strataSweeps: 4,
          strataCoordinateRefine: true,
        },
      },
    ];

    for (const arm of pipelineArms) {
      it(
        `${arm.name}: pipelineFull dispatch matches sequential layoutTerraformFromSources`,
        async () => {
          const sources = stagingLocalstackPipelineSources();
          const coreResult = await layoutTerraformFromSources(
            sources,
            arm.options,
          );
          expect(coreResult.ok).toBe(true);
          if (!coreResult.ok) {
            throw new Error("core layout failed");
          }
          const coreSnap = buildTerraformLayoutSnapshot(
            coreResult.scene as Parameters<
              typeof buildTerraformLayoutSnapshot
            >[0],
          );

          setTerraformLayoutWorkersEnabledForTests(true);
          const workerScene = await withFailingWorker(() =>
            layoutTerraformViaWorkers(sources, arm.options),
          );
          const workerSnap = buildTerraformLayoutSnapshot(
            workerScene as Parameters<typeof buildTerraformLayoutSnapshot>[0],
          );

          expect(workerSnap).toEqual(coreSnap);
        },
        STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
      );
    }

    it("worker-path layout failure surfaces as a thrown Error", async () => {
      // Empty sources ⇒ layoutTerraformFromSources returns { ok:false }, which
      // toScenePayload turns into a thrown Error (status). The pipelineFull job
      // carries that result through unchanged, so the client throws just as the
      // sequential path always has.
      const emptySources: TerraformPlanParsingSources = {
        planDotBundles: [],
        states: [],
        stateLabels: [],
        tfdTexts: [],
        tfdLabels: [],
      };
      setTerraformLayoutWorkersEnabledForTests(true);
      await expect(
        withFailingWorker(() =>
          layoutTerraformViaWorkers(emptySources, {
            semanticLayout: false,
            layoutMode: "pipeline",
          }),
        ),
      ).rejects.toThrow();
    });

    it("fallback path returns a valid non-empty scene", async () => {
      const sources = stagingLocalstackPipelineSources();
      setTerraformLayoutWorkersEnabledForTests(true);
      const scene: TerraformExcalidrawScenePayload = await withFailingWorker(
        () =>
          layoutTerraformViaWorkers(sources, {
            semanticLayout: false,
            layoutMode: "pipeline",
          }),
      );
      const snapshot = buildTerraformLayoutSnapshot(
        scene as Parameters<typeof buildTerraformLayoutSnapshot>[0],
      );
      expect(snapshot.elements.length).toBeGreaterThan(0);
    });
  });

  for (const view of views) {
    it(
      `${view.name}: layoutTerraformFromSources matches layoutTerraformViaWorkers (workers off)`,
      async () => {
        setTerraformLayoutWorkersEnabledForTests(false);
        const sources = view.sources();
        const coreSnap = snapshotFromLayoutResult(
          await layoutTerraformFromSources(sources, view.coreOptions),
        );
        const workerSnap = await snapshotViaWorkers(
          sources,
          view.workerOptions,
        );
        expect(workerSnap).toEqual(coreSnap);
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
    );

    it(
      `${view.name}: layoutTerraformViaWorkers workers on matches workers off`,
      async () => {
        const sources = view.sources();
        setTerraformLayoutWorkersEnabledForTests(false);
        const offSnap = await snapshotViaWorkers(sources, view.workerOptions);
        setTerraformLayoutWorkersEnabledForTests(true);
        const onSnap = await snapshotViaWorkers(sources, view.workerOptions);
        expect(onSnap).toEqual(offSnap);
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
    );
  }
});
