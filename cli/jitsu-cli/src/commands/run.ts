import chalk from "chalk";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { UDFTestRun } from "@jitsu/core-functions";
import { getLog } from "juava";
import { httpAgent, httpsAgent } from "@jitsu/core-functions/src/functions/lib/http-agent";
import JSON5 from "json5";
import { getDistFile, loadPackageJson } from "./shared";
import isEqual from "lodash/isEqual";

const currentDir = process.cwd();

export async function run({ dir, event, store, props }: { dir?: string; event: any; store?: any; props?: any }) {
  const projectDir = dir || currentDir;
  console.log(`Running ${chalk.bold(projectDir)}`);

  const packageJson = loadPackageJson(projectDir);

  const eventJson = parseJson5("event", event);
  const propsJson = parseJson5("props", props);
  const storeJson = parseJson5("store", store);
  const originalStore = { ...storeJson };

  const file = getDistFile(projectDir, packageJson);
  const name = packageJson.name || "function";
  const log = getLog({
    level: "debug",
    component: name,
  });

  await httpAgent.waitInit();
  await httpsAgent.waitInit();

  const result = await UDFTestRun({
    functionId: name,
    functionName: name,
    event: eventJson,
    config: propsJson,
    store: storeJson,
    code: readFileSync(file, "utf-8"),
    workspaceId: "test",
  });
  console.log(chalk.bold("Function logs:"));
  for (const logItem of result.logs) {
    const logFunc = (() => {
      switch (logItem.level) {
        case "error":
          return log.atError();
        case "warn":
          return log.atWarn();
        case "debug":
          return log.atDebug();
        default:
          return log.atInfo();
      }
    })();
    logFunc.log(logItem.message);
  }
  console.log(chalk.bold("Function result:"));
  if (result.error) {
    log.atError().log("Error:", result.error);
  } else if (result.dropped) {
    log.atInfo().log(`Further processing will be SKIPPED. Function returned: ${JSON.stringify(result)}`);
  } else {
    console.log(JSON.stringify(result.result, null, 2));
  }
  //if store was changed - print it
  if (!isEqual(originalStore, storeJson)) {
    console.log(chalk.bold("Function store was changed:"));
    console.log(JSON.stringify(storeJson, null, 2));
  }
  process.exit(0);
}

function parseJson5(name: string, jsonOrFilename?: string) {
  if (!jsonOrFilename) {
    return {};
  }
  if (jsonOrFilename.startsWith("{")) {
    try {
      return JSON5.parse(jsonOrFilename);
    } catch (e: any) {
      throw new Error(`Failed to parse JSON for ${chalk.underline(name)}: ${e.message}`);
    }
  } else {
    const jsonPath = path.resolve(currentDir, jsonOrFilename);
    try {
      return JSON5.parse(readFileSync(jsonPath, "utf-8"));
    } catch (e: any) {
      throw new Error(`Failed to parse JSON for ${chalk.underline(name)} from ${jsonPath}: ${e.message}`);
    }
  }
}
