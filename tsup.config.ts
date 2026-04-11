import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    target: "node23",
    external: [
        "@elizaos/core",
        "express",
        "ws",
        "cors",
        "uuid",
        "dotenv",
        "fs",
        "path",
        "http",
        "https",
        "@reflink/reflink",
        "@node-llama-cpp",
        "agentkeepalive",
    ],
});
