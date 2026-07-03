import { defineConfig } from "vite";

// Web Bluetooth requires a secure context (HTTPS or localhost).
// The dev server on localhost counts as a secure context for testing.
export default defineConfig({
  base: "./",
  // Bind to the port the preview harness assigns (PORT env) so concurrent
  // sessions sharing this repo don't collide on a fixed port; fall back to 5173.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
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
