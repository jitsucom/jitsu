import chalk from "chalk";
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { UDFTestRun } from "@jitsu/core-functions";
import { getLog } from "juava";
import { httpAgent, httpsAgent } from "@jitsu/core-functions/src/functions/lib/http-agent";
import JSON5 from "json5";
import { loadPackageJson } from "./shared";
import isEqual from "lodash/isEqual";
import { b, red } from "../lib/chalk-code-highlight";
import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";
import inquirer from "inquirer";

const currentDir = process.cwd();

export async function run({
  dir,
  name,
  event,
  store,
  props,
}: {
  dir?: string;
  name;
  event: any;
  store?: any;
  props?: any;
}) {
  const { packageJson, projectDir } = await loadPackageJson(dir || currentDir);

  const eventJson = parseJson5("event", event);
  const propsJson = parseJson5("props", props);
  const storeJson = parseJson5("store", store);
  const originalStore = { ...storeJson };

  await httpAgent.waitInit();
  await httpsAgent.waitInit();

  const functionsDir = path.resolve(projectDir, "dist/functions");
  if (!existsSync(functionsDir)) {
    console.error(red(`Can't find dist directory: ${b(functionsDir)} . Please build project first.`));
    process.exit(1);
  }
  const fname = n => (n ? (n.endsWith(".js") ? n : `${n.replace(".ts", "")}.js`) : undefined);
  const functionsFiles = readdirSync(functionsDir);
  let functionFile: string | undefined = undefined;

  if (name) {
    functionFile = functionsFiles.find(f => f === fname(name));
  } else {
    if (functionsFiles.length === 1) {
      functionFile = functionsFiles[0];
    } else {
      name = (
        await inquirer.prompt([
          {
            type: "list",
            name: "name",
            message: `Select workspace:`,
            choices: functionsFiles.map(w => ({
              name: w,
              value: w,
            })),
          },
        ])
      ).name;
      functionFile = functionsFiles.find(f => f === name);
    }
  }
  if (!functionFile) {
    console.error(
      red(
        `Can't find function: ${b(fname(name))} in ${b(
          "dist/functions"
        )} directory. Please make sure that you have built the project.`
      )
    );
    process.exit(1);
  }
  console.log(`Running ${b(functionFile)}`);
  const n = functionFile.replace(".js", "");
  const log = getLog({
    level: "debug",
    component: n,
  });
  const result = await UDFTestRun({
    functionId: n,
    functionName: n,
    event: eventJson,
    config: propsJson,
    store: storeJson,
    code: readFileSync(path.resolve(functionsDir, functionFile), "utf-8"),
    workspaceId: "test",
  });
  console.log(b("Function logs:"));
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
  console.log(b("Function result:"));
  if (result.error) {
    log.atError().log(`Error: ${result.error.name}: ${result.error.message}`);
    if (result.error.name == DropRetryErrorName) {
      log
        .atError()
        .log(
          `If such error will happen on an actual event, it will be ${b("SKIPPED")} and retry will be scheduled in ${
            result.error.retryPolicy?.delays?.[0] ? Math.min(result.error.retryPolicy.delays[0], 1440) : 5
          } minutes.`
        );
    } else if (result.error.name == RetryErrorName) {
      log
        .atError()
        .log(
          `If such error will happen on an actual event, this function will be scheduled for retry in ${
            result.error.retryPolicy?.delays?.[0] ? Math.min(result.error.retryPolicy.delays[0], 1440) : 5
          } minutes, but event will be processed further.`
        );
    }
  } else if (result.dropped) {
    log.atInfo().log(`Further processing will be ${b("SKIPPED")}. Function returned: ${JSON.stringify(result)}`);
  } else {
    console.log(JSON.stringify(result.result, null, 2));
  }
  //if store was changed - print it
  if (!isEqual(originalStore, storeJson)) {
    console.log(b("Function store was changed:"));
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
