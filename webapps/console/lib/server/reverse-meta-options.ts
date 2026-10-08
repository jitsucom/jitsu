import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  MetaReverseCredentials,
  metaDestinationId,
} from "@jitsu/destination-functions/src/functions/facebook/reverse-meta";
import {
  checkMetaTarget,
  listMetaTargets,
  MetaTargetError,
} from "@jitsu/destination-functions/src/functions/facebook/targets";
import type { MetaFetch } from "@jitsu/destination-functions/src/functions/facebook/client";
import { assertModelsEnabled } from "./reverse-etl-models";
import { ApiError } from "../shared/errors";

async function credentials(prisma: PrismaClient, workspaceId: string, destinationId: string) {
  await assertModelsEnabled(prisma, workspaceId);
  const destination = await prisma.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
  });
  const config = destination?.config as Record<string, unknown> | undefined;
  if (config?.destinationType !== metaDestinationId) throw new ApiError("Meta destination not found", { status: 404 });
  const parsed = MetaReverseCredentials.safeParse(config);
  if (!parsed.success)
    throw new ApiError("Configure this destination's Meta system-user access token first", { status: 409 });
  return parsed.data;
}
async function lookup<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    throw new ApiError(
      error instanceof MetaTargetError
        ? error.message
        : error instanceof z.ZodError
        ? "Enter valid Meta target settings before checking the connection"
        : "Meta target check failed. Try again; no data was submitted.",
      { status: 409 }
    );
  }
}
export async function reverseMetaOptions(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string,
  kind: "meta-account" | "meta-audience",
  scope: { accountId?: string; valueBased?: boolean },
  request: MetaFetch = fetch
) {
  const token = await credentials(prisma, workspaceId, destinationId);
  return lookup(() => listMetaTargets(token, kind, scope, request));
}
export async function reverseMetaCheck(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string,
  stream: "audience" | "conversions",
  streamOptions: unknown,
  request: MetaFetch = fetch
) {
  const token = await credentials(prisma, workspaceId, destinationId);
  return lookup(() => checkMetaTarget(token, stream, streamOptions, request));
}
