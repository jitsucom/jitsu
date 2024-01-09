import minimist from "minimist";
import * as path from "path";
import simpleGit from "simple-git";
import * as fs from "fs";
import { compare as semverCompare, parse as semverParse, SemVer } from "semver";
import * as child_process from "child_process";

type ReleaseStream = "beta" | "latest";

const git = simpleGit();

function formatDate(date: Date): number {
  const pad = number => number.toString().padStart(2, "0");

  let year = date.getFullYear();
  let month = pad(date.getMonth() + 1); // getMonth() returns 0-11
  let day = pad(date.getDate());
  let hour = pad(date.getHours());
  let minute = pad(date.getMinutes());
  let second = pad(date.getSeconds());

  return parseInt(`${year}${month}${day}${hour}${minute}${second}`);
}

async function getAutomaticVersion(str: ReleaseStream, tagPrefix: string): Promise<string> {
  const versions = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../.versions.json")).toString());
  if (str === "beta") {
    const [major, minor] = versions.beta.split(".");
    const gitHistory = await git.log();
    const latest = gitHistory.all.length;
    const revision = gitHistory.latest!.hash.slice(0, 7);
    return `${major}.${minor}.${latest}-beta.${formatDate(new Date())}.${revision}`;
  }
  const gitTags = await git.tags();
  const allSemvers = gitTags.all
    .filter(tag => tag.startsWith(tagPrefix + "-") && tag.indexOf("beta") < 0)
    .map(tag => tag.slice(tagPrefix.length + 1))
    .map(tag => (tag.startsWith("v") ? tag.slice(1) : tag))
    .map(t => semverParse(t))
    .filter(Boolean) as SemVer[];

  const latest = allSemvers.sort((a, b) => semverCompare(a, b)).pop();
  if (latest) {
    const nextVersion = `${latest.major}.${latest.minor}.${latest.patch + 1}`;
    console.log(`Found latest stable release: ' + ${latest.version}. Going touse ${nextVersion} as next version`);
  }
  const [major, minor] = versions.latest.split(".");
  return `${major}.${minor}.0`;
}

export function runCommand(
  command: string,
  opts: {
    args?: string[];
    outputHandler?: (data: any, opts: { stream: "stderr" | "stdout" }) => void;
  } = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const fullCommand = `${command}${opts.args && opts.args.length > 0 ? " " + opts.args?.join(" ") : ""}`;
    const proc = child_process.exec(
      fullCommand,
      { env: process.env, cwd: path.resolve(__dirname, "../../../") },
      error => {
        if (error) {
          console.log(
            `Command \`${fullCommand}\`\n\tfailed with exit code ${error.code}: ${error?.message} || unknown error`
          );
          reject(error);
        } else {
          resolve(0);
        }
      }
    );
    proc.stdout?.on("data", data => {
      if (data && opts.outputHandler) {
        opts.outputHandler(data, { stream: "stdout" });
      }
    });
    proc.stderr?.on("data", data => {
      if (data && opts.outputHandler) {
        opts.outputHandler(data, { stream: "stderr" });
      }
    });
  });
}

export async function docker(args: minimist.ParsedArgs): Promise<void> {
  let version = args.version;
  const tag: ReleaseStream = args.tag || "beta";
  const tagPrefix = args.taxPrefix || "jitsu2";
  const dockerPlatforms = args.dockerPlatforms;
  const dryRun = !!(args["dry-run"] || false);
  if (!version) {
    version = await getAutomaticVersion(tag, tagPrefix);
    console.info("--version is not specified, using automatic version: " + version);
  }
  const gitTag = `${tagPrefix}-${version}`;
  if ((await git.tags()).all.includes(gitTag)) {
    throw new Error(`Tag ${gitTag} for next version ${version} already exists. Aborting`);
  }

  for (const dockerTarget of ["console", "rotor"]) {
    console.log(`Building jitsucom/${dockerTarget}:${version}...`);
    const dockerImageName = `jitsucom/${dockerTarget}`;
    const dockerArgs = [
      "buildx build",
      `--target ${dockerTarget}`,
      "--progress plain",
      args["docker-platforms"] && `--platform ${dockerPlatforms}`,
      `-t ${dockerImageName}:${tag}`,
      `-t ${dockerImageName}:${version}`,
      `-f all.Dockerfile`,
      args["push-docker"] ? "--push" : "--load",
      ".",
    ].filter(Boolean);
    if (dryRun) {
      console.log("Dry run: docker " + dockerArgs.join(" "));
    } else {
      const exitCode = await runCommand("docker", {
        args: [...dockerArgs],
        outputHandler: (data, opts) => {
          const dataStr = data.toString();
          dataStr.split("\n").forEach(line => {
            process.stdout.write(`${dockerTarget}: ${line}\n`);
          });
        },
      });
      if (exitCode != 0) {
        throw new Error(`Docker build failed with exit code ${exitCode}`);
      }
    }
  }
  if (args["push-git-tag"]) {
    console.log(`Pushing git tag ${tagPrefix}-${version}...`);
    await git.addTag(gitTag);
    try {
      await git.pushTags();
    } catch (e) {
      //so far ignore, it happens when there's a conflict in tags
    }
  }
}
