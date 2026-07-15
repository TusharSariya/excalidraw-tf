import path from "path";

import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from "vitest/config";

import { SLOW_TEST_PATTERNS } from "./packages/excalidraw/test-fixtures/slowTestPatterns";

const isFastRun = process.env.VITEST_FAST === "1";
const isSlowOnlyRun = process.env.VITEST_SLOW_ONLY === "1";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(__dirname, "./packages/common/src/index.ts"),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(__dirname, "./packages/element/src/index.ts"),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/index.tsx"),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(__dirname, "./packages/math/src/index.ts"),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(__dirname, "./packages/utils/src/index.ts"),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/utils/src/$1"),
      },
    ],
  },
  //@ts-ignore
  test: {
    ...(isSlowOnlyRun ? { include: [...SLOW_TEST_PATTERNS] } : {}),
    // `.claude/worktrees/**` holds sibling git worktrees checked out by other
    // concurrent coding-agent sessions on this same machine (see the
    // using-git-worktrees convention) — never test-runner scope. Without this
    // exclude, vitest's default discovery sweeps those trees up too, running
    // (and reporting failures for) whatever unrelated/in-progress code
    // another session currently has checked out there.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      // `*.probe.test.*` are heavy (30× timeout) real-app-path research probes
      // (e.g. the Strata readability H0 harness). They are NOT part of the
      // normal suite or the coverage gauntlet — run them explicitly via the
      // private `vitest.probe.config.mts`.
      "**/*.probe.test.*",
      ...(isFastRun ? SLOW_TEST_PATTERNS : []),
    ],
    // Since hooks are running in stack in v2, which means all hooks run serially whereas
    // we need to run them in parallel
    sequence: {
      hooks: "parallel",
      setupFiles: "list",
    },
    setupFiles: [
      "./setupVitestCanvasMock.ts",
      "vitest-canvas-mock",
      "./setupTests.ts",
    ],
    globals: true,
    environment: "jsdom",
    poolOptions: {
      forks: {
        // Node 22+ can enable a broken global `localStorage` stub that shadows jsdom;
        // disabling experimental web storage lets jsdom install real Storage.
        execArgv: ["--no-experimental-webstorage"],
      },
    },
    coverage: {
      /** Ensures CI / vitest-coverage-report-action still get json-summary when tests or thresholds fail */
      reportOnFailure: true,
      reporter: process.env.CI
        ? ["text", "json-summary", "lcovonly"]
        : ["text", "json-summary", "json", "html", "lcovonly"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "dev-docs/**",
        "examples/**",
        "excalidraw-app/build/**",
        "packages/**/dist/**",
        "public/**",
        "scripts/**",
      ],
      // Since v2, it ignores empty lines by default and we need to disable it as it affects the coverage
      // Additionally the thresholds also needs to be updated slightly as a result of this change
      ignoreEmptyLines: false,
      // Thresholds are enforced ONLY on the merged report (the coverage
      // aggregator job in ci.yml sets VITEST_ENFORCE_THRESHOLDS=1). Per-shard
      // runs collect coverage into blob reports but must NOT check thresholds —
      // each shard only sees its slice, so it would always read ~0% and fail.
      thresholds:
        process.env.VITEST_ENFORCE_THRESHOLDS === "1"
          ? {
              lines: 60,
              branches: 70,
              functions: 63,
              statements: 60,
            }
          : undefined,
    },
  },
});
