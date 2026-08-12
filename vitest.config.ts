import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" -> "./src/*" alias so tests can load app modules.
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/reactimus/**/*.test.ts"],
    environment: "node",
  },
});
