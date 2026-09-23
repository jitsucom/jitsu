import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["pg-native"],
});
