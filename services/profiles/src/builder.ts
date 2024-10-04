import { ProfileBuilder, Workspace } from "@jitsu/core-functions";
import { ProfileBuilderState } from "./lib/db";
import { getLog } from "juava";

export type ProfileBuilderRunner = {
  start: () => Promise<void>;
  close: () => Promise<void>;
  version: () => number;
  state: () => ProfileBuilderState;
};

export function profileBuilder(workspaceId: string, profileBuilder: ProfileBuilder): ProfileBuilderRunner {
  const instanceIndex = process.env.INSTANCE_INDEX ? parseInt(process.env.INSTANCE_INDEX, 10) : 0;
  const totalInstances = process.env.INSTANCES_COUNT ? parseInt(process.env.INSTANCES_COUNT, 10) : 1;

  const log = getLog(`pb-${workspaceId}-${profileBuilder.id}`);
  let state: ProfileBuilderState = {
    profileBuilderId: profileBuilder.id,
    profileBuilderVersion: profileBuilder.version,
    startedAt: new Date(),
    updatedAt: new Date(),
    lastTimestamp: undefined,
    instanceIndex,
    totalInstances,
    processedUsers: 0,
    totalUsers: 0,
    speed: 0,
  };
  let closed = false;
  let closeResolve;
  const promise = new Promise((resolve, reject) => {
    closeResolve = resolve;
  });

  const pb = {
    start: async () => {
      log.atInfo().log("Started");
    },
    close: async () => {
      log.atInfo().log("Closed");
    },
    version: () => profileBuilder.version,
    state: () => state,
  };

  setImmediate(pb.start);

  return pb;
}
