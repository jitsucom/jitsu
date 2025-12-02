import { JitsuFunction } from "@jitsu/protocols/functions";
import fs from "fs";
import * as esbuild from "esbuild";
import { assertDefined, assertTrue } from "juava";
import path from "path";

export type CompiledFunction = {
  func: JitsuFunction;
  meta: {
    slug: string;
    id?: string;
    name?: string;
    description?: string;
  };
};

function getSlug(filePath: string) {
  return filePath.split("/").pop()?.replace(".ts", "").replace(".js", "");
}

export async function getFunctionFromFilePath(
  projectDir: string,
  filePath: string,
  kind: "function" | "profile",
  profileBuilders: any[] = []
): Promise<CompiledFunction> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot load function from file ${filePath}: file doesn't exist`);
  } else if (!fs.statSync(filePath).isFile()) {
    throw new Error(`Cannot load function from file ${filePath}: path is not a file`);
  }

  // Transform ESM to CJS without bundling - just convert the module format
  // This avoids resolving dependencies which may be symlinked
  const result = await esbuild.transform(fs.readFileSync(filePath, "utf-8"), {
    loader: filePath.endsWith(".ts") ? "ts" : "js",
    format: "cjs",
    platform: "node",
  });

  const code = result.code;
  const module: { exports: Record<string, any> } = { exports: {} };
  const exports = module.exports;
  // Provide require stub for external imports that we mock out
  const require = (id: string) => {
    // External dependencies are not needed for config extraction
    return {};
  };
  eval(code);
  // After eval, module.exports contains the actual exports
  const moduleExports = module.exports;
  assertDefined(
    moduleExports.default,
    `Function from ${filePath} doesn't have default export. Exported symbols: ${Object.keys(moduleExports)}`
  );
  assertTrue(typeof moduleExports.default === "function", `Default export from ${filePath} is not a function`);
  let name = moduleExports.config?.name || moduleExports.config?.slug || getSlug(filePath);
  let id = moduleExports.config?.id;
  if (kind === "profile") {
    const profileBuilderId = moduleExports.config?.profileBuilderId;
    const profileBuilder = profileBuilders.find(pb => pb.id === profileBuilderId);
    if (!profileBuilder) {
      throw new Error(
        `Cannot find profile builder with id ${profileBuilderId} for profile function ${filePath}. Please setup Profile Builder in UI first.`
      );
    }
    name = name || `${profileBuilder.name} function`;
    id = id || profileBuilder.functions[0]?.functionId;
    if (!id) {
      throw new Error(
        `Cannot find function id for profile function ${filePath}. Please setup Profile Builder in UI first.`
      );
    }
  }

  return {
    func: moduleExports.default,
    meta: {
      slug: moduleExports.config?.slug || getSlug(filePath),
      id: id,
      name: name,
      description: moduleExports.config?.description,
    },
  };
}
