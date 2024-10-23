import { JitsuFunction } from "@jitsu/protocols/functions";
import fs from "fs";
import { rollup } from "rollup";
import { assertDefined, assertTrue } from "juava";

export type CompiledFunction = {
  func: JitsuFunction;
  meta: {
    slug: string;
    name?: string;
    description?: string;
  };
};

function getSlug(filePath: string) {
  return filePath.split("/").pop()?.replace(".ts", "");
}

export async function getFunctionFromFilePath(
  filePath: string,
  kind: "function" | "profile",
  profileBuilders: any[] = []
): Promise<CompiledFunction> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot load function from file ${filePath}: file doesn't exist`);
  } else if (!fs.statSync(filePath).isFile()) {
    throw new Error(`Cannot load function from file ${filePath}: path is not a file`);
  }

  const bundle = await rollup({
    input: [filePath],
    external: ["@jitsu/functions-lib"],
    logLevel: "silent",
  });

  const output = await bundle.generate({
    file: filePath,
    format: "commonjs",
  });

  const exports: Record<string, any> = {} as Record<string, any>;
  eval(output.output[0].code);
  assertDefined(
    exports.default,
    `Function from ${filePath} doesn't have default export. Exported symbols: ${Object.keys(exports)}`
  );
  assertTrue(typeof exports.default === "function", `Default export from ${filePath} is not a function`);

  let name = exports.config?.name || exports.config?.slug || getSlug(filePath);
  if (kind === "profile") {
    const profileBuilderId = exports.config?.profileBuilderId;
    const profileBuilder = profileBuilders.find(pb => pb.id === profileBuilderId);
    name = `${profileBuilder.name} function`;
  }

  return {
    func: exports.default,
    meta: {
      slug: exports.config?.slug || getSlug(filePath),
      name: name,
      description: exports.config?.description,
    },
  };
}
