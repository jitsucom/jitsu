import { isTruish } from "juava";

/**
 * A little code duplication with console. Not ideal, although better than
 * moving it to common dependency (juava).
 */
export type ApplicationVersion = {
  /**
   * Version as 3.2.1 or "dev"
   */
  version: string;
  /**
   * "latest" or "beta" or "dev"
   */
  stream: string;

  git?: {
    //Id of latest commit
    commitId: string;
  };
};

export type EnvVars = {
  JITSU_VERSION_COMMIT_SHA?: string;
  JITSU_VERSION_DOCKER_TAG?: string;
  JITSU_VERSION_STRING?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

function getGit(env: EnvVars): ApplicationVersion["git"] {
  if (env.JITSU_VERSION_COMMIT_SHA) {
    return {
      commitId: env.JITSU_VERSION_COMMIT_SHA,
    };
  } else if (env.JITSU_VERSION_COMMIT_SHA) {
    return {
      commitId: env.JITSU_VERSION_COMMIT_SHA,
    };
  }
}

export function getApplicationVersion(): ApplicationVersion {
  const env = process.env as EnvVars;
  return {
    version: env.JITSU_VERSION_STRING || "dev",
    stream: env.JITSU_VERSION_DOCKER_TAG || "dev",
    git: getGit(env),
  };
}

function sortByKey(dict: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
}

export function getDiagnostics() {
  if (isTruish(process.env.__DANGEROUS_ENABLE_FULL_DIAGNOSTICS)) {
    return {
      env: sortByKey(process.env),
      proc: {
        config: sortByKey(process.config),
        versions: sortByKey(process.versions),
        execPath: process.execPath,
        argv: process.argv,
      },
    };
  }
}
