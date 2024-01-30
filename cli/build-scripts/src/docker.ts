import minimist from "minimist";
import * as path from "path";
import simpleGit from "simple-git";
import * as fs from "fs";
import { compare as semverCompare, parse as semverParse, SemVer } from "semver";
import * as child_process from "child_process";
import { color } from "./colors";
import { drawBox } from "./box";

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
    console.log(`Found latest stable release: ' + ${latest.version}. Going to use ${nextVersion} as next version`);
    return nextVersion;
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
  const dryRun = !!(args["dry-run"] || false);
  console.log(
    drawBox({
      content: [`Hi, I'm Jitsu Docker Builder!`, ``, `I'm going to build docker images for \`${tag}\` release stream`],
    })
  );
  if (!version) {
    version = await getAutomaticVersion(tag, tagPrefix);
    console.info(
      "💁🏻‍ Version (--version param) is not specified, using automatic version: " + color.bold(color.cyan(version))
    );
  }
  const gitTag = `${tagPrefix}-${version}`;
  if ((await git.tags()).all.includes(gitTag)) {
    throw new Error(`Tag ${gitTag} for next version ${version} already exists. Aborting`);
  }
  const logsDir = args["logs"] ? path.resolve(__dirname, "../../../", args["logs"]) : undefined;
  if (logsDir) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  for (const dockerTarget of ["console", "rotor"]) {
    console.log(
      `🚀 Building ${color.cyan(dockerTarget)} docker with tags: ${color.cyan(
        `jitsucom/${dockerTarget}:${version}`
      )} and ${color.cyan(`jitsucom/${dockerTarget}:${tag}`)}...`
    );
    const dockerImageName = `jitsucom/${dockerTarget}`;
    const dockerArgs = [
      "buildx build",
      `--target ${dockerTarget}`,
      "--progress=plain",
      args["platform"] && `--platform ${args["platform"]}`,
      `-t ${dockerImageName}:${tag}`,
      `-t ${dockerImageName}:${version}`,
      `-f all.Dockerfile`,
      args["push-docker"] ? "--push" : "--load",
      ".",
    ].filter(Boolean);
    const qt = `${color.gray(color.bold("`"))}`;
    console.log(
      `🎻 Docker command\n\n\t${qt}${color.cyan(
        `docker ${dockerArgs.filter(args => !args.startsWith("--progress")).join(" ")}`
      )}${qt}\n\n\t`
    );
    if (dryRun) {
      console.log(`🏃🏻 Skipping actual build because of ${color.cyan("--dry-run")} flag`);
    } else {
      const logPath = logsDir
        ? path.join(logsDir, `${dockerTarget}-docker-build-${new Date().toISOString()}.log`)
        : undefined;
      const stream = logsDir ? fs.createWriteStream(logPath!) : undefined;
      if (stream) {
        console.log(`📝 Writing logs to ${color.cyan(logPath!)}`);
        stream.write(`Building ${dockerImageName}:${tag}\n`);
        stream.write(`Command:\n\tdocker ${dockerArgs.join(" ")}\n`);
        stream.write("=".repeat(80));
        stream.write("\n\n");
      }
      const exitCode = await runCommand("docker", {
        args: [...dockerArgs],
        outputHandler: (data, opts) => {
          const dataStr = data.toString();
          dataStr.split("\n").forEach(line => {
            if (!logsDir) {
              process.stdout.write(`${color.green(dockerTarget)}: ${line}\n`);
            }
            if (stream) {
              stream.write(`${line}\n`);
            }
          });
        },
      });
      if (stream) {
        stream.write("=".repeat(80));
        stream.write("\n\n");
        stream.end();
      }
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
