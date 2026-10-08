import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { MetaAudienceOptions, MetaId, MetaReverseCredentials, metaAudienceStateStream } from "./reverse-meta";
import { MetaApiError, metaLog, metaRequest } from "./client";

const State = z
  .object({
    version: z.literal(1),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    marker: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
    phase: z.enum(["prepared", "submitting", "ready"]),
    audienceId: MetaId.optional(),
  })
  .strict();
const audienceResponse = z.object({
  id: MetaId,
  account_id: MetaId,
  subtype: z.string(),
  description: z.string().optional(),
  is_value_based: z.boolean().optional(),
});
const fields = "id,account_id,subtype,description,is_value_based";
export async function resolveMetaAudience(config: ReverseDestinationConfig, services: DestinationServices) {
  const settings = MetaAudienceOptions.parse(config.options.streamOptions);
  const { accessToken } = MetaReverseCredentials.parse(config.destination);
  const log = (message: string) => metaLog(services.log, message);
  const request = (path: string, method: "GET" | "POST" = "GET", body?: unknown) =>
    metaRequest(services.fetch, accessToken, services.signal, path, method, body);
  const verify = async (id: string, marker?: string) => {
    const remote = audienceResponse.parse(await request(`${id}?fields=${fields}`));
    if (
      remote.id !== id ||
      remote.account_id !== settings.accountId ||
      remote.subtype !== "CUSTOM" ||
      !!remote.is_value_based !== settings.valueBased ||
      (marker && remote.description !== marker)
    )
      throw new Error("Meta audience does not match the saved account, type or ownership marker");
  };
  if (settings.audience.kind === "existing") {
    const audienceId = settings.audience.audienceId;
    await verify(audienceId);
    return { settings, audienceId, managed: false, verify: () => verify(audienceId) };
  }
  if (!services.targetState) throw new Error("Meta audience provisioning requires runner state");
  const state = services.targetState(metaAudienceStateStream);
  const binding = contentHash({ workspace: config.workspaceId, sync: config.id, destination: config.toId, settings });
  let raw = await state.read();
  if (!raw) {
    await state.create({
      version: 1,
      binding,
      marker: `jitsu-retl-${randomBytes(32).toString("hex")}`,
      phase: "prepared",
    });
    raw = await state.read();
  }
  const saved = State.parse(raw);
  if (saved.binding !== binding)
    throw new Error("Meta audience settings differ from saved provisioning state; do not reset");
  if (saved.phase !== "ready") {
    services.signal.throwIfAborted();
    const submitting = { ...saved, phase: "submitting" };
    const claimed = await state.compareAndSet({ ...saved, phase: "prepared" }, submitting);
    let audienceId: string | undefined;
    if (claimed) {
      await log("Creating Meta audience; the creation intent is saved for discovery if interrupted.");
      try {
        const result = z.object({ id: MetaId }).parse(
          await request(`act_${settings.accountId}/customaudiences`, "POST", {
            name: settings.audience.name,
            description: saved.marker,
            subtype: "CUSTOM",
            customer_file_source: settings.customerFileSource,
            is_value_based: settings.valueBased,
          })
        );
        audienceId = result.id;
      } catch (error) {
        // A definite Graph rejection is not an uncertain create. The same intent
        // may be submitted after permissions/terms are fixed; transport failures may not.
        if (error instanceof MetaApiError && error.rejected)
          await state.compareAndSet(submitting, { ...saved, phase: "prepared" });
        throw error;
      }
    } else {
      await log("Checking the saved Meta audience creation request; no duplicate creation will be submitted.");
      let after: string | undefined;
      const matches = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const result = z
          .object({
            data: z.array(audienceResponse),
            paging: z
              .object({ next: z.string().optional(), cursors: z.object({ after: z.string() }).optional() })
              .optional(),
          })
          .parse(
            await request(
              `act_${settings.accountId}/customaudiences?fields=${fields}&limit=100${
                after ? `&after=${encodeURIComponent(after)}` : ""
              }`
            )
          );
        for (const remote of result.data)
          if (remote.description === saved.marker && remote.account_id === settings.accountId) matches.add(remote.id);
        if (!result.paging?.next) {
          after = undefined;
          break;
        }
        after = result.paging.cursors?.after;
        if (!after) throw new Error("Meta audience discovery returned incomplete pagination");
      }
      if (after) throw new Error("Meta audience discovery exceeded its page limit; no creation will be retried");
      if (matches.size !== 1)
        throw new Error("Meta audience creation is unconfirmed; retry discovery without resetting state");
      audienceId = [...matches][0];
    }
    await verify(audienceId, saved.marker);
    if (!(await state.compareAndSet(submitting as JsonObject, { ...saved, phase: "ready", audienceId })))
      throw new Error("Meta audience provisioning state changed");
    saved.phase = "ready";
    saved.audienceId = audienceId;
  }
  const audienceId = MetaId.parse(saved.audienceId);
  await verify(audienceId, saved.marker);
  await log(`Using Jitsu-managed Meta audience ${audienceId}. Matching and audience-size reporting happen separately.`);
  return { settings, audienceId, managed: true, verify: () => verify(audienceId, saved.marker) };
}
