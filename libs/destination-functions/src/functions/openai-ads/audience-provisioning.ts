import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { OpenAiAdsCall, OpenAiWait, realWait } from "./ads-client";
import { adAccountId, createAudience, findAudiencesByMarker, getAudience, waitForAudienceReady } from "./audience-api";
import { OpenAiApiError } from "./client";
import {
  OpenAiAdsCredentials,
  OpenAiAudienceId,
  OpenAiAudienceOptions,
  openAiAudienceStateStream,
} from "./reverse-meta";

const State = z
  .object({
    version: z.literal(1),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    marker: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
    phase: z.enum(["prepared", "submitting", "ready"]),
    /** The ad account the intent was saved under: a key for another account must not adopt this audience. */
    accountId: z.string().min(1),
    audienceId: OpenAiAudienceId.optional(),
  })
  .strict();

export type ResolvedOpenAiAudience = {
  settings: z.infer<typeof OpenAiAudienceOptions>;
  audienceId: string;
  accountId: string;
  managed: boolean;
  /** Re-checks that the audience still exists, is ours and is usable. Used before a mirror starts. */
  verify(): Promise<void>;
  call: OpenAiAdsCall;
};

const ownershipError = "OpenAI audience does not match the saved account or ownership marker";

/**
 * Finds or creates the audience a sync writes to. A managed audience is created once: the intent and a random marker
 * are saved before the POST, the creation is claimed with a compare-and-set, and if the answer is lost the next run
 * finds the audience by its marker instead of creating a second one (OpenAI's create has no idempotency key).
 */
export async function resolveOpenAiAudience(
  config: ReverseDestinationConfig,
  services: DestinationServices,
  wait: OpenAiWait = realWait
): Promise<ResolvedOpenAiAudience> {
  const settings = OpenAiAudienceOptions.parse(config.options.streamOptions);
  const { adsApiKey } = OpenAiAdsCredentials.parse(config.destination);
  if (!adsApiKey) throw new Error("Add the Ads API key to this OpenAI Ads destination.");
  const call: OpenAiAdsCall = {
    fetch: services.fetch as OpenAiAdsCall["fetch"],
    apiKey: adsApiKey,
    signal: services.signal,
  };
  const log = async (message: string) => {
    try {
      await services.log(message);
    } catch {
      /* Delivery journaling remains the mandatory durable boundary. */
    }
  };
  const accountId = await adAccountId(call);
  const verify = async (id: string, marker?: string) => {
    const remote = await getAudience(call, id);
    if (remote.id !== id || (marker && !remote.description?.includes(marker))) throw new Error(ownershipError);
    return waitForAudienceReady(call, id, { wait });
  };

  if (settings.audience.kind === "existing") {
    const audienceId = settings.audience.audienceId;
    await verify(audienceId);
    return {
      settings,
      audienceId,
      accountId,
      managed: false,
      verify: async () => void (await verify(audienceId)),
      call,
    };
  }

  if (!services.targetState) throw new Error("OpenAI audience provisioning requires runner state");
  const state = services.targetState(openAiAudienceStateStream);
  const binding = contentHash({ workspace: config.workspaceId, sync: config.id, destination: config.toId, settings });
  let raw = await state.read();
  if (!raw) {
    await state.create({
      version: 1,
      binding,
      marker: `jitsu-retl-${randomBytes(32).toString("hex")}`,
      phase: "prepared",
      accountId,
    });
    raw = await state.read();
  }
  const saved = State.parse(raw);
  if (saved.binding !== binding)
    throw new Error("OpenAI audience settings differ from saved provisioning state; do not reset");
  if (saved.accountId !== accountId) throw new Error(ownershipError);
  if (saved.phase !== "ready") {
    services.signal.throwIfAborted();
    const submitting = { ...saved, phase: "submitting" };
    const claimed = await state.compareAndSet({ ...saved, phase: "prepared" }, submitting);
    let audienceId: string;
    if (claimed) {
      await log("Creating the OpenAI audience; the creation intent is saved for discovery if interrupted.");
      try {
        audienceId = (
          await createAudience(call, {
            name: settings.audience.name,
            description: `Managed by Jitsu; do not edit its members. ${saved.marker}`,
          })
        ).id;
      } catch (error) {
        // A definite refusal is not an uncertain create: the same intent may be submitted after the cause is fixed.
        // A lost connection or an unreadable answer may have created it, so the state stays "submitting".
        if (error instanceof OpenAiApiError && error.rejected)
          await state.compareAndSet(submitting, { ...saved, phase: "prepared" });
        throw error;
      }
    } else {
      await log("Checking the saved OpenAI audience creation request; no duplicate creation will be submitted.");
      const matches = await findAudiencesByMarker(call, saved.marker);
      if (matches.length !== 1)
        throw new Error("OpenAI audience creation is unconfirmed; retry discovery without resetting state");
      audienceId = matches[0];
    }
    await verify(audienceId, saved.marker);
    if (!(await state.compareAndSet(submitting as JsonObject, { ...saved, phase: "ready", audienceId })))
      throw new Error("OpenAI audience provisioning state changed");
    saved.phase = "ready";
    saved.audienceId = audienceId;
  }
  const audienceId = OpenAiAudienceId.parse(saved.audienceId);
  await verify(audienceId, saved.marker);
  await log(`Using Jitsu-managed OpenAI audience ${audienceId}. Matching and audience size are reported separately.`);
  return {
    settings,
    audienceId,
    accountId,
    managed: true,
    verify: async () => void (await verify(audienceId, saved.marker)),
    call,
  };
}
