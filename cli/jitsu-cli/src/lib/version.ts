import pkg from "../../package.json";
import chalk from "chalk";
import semver from "semver/preload";
const fetch = require("cross-fetch");

export const jitsuCliVersion = pkg.version;
export const jitsuCliPackageName = pkg.name;
let newVersion = undefined;

export function getUpgradeMessage(newVersion: string, oldVersion: string) {
  return box(
    `🚀 New version of Jitsu CLI is available: ${oldVersion} → ${chalk.green(newVersion)} \n   Run ${chalk.bold(
      "npm install -g " + jitsuCliPackageName
    )} or ${chalk.bold("yarn global install " + jitsuCliPackageName)}`
  );
}
function padRight(str: string, minLen: number, symbol: string = " ") {
  return str.length >= minLen ? str : str + symbol.repeat(minLen - str.length);
}
export function box(msg: string) {
  let lines = msg.split("\n");
  return ["──".repeat(80), ...lines.map(ln => ` ${ln}`), "──".repeat(80)].join("\n");
}

export async function hasNewerVersion(): Promise<string | undefined> {
  try {
    let json = (await (
      await fetch(`https://registry.npmjs.org/-/package/${jitsuCliPackageName}/dist-tags`)
    ).json()) as any;
    let latestVersion = json.latest;
    return semver.gt(latestVersion, jitsuCliVersion) ? latestVersion : undefined;
  } catch (e: any) {
    console.debug(`Failed to fetch latest version of ${jitsuCliPackageName}: ${e?.message}`);
  }
}
