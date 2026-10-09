import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { MicrosoftAudienceOptions, MicrosoftId, microsoftAudienceState } from "./meta";
import {
  microsoftPartialErrors,
  type microsoftClient,
  microsoftLog,
  MicrosoftApiError,
  MicrosoftNotSubmittedError,
} from "./client";

const remoteId = z.union([MicrosoftId, z.number().int().positive().safe().transform(String)]);
const audience = z.object({
  Id: remoteId,
  Type: z.literal("CustomerList"),
  ParentId: remoteId,
  Scope: z.enum(["Account", "Customer"]),
  Description: z.string().nullish(),
  MembershipDuration: z.number().int().optional(),
});
const stateSchema = z
  .object({
    version: z.literal(1),
    binding: z.string(),
    marker: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
    phase: z.enum(["prepared", "submitting", "ready"]),
    audienceId: MicrosoftId.optional(),
  })
  .strict();

export async function resolveMicrosoftAudience(
  config: ReverseDestinationConfig,
  services: DestinationServices,
  request: ReturnType<typeof microsoftClient>,
  validate: () => Promise<void>
) {
  const settings = MicrosoftAudienceOptions.parse(config.options.streamOptions);
  const accountId = String(config.destination.accountId);
  const customerId = String(config.destination.customerId);
  const lookup = async (id?: string) => {
    const data = await request("Audiences/QueryByIds", { Type: "CustomerList", ...(id ? { AudienceIds: [id] } : {}) });
    if (microsoftPartialErrors.parse(data.PartialErrors ?? []).length)
      throw new Error("Microsoft audience lookup failed; verify account access and audience ID");
    return z
      .array(audience.nullable())
      .parse(data.Audiences)
      .filter((a): a is z.infer<typeof audience> => a !== null);
  };
  const verify = async (id: string, marker?: string) => {
    const matches = (await lookup(id)).filter(a => a.Id === id);
    if (matches.length !== 1) throw new Error("Microsoft audience lookup did not return the requested target");
    const found = matches[0];
    // Lookup establishes access to existing lists, including shared ones. Only managed
    // lists must belong to this account; Microsoft still enforces permission on writes.
    if (
      marker !== undefined &&
      (found.ParentId !== accountId ||
        found.Description !== marker ||
        found.Scope !== "Account" ||
        found.MembershipDuration !== -1)
    )
      throw new Error("Microsoft audience scope or ownership does not match saved state");
  };
  if (settings.audience.kind === "existing") {
    await verify(settings.audience.audienceId);
    return {
      id: settings.audience.audienceId,
      managed: false,
      verify: () => verify(settings.audience.kind === "existing" ? settings.audience.audienceId : ""),
    };
  }
  if (!services.targetState) throw new Error("Microsoft managed audiences require runner target state");
  const state = services.targetState(microsoftAudienceState);
  const binding = contentHash({
    workspace: config.workspaceId,
    sync: config.id,
    destination: config.toId,
    accountId,
    customerId,
    settings,
  });
  let raw = await state.read();
  if (!raw) {
    await validate();
    await state.create({
      version: 1,
      binding,
      marker: `jitsu-retl-${randomBytes(32).toString("hex")}`,
      phase: "prepared",
    });
    raw = await state.read();
  }
  const saved = stateSchema.parse(raw);
  if (saved.binding !== binding)
    throw new Error("Microsoft audience provisioning settings changed; restore the original settings");
  if (saved.phase !== "ready") {
    if (saved.phase === "prepared") await validate();
    const submitting = { ...saved, phase: "submitting" };
    const claimed = await state.compareAndSet({ ...saved, phase: "prepared" }, submitting);
    let id: string;
    if (claimed) {
      await microsoftLog(services, "Creating a Microsoft Customer Match audience; ownership intent has been saved.");
      // A lost reply never permits another create. Discovery is the only recovery path.
      let response: Record<string, any>;
      try {
        response = await request("Audiences", {
          Audiences: [
            {
              Name: settings.audience.name,
              Type: "CustomerList",
              Scope: "Account",
              ParentId: accountId,
              Description: saved.marker,
              MembershipDuration: -1,
            },
          ],
        });
      } catch (error) {
        if (error instanceof MicrosoftNotSubmittedError || (error instanceof MicrosoftApiError && error.rejected))
          await state.compareAndSet(submitting, { ...saved, phase: "prepared" });
        throw error;
      }
      const errors = microsoftPartialErrors.parse(response.PartialErrors ?? []);
      if (errors.length) {
        if (errors.some(e => e.Index !== 0))
          throw new Error("Microsoft audience creation returned an unrecognized result");
        await state.compareAndSet(submitting, { ...saved, phase: "prepared" });
        throw new Error(
          "Microsoft audience creation was rejected; verify permissions, name and Customer Match eligibility"
        );
      }
      id = z.array(remoteId).length(1).parse(response.AudienceIds)[0];
    } else {
      const matches = (await lookup()).filter(
        a => a.Description === saved.marker && a.Scope === "Account" && a.ParentId === accountId
      );
      if (matches.length !== 1)
        throw new Error("Microsoft audience creation is unconfirmed; retry discovery without resetting state");
      id = matches[0].Id;
    }
    await verify(id, saved.marker);
    if (!(await state.compareAndSet(submitting as JsonObject, { ...saved, phase: "ready", audienceId: id })))
      throw new Error("Microsoft audience provisioning state changed");
    saved.audienceId = id;
  }
  const id = MicrosoftId.parse(saved.audienceId);
  await verify(id, saved.marker);
  return { id, managed: true, verify: () => verify(id, saved.marker) };
}
