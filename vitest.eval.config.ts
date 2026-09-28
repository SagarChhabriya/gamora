import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // Route helpers import next/server; evals run outside a request, so a stub is enough.
      "next/server": resolve(__dirname, "tests/eval/next-server-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
