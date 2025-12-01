import { getServerEnv } from "./server/serverEnv";

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
  const serverEnv = getServerEnv();
  const env: EnvVars = {
    JITSU_VERSION_COMMIT_SHA: serverEnv.JITSU_VERSION_COMMIT_SHA,
    JITSU_VERSION_DOCKER_TAG: serverEnv.JITSU_VERSION_DOCKER_TAG,
    JITSU_VERSION_STRING: serverEnv.JITSU_VERSION_STRING,
    VERCEL_GIT_COMMIT_SHA: serverEnv.VERCEL_GIT_COMMIT_SHA,
  };
  return {
    version: env.JITSU_VERSION_STRING || "dev",
    stream: env.JITSU_VERSION_DOCKER_TAG || "dev",
    git: getGit(env),
  };
}
