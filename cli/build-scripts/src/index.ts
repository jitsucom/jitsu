import { Command, Option, Argument } from "commander";
import { docker } from "./commands/docker";
import pkg from "../package.json";

const version = pkg.version;
const packageName = pkg.name;

console.log("Jitsu build-scripts. Version: " + version + "\n");

const p = new Command();

p.name("build-scripts").description("CLI command to create, test and deploy extensions for Jitsu Next");

p.command("docker")
  .description("Builds and pushes docker images for Jitsu Next services")
  .addArgument(new Argument("[dir]", "directory of project to build. Must contain all.Dockerfile file"))
  .addOption(new Option("-t, --targets <targets...>", "list of Dockerfile targets to build."))
  .option(
    "-v, --version <semver>",
    "base version of release in semver format. Required for the first release or version bumps."
  )
  .addOption(new Option("--release <tag>", "docker release tag to use").default("beta").choices(["beta", "latest"]))
  .option("--push", "whether to push images to docker hub or load it locally", false)
  .addOption(
    new Option("--platform <platform>", "docker platform to build for")
      .default("linux/amd64")
      .choices(["linux/amd64", "linux/arm64", "linux/amd64,linux/arm64"])
  )
  .option("--gitTagPrefix <prefix>", "prefix that will be used for git tag before version", "jitsu2")
  .option("--dryRun", "dry run. Just prints commands that will be executed and do not build anything", false)
  .option("--pushGitTag", "push git tag to origin (only after docker push)", true)
  .option("--logs <path>", "path to directory where logs will be stored")
  .action(docker);

//version
//p.version(packageName + " " + version, "-v, --version");
//help
//p.helpOption("--help", "display help for command");

p.parse();
