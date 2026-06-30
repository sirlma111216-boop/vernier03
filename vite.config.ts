import { defineConfig } from "vite";

// Web Bluetooth requires a secure context (HTTPS or localhost).
// The dev server on localhost counts as a secure context for testing.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
