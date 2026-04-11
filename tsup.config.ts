import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    dts: false,
    format: ["esm"],
    target: "node23",
    external: [
        "@elizaos/core",
        "@elizaos/client-airi3",
    ],
});
