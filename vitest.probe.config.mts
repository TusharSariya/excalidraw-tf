import path from "path";

import { configDefaults, defineConfig } from "vitest/config";

// Private probe runner for the Strata readability investigation (H0 harness and
// downstream `.probe.test.ts` scratch files). The BASE `vitest.config.mts`
// excludes `**/*.probe.test.*` so the normal suite / CV coverage gauntlet never
// runs these heavy (30× timeout) real-app-path builds. This config is the ONLY
// way to run them:
//
//   yarn vitest run --config vitest.probe.config.mts \
//     packages/excalidraw/components/terraformStrataReadabilityHarness.probe.test.ts
//
// Deltas vs base (all deliberate, per the H0 spec):
//  - include ONLY `**/*.probe.test.*`;
//  - DROP the `**/.claude/**` exclude (probes live in the main checkout, but a
//    sibling agent worktree under `.claude/worktrees/**` that `git checkout`s
//    this commit needs its own probe copy runnable — the base exclude would
//    silently swallow it);
//  - `server.fs.allow` widened to the repo root + node_modules so the absolute
//    canvas-mock setup path resolves under a private cacheDir;
//  - absolute `vitest-canvas-mock` setup path (base uses the bare specifier,
//    which fails to resolve when this config is invoked from a nested cwd);
//  - private `cacheDir` so a probe run never clobbers the base Vite cache.
const ROOT = __dirname;

export default defineConfig({
  cacheDir: path.resolve(ROOT, "node_modules/.vite-probe"),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(ROOT, "./packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(ROOT, "./packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(ROOT, "./packages/element/src/index.ts"),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(ROOT, "./packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(ROOT, "./packages/excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(ROOT, "./packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(ROOT, "./packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(ROOT, "./packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(ROOT, "./packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(ROOT, "./packages/utils/src/$1"),
      },
    ],
  },
  server: {
    fs: {
      allow: [ROOT, path.resolve(ROOT, "node_modules")],
    },
  },
  //@ts-ignore
  test: {
    include: ["**/*.probe.test.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude],
    sequence: {
      hooks: "parallel",
      setupFiles: "list",
    },
    setupFiles: [
      path.resolve(ROOT, "./setupVitestCanvasMock.ts"),
      path.resolve(ROOT, "node_modules/vitest-canvas-mock/dist/index.js"),
      path.resolve(ROOT, "./setupTests.ts"),
    ],
    globals: true,
    environment: "jsdom",
    poolOptions: {
      forks: {
        execArgv: ["--no-experimental-webstorage"],
      },
    },
  },
});
