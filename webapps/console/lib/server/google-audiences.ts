import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { createGoogleAudienceManagement } from "@jitsu/destination-functions/src/functions/google-ads-reverse/audiences";
import {
  GoogleAudienceCredentials,
  GoogleAudienceOptions,
  GoogleManagedAudience,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { ApiError } from "../shared/errors";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";
import type { NangoConfig } from "./oauth/nango-config";

// Intentionally not registered with generic config CRUD: callers cannot forge
// server-recorded creation/baseline evidence through editable destination JSON.
const objectType = "reverse-google-audience";
const syncId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const CreateGoogleAudience = z
  .object({
    destinationId: z.string().min(1).max(128),
    syncId,
    requestId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(120),
    exclusiveManagementConfirmed: z.literal(true),
    customerMatchTermsAccepted: z.literal(true),
  })
  .strict();
const intentSchema = z.object({
  version: z.literal(1),
  phase: z.enum(["prepared", "submitting", "ready"]),
  destinationId: z.string(),
  syncId,
  configBinding: z.string(),
  creationNonce: z.string().regex(/^[a-f0-9]{64}$/),
  displayName: z.string(),
  integrationCode: z.string(),
  customerId: z.string(),
  audienceId: z.string().optional(),
  membershipDays: z.literal(540),
});
type ReadDb = Pick<Prisma.TransactionClient, "configurationObject" | "configurationObjectLink" | "workspace">;
const denied = () =>
  new ApiError("Google audience unavailable; verify workspace, destination and managed-audience binding", {
    status: 409,
  });

async function readDestination(db: ReadDb, workspaceId: string, destinationId: string) {
  const workspace = await db.workspace.findFirst({ where: { id: workspaceId, deleted: false } });
  const destination = await db.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
  });
  if (
    !workspace?.featuresEnabled.includes("reverse-etl") ||
    !destination ||
    z.object({ destinationType: z.literal("google-ads") }).safeParse(destination.config).success === false
  )
    throw denied();
  const parsed = GoogleAudienceCredentials.safeParse(destination.config);
  if (!parsed.success || parsed.data.oauthConnectionId !== `destination.${destinationId}`) throw denied();
  return parsed.data;
}

/** Used only by authenticated export/admission. Never trust a supplied proof blob. */
export async function managedGoogleAudienceForSync(
  db: Pick<ReadDb, "configurationObject">,
  workspaceId: string,
  destinationId: string,
  ownerSyncId: string,
  rawOptions: unknown,
  destination: unknown
): Promise<GoogleManagedAudience | undefined> {
  const options = GoogleAudienceOptions.parse(rawOptions);
  if (!options.managedAudienceId) return;
  const row = await db.configurationObject.findFirst({
    where: { id: options.managedAudienceId, workspaceId, type: objectType, deleted: false },
  });
  const record = intentSchema.safeParse(row?.config);
  const credentials = GoogleAudienceCredentials.safeParse(destination);
  if (
    !row ||
    !record.success ||
    !credentials.success ||
    record.data.phase !== "ready" ||
    record.data.destinationId !== destinationId ||
    record.data.syncId !== ownerSyncId ||
    record.data.audienceId !== options.audienceId ||
    record.data.configBinding !== contentHash(credentials.data)
  )
    throw denied();
  return GoogleManagedAudience.parse({
    id: row.id,
    syncId: ownerSyncId,
    customerId: record.data.customerId,
    audienceId: record.data.audienceId,
    displayName: record.data.displayName,
    integrationCode: record.data.integrationCode,
    membershipDays: record.data.membershipDays,
  });
}

/** Explicit provisioning, never called by runner delivery/recovery. */
export async function provisionGoogleAudience(
  prisma: PrismaClient,
  workspaceId: string,
  rawInput: unknown,
  nango: NangoConfig,
  request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(30_000)
) {
  const input = CreateGoogleAudience.parse(rawInput);
  const credentials = await readDestination(prisma, workspaceId, input.destinationId);
  const requireLiveSync = async () => {
    const existingSync = await prisma.configurationObjectLink.findFirst({
      where: { id: input.syncId, workspaceId, toId: input.destinationId, type: "reverse-sync", deleted: false },
      select: { id: true },
    });
    if (!existingSync) throw denied();
  };
  // The future editor must create a disabled link first, then provision its audience.
  // A caller-chosen ID cannot be adopted by normal link creation later.
  await requireLiveSync();
  const key = createHash("sha256")
    .update(JSON.stringify([workspaceId, input.destinationId, input.syncId, input.requestId]))
    .digest("hex");
  const id = `retl-google-${key}`;
  // Server entropy prevents a caller from pre-stamping an existing Google list
  // with predictable request-derived metadata and having discovery adopt it.
  const makeIntent = (creationNonce: string) => ({
    version: 1 as const,
    phase: "prepared" as const,
    destinationId: input.destinationId,
    syncId: input.syncId,
    configBinding: contentHash(credentials),
    customerId: credentials.customerId,
    creationNonce,
    displayName: `${input.displayName} [Jitsu ${creationNonce.slice(0, 12)}]`,
    integrationCode: `jitsu-retl-${creationNonce}`,
    membershipDays: 540 as const,
  });
  // createMany/skipDuplicates preserves an existing intent even across console
  // replicas. No remote calls happen inside this short DB transaction.
  await prisma.configurationObject.createMany({
    data: [{ id, workspaceId, type: objectType, config: makeIntent(randomBytes(32).toString("hex")) }],
    skipDuplicates: true,
  });
  const readIntent = async () => {
    const row = await prisma.configurationObject.findFirst({
      where: { id, workspaceId, type: objectType, deleted: false },
    });
    const parsed = intentSchema.safeParse(row?.config);
    if (!parsed.success) throw denied();
    const { audienceId: _audienceId, phase: _phase, ...binding } = parsed.data;
    if (contentHash({ ...binding, phase: "prepared" }) !== contentHash(makeIntent(parsed.data.creationNonce)))
      throw denied();
    return parsed.data;
  };
  let saved = await readIntent();
  // Concurrent callers always use the nonce from the winning persisted intent.
  const intent = makeIntent(saved.creationNonce);
  const token = await readGoogleAudienceConnectionToken(credentials.oauthConnectionId, nango, request, signal);
  if (contentHash(await readDestination(prisma, workspaceId, input.destinationId)) !== intent.configBinding)
    throw denied();
  // OAuth I/O can outlive a link deletion; recheck before any Google request.
  await requireLiveSync();
  const api = createGoogleAudienceManagement(credentials, async () => token.accessToken, request);
  if (saved.phase === "ready") {
    await api.verifyManaged(
      GoogleManagedAudience.parse({
        id,
        syncId: saved.syncId,
        customerId: saved.customerId,
        audienceId: saved.audienceId,
        displayName: saved.displayName,
        integrationCode: saved.integrationCode,
        membershipDays: saved.membershipDays,
      }),
      signal
    );
    return { id, status: "ready" as const, audienceId: saved.audienceId, displayName: saved.displayName };
  }
  signal.throwIfAborted();
  const claimed = await prisma.configurationObject.updateMany({
    where: { id, workspaceId, type: objectType, deleted: false, config: { path: ["phase"], equals: "prepared" } },
    data: { config: { ...intent, phase: "submitting" } },
  });
  let result: { audienceId: string } | undefined;
  try {
    result = claimed.count ? await api.create(intent, signal) : await api.reconcile(intent, signal);
  } catch {
    // Keep submitting intent even for a lost response or malformed success;
    // retrying this request ID may only discover, never submit again.
    throw new ApiError(
      "Google audience creation is unresolved; retry with the same requestId to reconcile, not create again",
      { status: 409 }
    );
  }
  if (result) {
    await prisma.configurationObject.updateMany({
      where: { id, workspaceId, type: objectType, deleted: false, config: { path: ["phase"], equals: "submitting" } },
      data: { config: { ...intent, phase: "ready", audienceId: result.audienceId } },
    });
    saved = await readIntent();
    if (saved.phase !== "ready" || saved.audienceId !== result.audienceId) throw denied();
  }
  return {
    id,
    status: result ? ("ready" as const) : ("pending" as const),
    ...(result ? { audienceId: result.audienceId } : {}),
    displayName: intent.displayName,
  };
}
