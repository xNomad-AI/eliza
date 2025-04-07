import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    dts: {
        resolve: true,
    },
    format: ["esm", "cjs"],
    external: [
        "dotenv",
        "path",
        "@reflink/reflink",
        "@node-llama-cpp",
        "https",
        "http",
        "agentkeepalive"
    ],
});
