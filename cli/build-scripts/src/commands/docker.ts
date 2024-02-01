import * as path from "path";
import simpleGit from "simple-git";
import * as fs from "fs";
import { compare as semverCompare, parse as semverParse, SemVer } from "semver";
import * as child_process from "child_process";
import { color } from "../colors";
import { drawBox } from "../box";

type ReleaseStream = "beta" | "latest";

type Target = "console" | "rotor" | "bulker" | "ingest" | "syncctl" | "sidecar";

const git = simpleGit();

export type DockerArgs = {
  targets: Target[];
  version?: string;
  release?: ReleaseStream;
  push?: boolean;
  platform?: "linux/amd64" | "linux/arm64" | "linux/amd64,linux/arm64";
  gitTagPrefix?: string;
  dryRun?: boolean;
  pushGitTag?: boolean;
  logs?: string;
};

export async function docker(dir: string | undefined, args: DockerArgs): Promise<void> {
  let version = args.version;
  const dockerTag: ReleaseStream = args.release || "beta";
  const tagPrefix = args.gitTagPrefix || "jitsu2";
  console.log(
    drawBox({
      content: [
        `Hi, I'm Jitsu Docker Builder!`,
        ``,
        `I'm going to build docker images for \`${dockerTag}\` release stream`,
      ],
    })
  );

  version = await adjustVersion(version, dockerTag, tagPrefix);
  console.info(`💁🏻‍ Adjusted version for ${dockerTag} release: ` + color.bold(color.cyan(version)));
  const gitTag = `${tagPrefix}-${version}`;
  if ((await git.tags()).all.includes(gitTag)) {
    throw new Error(`Tag ${gitTag} for next version ${version} already exists. Aborting`);
  }
  const logsDir = args.logs ? path.resolve(__dirname, args.logs) : undefined;
  if (logsDir) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const targets = args.targets.flatMap(t => t.split(","));

  for (const dockerTarget of targets) {
    console.log(
      `🚀 Building ${color.cyan(dockerTarget)} docker with tags: ${color.cyan(
        `jitsucom/${dockerTarget}:${version}`
      )} and ${color.cyan(`jitsucom/${dockerTarget}:${dockerTag}`)}...`
    );
    const dockerImageName = `jitsucom/${dockerTarget}`;
    const dockerArgs = [
      "buildx build",
      `--target ${dockerTarget}`,
      "--progress=plain",
      `--platform ${args.platform || "linux/amd64"}`,
      `-t ${dockerImageName}:${dockerTag}`,
      `-t ${dockerImageName}:${version}`,
      `-f all.Dockerfile`,
      args.push ? "--push" : "--load",
      ".",
    ].filter(Boolean);
    const qt = `${color.gray(color.bold("`"))}`;
    console.log(
      `🎻 Docker command\n\n\t${qt}${color.cyan(
        `docker ${dockerArgs.filter(args => !args.startsWith("--progress")).join(" ")}`
      )}${qt}\n\n\t`
    );
    if (args.dryRun) {
      console.log(`🏃🏻 Skipping actual build because of ${color.cyan("--dry-run")} flag`);
    } else {
      const logPath = logsDir
        ? path.join(logsDir, `${dockerTarget}-docker-build-${new Date().toISOString()}.log`)
        : undefined;
      const stream = logsDir ? fs.createWriteStream(logPath!) : undefined;
      if (stream) {
        console.log(`📝 Writing logs to ${color.cyan(logPath!)}`);
        stream.write(`Building ${dockerImageName}:${dockerTag}\n`);
        stream.write(`Command:\n\tdocker ${dockerArgs.join(" ")}\n`);
        stream.write("=".repeat(80));
        stream.write("\n\n");
      }
      const exitCode = await runCommand("docker", {
        args: [...dockerArgs],
        cwd: dir,
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
  if (!args.dryRun && args.push && args.pushGitTag) {
    console.log(`Pushing git tag ${tagPrefix}-${version}...`);
    await git.addTag(gitTag);
    try {
      await git.pushTags();
    } catch (e) {
      //so far ignore, it happens when there's a conflict in tags
    }
  }
}

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

async function adjustVersion(baseVersion: string | undefined, str: ReleaseStream, tagPrefix: string): Promise<string> {
  let version: SemVer | undefined;
  if (!baseVersion) {
    const gitTags = await git.tags();
    const allSemvers = gitTags.all
      .filter(tag => tag.startsWith(tagPrefix + "-") && tag.indexOf("beta") < 0)
      .map(tag => tag.slice(tagPrefix.length + 1))
      .map(tag => (tag.startsWith("v") ? tag.slice(1) : tag))
      .map(t => semverParse(t))
      .filter(Boolean) as SemVer[];

    version = allSemvers.sort((a, b) => semverCompare(a, b)).pop();

    if (!version) {
      throw new Error(`Couldn't guess version from git tags. Please provide --version param`);
    }
  } else {
    const bs = semverParse(baseVersion);
    if (!bs) {
      throw new Error(`Cannot parse --version ${baseVersion} param as semver`);
    }
    version = bs;
  }

  if (str === "beta") {
    const gitHistory = await git.log();
    const latest = gitHistory.all.length;
    const revision = gitHistory.latest!.hash.slice(0, 7);
    return `${version.major}.${version.minor}.${latest}-${str}.${formatDate(new Date())}.${revision}`;
  } else {
    const nextVersion = `${version.major}.${version.minor}.${version.patch + 1}`;
    console.log(`Found latest stable release: ' + ${version.version}. Going to use ${nextVersion} as next version`);
    return nextVersion;
  }
}

export function runCommand(
  command: string,
  opts: {
    args?: string[];
    cwd?: string;
    outputHandler?: (data: any, opts: { stream: "stderr" | "stdout" }) => void;
  } = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const fullCommand = `${command}${opts.args && opts.args.length > 0 ? " " + opts.args?.join(" ") : ""}`;
    const proc = child_process.exec(
      fullCommand,
      { env: process.env, cwd: opts.cwd ? path.resolve(__dirname, opts.cwd) : undefined },
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
