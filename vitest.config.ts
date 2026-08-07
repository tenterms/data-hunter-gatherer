import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/reactimus/**/*.test.ts"],
    environment: "node",
  },
});
