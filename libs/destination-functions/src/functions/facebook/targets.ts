import { z } from "zod";
import { MetaApiError, metaRequest, type MetaFetch } from "./client";
import { MetaAudienceOptions, MetaConversionOptions, MetaId, MetaReverseCredentials } from "./reverse-meta";

export class MetaTargetError extends Error {}
const targetName = z.string().max(512);
const accountId = z
  .string()
  .transform(value => value.replace(/^act_/, ""))
  .pipe(MetaId);
const account = z.object({
  id: z.string(),
  account_id: MetaId,
  name: targetName,
  user_tasks: z.array(z.string()).optional(),
});
const audience = z.object({
  id: MetaId,
  name: targetName,
  account_id: MetaId,
  subtype: z.string(),
  is_value_based: z.boolean().default(false),
  permission_for_actions: z.object({ can_edit: z.boolean().optional() }).optional(),
});
const accountFields = "id,account_id,name,user_tasks";
const audienceFields = "id,name,account_id,subtype,is_value_based,permission_for_actions";

function diagnostic(error: unknown, target: string): MetaTargetError {
  if (error instanceof MetaTargetError) return error;
  if (error instanceof MetaApiError) {
    if (error.code === 190)
      return new MetaTargetError(
        "Meta access token is invalid or expired. Replace the destination's system-user token."
      );
    if (error.code === 10 || error.code === 200 || error.status === 403)
      return new MetaTargetError(
        `Meta denied access to ${target}. Assign this asset to the token's system user in Business Settings and check ads_management permission.`
      );
    if (error.code === 100 || error.code === 803 || error.status === 404)
      return new MetaTargetError(
        `Could not access ${target}. Verify the ID and assign the asset to the token's system user. For conversions, use the Pixel / Dataset ID from Events Manager, not the App ID from Meta Developers.`
      );
    if (error.transient || error.status === 429 || error.status >= 500 || [4, 17, 32, 613].includes(error.code ?? 0))
      return new MetaTargetError("Meta is temporarily unavailable or rate limited. Retry the connection check later.");
  }
  return new MetaTargetError(`Could not verify ${target}. Check token access and try again. No data was submitted.`);
}
const reader = (credentials: unknown, request: MetaFetch, signal: AbortSignal) => {
  const { accessToken } = MetaReverseCredentials.parse(credentials);
  return (path: string) => metaRequest(request, accessToken, signal, path);
};

/** Only locally constructed GET paths; never follow provider paging URLs (which may contain tokens). */
export async function listMetaTargets(
  credentials: unknown,
  kind: "meta-account" | "meta-audience",
  scope: { accountId?: string; valueBased?: boolean },
  request: MetaFetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000)
) {
  const read = reader(credentials, request, signal);
  const id = kind === "meta-audience" ? accountId.parse(scope.accountId) : undefined;
  const path = id ? `act_${id}/customaudiences` : "me/adaccounts";
  const fields = id ? audienceFields : accountFields;
  const options = new Map<string, { value: string; label: string }>();
  let after: string | undefined;
  try {
    for (let page = 0; page < 20; page++) {
      const data = z
        .object({
          data: z.array(id ? audience : account),
          paging: z
            .object({ next: z.string().optional(), cursors: z.object({ after: z.string().max(4096) }).optional() })
            .optional(),
        })
        .parse(await read(`${path}?${new URLSearchParams({ fields, limit: "100", ...(after ? { after } : {}) })}`));
      for (const item of data.data) {
        if (
          id &&
          "subtype" in item &&
          (item.account_id !== id ||
            item.subtype !== "CUSTOM" ||
            item.is_value_based !== !!scope.valueBased ||
            item.permission_for_actions?.can_edit === false)
        )
          continue;
        const value = id ? item.id : item.account_id;
        options.set(value, { value, label: `${item.name} (${value})` });
      }
      if (!data.paging?.next) return { options: [...options.values()], truncated: false };
      const next = data.paging.cursors?.after;
      if (!next || next === after)
        throw new MetaTargetError(
          "Meta returned incomplete target pagination. Enter the target ID manually and check the connection."
        );
      after = next;
    }
    return { options: [...options.values()], truncated: true };
  } catch (error) {
    throw diagnostic(error, id ? "the ad account's customer-list audiences" : "ad accounts");
  }
}

/** A successful read proves type/read access, not guaranteed acceptance of a later write. */
export async function checkMetaTarget(
  credentials: unknown,
  stream: "audience" | "conversions",
  streamOptions: unknown,
  request: MetaFetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000)
) {
  const read = reader(credentials, request, signal);
  let target = "the selected target";
  try {
    if (stream === "audience") {
      const settings = MetaAudienceOptions.parse(streamOptions);
      target = "the ad account";
      const remoteAccount = account.parse(await read(`act_${settings.accountId}?fields=${accountFields}`));
      if (remoteAccount.account_id !== settings.accountId || remoteAccount.id !== `act_${settings.accountId}`)
        throw new MetaTargetError(
          "The target is not the selected Meta ad account. Verify the Ad Account ID in Business Settings."
        );
      if (remoteAccount.user_tasks && !remoteAccount.user_tasks.some(task => ["MANAGE", "ADVERTISE"].includes(task)))
        throw new MetaTargetError(
          "The token's user has read-only ad-account access. Assign Manage campaigns access in Business Settings before uploading audiences."
        );
      if (settings.audience.kind === "existing") {
        target = "the customer-list audience";
        const id = settings.audience.audienceId;
        const remote = audience.parse(await read(`${id}?fields=${audienceFields}`));
        if (remote.id !== id || remote.subtype !== "CUSTOM")
          throw new MetaTargetError(
            "Choose a customer-list Custom Audience. Website, engagement and lookalike audiences cannot receive customer-list uploads."
          );
        if (remote.account_id !== settings.accountId)
          throw new MetaTargetError("This audience belongs to a different ad account. Select its owning ad account.");
        if (remote.is_value_based !== settings.valueBased)
          throw new MetaTargetError("The Value-based audience setting does not match the selected audience.");
        if (remote.permission_for_actions?.can_edit === false)
          throw new MetaTargetError(
            "The token cannot edit this audience. Assign the owning ad account to its system user in Business Settings."
          );
        return {
          name: remote.name,
          message:
            "Customer-list audience and account access verified. Meta still checks token permissions and Custom Audience terms when accepting uploads.",
        };
      }
      return {
        name: remoteAccount.name,
        message:
          "Ad-account access verified. The audience will be created on the first run; Meta still checks token permissions and Custom Audience terms at creation.",
      };
    }
    const { pixelId } = MetaConversionOptions.parse(streamOptions);
    target = "the pixel / dataset";
    // is_unavailable is a pixel-specific field: id/name alone also succeed for an Application.
    let raw: unknown;
    try {
      raw = await read(`${pixelId}?fields=id,name,is_unavailable`);
    } catch (error) {
      if (error instanceof MetaApiError && error.code === 100 && !error.transient) {
        const app = await read(`${pixelId}?fields=id,app_events_feature_bitmask`).catch(() => undefined);
        if (z.object({ id: z.literal(pixelId), app_events_feature_bitmask: z.number() }).safeParse(app).success)
          throw new MetaTargetError(
            "This is a Meta App ID, not a Pixel / Dataset ID. Copy the Dataset ID from Events Manager → your data source → Settings and assign it to the token's system user."
          );
      }
      throw error;
    }
    const pixel = z.object({ id: MetaId, name: targetName, is_unavailable: z.boolean() }).parse(raw);
    if (pixel.id !== pixelId || pixel.is_unavailable)
      throw new MetaTargetError(
        "This pixel / dataset is unavailable. Verify its Dataset ID and asset access in Events Manager and Business Settings."
      );
    return {
      name: pixel.name,
      message:
        "Pixel / dataset type and read access verified. This read-only check does not prove conversion upload permission; grant the system user access to this dataset and verify delivery in Events Manager.",
    };
  } catch (error) {
    throw diagnostic(error, target);
  }
}
