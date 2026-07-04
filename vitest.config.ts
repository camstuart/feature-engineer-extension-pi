import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: [".pi/extensions/feature-engineer/**/*.ts"],
      exclude: [".pi/extensions/feature-engineer/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, ".pi/extensions/feature-engineer"),
    },
  },
});
