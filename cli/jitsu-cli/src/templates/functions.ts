import { ProjectTemplate } from "../lib/template";
import { jitsuCliVersion, jitsuCliPackageName } from "../lib/version";
import { sanitize } from "juava";

export type TemplateVars = {
  license?: "MIT" | "Other";
  packageName: string;
  jitsuVersion?: string;
};

export const packageJsonTemplate = ({ packageName, license = "MIT", jitsuVersion = undefined }: TemplateVars) => ({
  name: `${packageName}`,
  version: "0.0.1",
  description: `Jitsu extension - ${packageName}`,
  license: license,
  keywords: ["jitsu", "jitsu-cli", "function", `jitsu-extension`],
  scripts: {
    clean: "rm -rf ./dist",
    build: `${jitsuCliPackageName} build`,
    test: `${jitsuCliPackageName} test`,
    deploy: `${jitsuCliPackageName} deploy`,
  },
  devDependencies: {
    "jitsu-cli": `${jitsuVersion || "^" + jitsuCliVersion}`,
    "@jitsu/protocols": `${jitsuVersion || "^" + jitsuCliVersion}`,
    "@jitsu/functions-lib": `${jitsuVersion || "^" + jitsuCliVersion}`,
    "@types/jest": "^29.5.5",
    "ts-jest": "^29.1.1",
  },
  dependencies: {},
});

let functionTest = ({ packageName }: TemplateVars) => {
  return `
test("${sanitize(packageName)} test", () => {
  //TODO: implement test
});
`;
};

let functionCode = ({}: TemplateVars) => {
  return `
import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

export const config = {
    slug: "hello.ts", //id (uniq per workspace) used to identify function in Jitsu
    name: "Hello World Function", //human readable name of function
    description: ""
};

const helloWorldFunction: JitsuFunction<AnalyticsServerEvent, any> = async (event, { log, fetch, props, store, geo, ...meta }) => {
    //output "Hello World!" to logs and return unchanged event
    log.info("Hello World!");
    return event
};

export default helloWorldFunction;
`;
};

let profileTest = ({ packageName }: TemplateVars) => {
  return `
test("${sanitize(packageName)} test", () => {
  //TODO: implement test
});
`;
};

let profileCode = ({}: TemplateVars) => {
  return `
import { ProfileFunction } from "@jitsu/protocols/profile";

export const config = {
    slug: "profile-example.ts", //id (uniq per workspace) used to identify function in Jitsu
    profileBuilderId: "", // id of Profile Builder object where this function will be used
    description: ""
};

const profileExample: ProfileFunction = async ({ context, events, user}) => {
  context.log.info("Profile func: " + user.id)
  const profile = {} as any
  for (const event of events) {
     profile.lastMessageDate = Math.max(new Date(event.timestamp).getTime(),profile.lastMessageDate??0)
  }
  profile.traits = user.traits
  profile.anonId = user.anonymousId
  return {
    properties: profile
  }
};

export default profileExample;
`;
};

export const functionProjectTemplate: ProjectTemplate<TemplateVars> = ({ packageName }: TemplateVars) => ({
  [`__tests__/profiles/profile-example.test.ts`]: profileTest,
  [`__tests__/functions/hello.test.ts`]: functionTest,
  [`src/profiles/profile-example.ts`]: profileCode,
  [`src/functions/hello.ts`]: functionCode,
  "package.json": packageJsonTemplate,
  "tsconfig.json": {
    compilerOptions: {
      rootDir: "./src",
      outDir: "./dist",
      declaration: true,
      esModuleInterop: true,
      moduleResolution: "node",
      importHelpers: false,
      module: "esnext",
      lib: ["esnext", "dom"],
      noEmit: false,
      target: "esnext",
    },
    target: "esnext",
    exclude: ["__tests__", "node_modules", "dist"],
  },
});
