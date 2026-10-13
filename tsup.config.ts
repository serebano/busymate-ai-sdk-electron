import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    shims: true,
    clean: true,
    platform: "node",
    target: "node20",
    external: ["electron"],
    outDir: "dist",
  },
  {
    // Compiled separately and appended to the frozen preload by scripts/build-preload.mjs.
    entry: { "preload-microphone": "src/preload-microphone.ts" },
    format: ["cjs"],
    clean: true,
    platform: "node",
    target: "chrome120",
    external: ["electron"],
    outDir: "build/preload",
  },
]);
