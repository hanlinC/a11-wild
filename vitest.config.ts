import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "api", root: "services/api", environment: "node", include: ["test/**/*.test.ts"] } },
      { test: { name: "infra", root: "infra", environment: "node", include: ["test/**/*.test.ts"] } },
      { test: { name: "scripts", root: "scripts", environment: "node", include: ["**/*.test.mjs"] } },
      "web/vitest.config.ts",
    ],
  },
});
