import { z } from "zod";
import { ReverseEtlProtocolError } from "../../reverse-etl/meta";
import { GoogleAudienceCredentials, GoogleManagedAudience, googleAudienceMembershipDays } from "./meta";
import type { GoogleAccessToken } from "./index";

const id = z.string().regex(/^[1-9]\d{0,19}$/);
const userList = z.object({
  name: z.string(),
  id,
  displayName: z.string(),
  integrationCode: z.string().optional(),
  membershipDuration: z.string(),
  membershipStatus: z.string(),
  readOnly: z.boolean().optional(),
  accessReason: z.string(),
  ingestedUserListInfo: z
    .object({
      uploadKeyTypes: z.array(z.string()),
      contactIdInfo: z.object({ dataSourceType: z.string() }).optional(),
      mobileIdInfo: z
        .object({ dataSourceType: z.string().optional(), appId: z.string(), keySpace: z.string() })
        .optional(),
      userIdInfo: z.object({ dataSourceType: z.string().optional() }).optional(),
    })
    .optional(),
});
export type GoogleAudienceIntent = Pick<GoogleManagedAudience, "displayName" | "integrationCode"> &
  Partial<Pick<GoogleManagedAudience, "identifierType" | "appId" | "mobilePlatform" | "membershipDays">>;
function listInfo(intent: GoogleAudienceIntent) {
  const dataSourceType = "DATA_SOURCE_TYPE_FIRST_PARTY";
  if (intent.identifierType === "MOBILE_ADVERTISING_ID") {
    if (!intent.appId || !intent.mobilePlatform)
      throw new ReverseEtlProtocolError("Mobile audiences require an App ID and mobile platform");
    return {
      uploadKeyTypes: ["MOBILE_ID"],
      mobileIdInfo: { dataSourceType, appId: intent.appId, keySpace: intent.mobilePlatform },
    };
  }
  if (intent.identifierType === "CRM_ID") return { uploadKeyTypes: ["USER_ID"], userIdInfo: { dataSourceType } };
  return { uploadKeyTypes: ["CONTACT_ID"], contactIdInfo: { dataSourceType } };
}
function matchesType(list: z.infer<typeof userList>, expected: GoogleAudienceIntent) {
  const info = listInfo(expected);
  const actual = list.ingestedUserListInfo;
  return (
    !!actual?.uploadKeyTypes.includes(info.uploadKeyTypes[0]) &&
    (!info.contactIdInfo || actual.contactIdInfo?.dataSourceType === info.contactIdInfo.dataSourceType) &&
    (!info.mobileIdInfo ||
      (actual.mobileIdInfo?.appId === info.mobileIdInfo.appId &&
        actual.mobileIdInfo?.keySpace === info.mobileIdInfo.keySpace))
  );
}

/** Provider resource APIs only. The console owns durable creation intent/recovery. */
export function createGoogleAudienceManagement(
  credentials: unknown,
  getAccessToken: GoogleAccessToken,
  request: typeof fetch = fetch
) {
  const parsed = GoogleAudienceCredentials.safeParse(credentials);
  if (!parsed.success) throw new ReverseEtlProtocolError("Invalid Google audience credentials");
  const c = parsed.data;
  const parent = `accountTypes/GOOGLE_ADS/accounts/${c.customerId}`;
  const fail = (): never => {
    throw new ReverseEtlProtocolError(
      "Google audience management unavailable; preserve creation evidence and reconcile"
    );
  };
  async function call(path: string, signal: AbortSignal, body?: unknown) {
    signal.throwIfAborted();
    try {
      const token = await getAccessToken(signal);
      signal.throwIfAborted();
      const response = await request(`https://datamanager.googleapis.com/v1/${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(c.loginCustomerId ? { "login-account": `accountTypes/GOOGLE_ADS/accounts/${c.loginCustomerId}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) return fail();
      return await response.json();
    } catch {
      return fail();
    }
  }
  function verify(value: unknown, expected: GoogleAudienceIntent, audienceId?: string) {
    const result = userList.safeParse(value);
    if (!result.success) return fail();
    const list = result.data;
    if (
      list.name !== `${parent}/userLists/${list.id}` ||
      (audienceId && list.id !== audienceId) ||
      list.displayName !== expected.displayName ||
      list.integrationCode !== expected.integrationCode ||
      list.readOnly === true ||
      list.accessReason !== "OWNED" ||
      list.membershipStatus !== "OPEN" ||
      list.membershipDuration !== `${(expected.membershipDays ?? googleAudienceMembershipDays) * 86400}s` ||
      list.ingestedUserListInfo?.uploadKeyTypes.length !== 1 ||
      !matchesType(list, expected)
    )
      return fail();
    // Estimated size is deliberately ignored: it cannot establish an empty baseline.
    return { audienceId: list.id };
  }
  return {
    // Read-only validation for additions/removals; this does not establish a mirror baseline.
    // https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists
    async verifyExisting(audienceId: string, signal: AbortSignal, options: Partial<GoogleAudienceIntent> = {}) {
      const targetId = id.parse(audienceId);
      const parsed = userList.safeParse(await call(`${parent}/userLists/${targetId}`, signal));
      if (!parsed.success) return fail();
      const list = parsed.data;
      if (
        list.id !== targetId ||
        list.name !== `${parent}/userLists/${targetId}` ||
        list.readOnly === true ||
        list.accessReason !== "OWNED" ||
        list.membershipStatus !== "OPEN" ||
        !matchesType(list, { displayName: "", integrationCode: "", ...options })
      )
        return fail();
      return { audienceId: list.id, displayName: list.displayName };
    },
    async create(intent: GoogleAudienceIntent, signal: AbortSignal) {
      return verify(
        await call(`${parent}/userLists`, signal, {
          displayName: intent.displayName,
          integrationCode: intent.integrationCode,
          description: "Managed exclusively by Jitsu Reverse ETL; do not upload members outside Jitsu.",
          membershipDuration: `${(intent.membershipDays ?? googleAudienceMembershipDays) * 86400}s`,
          membershipStatus: "OPEN",
          ingestedUserListInfo: listInfo(intent),
        }),
        intent
      );
    },
    async reconcile(intent: GoogleAudienceIntent, signal: AbortSignal) {
      // An exact correlation marker plus the saved intent can recover a lost
      // create response. Absence never authorizes another non-idempotent POST.
      const query = new URLSearchParams({
        filter: `integration_code = ${JSON.stringify(intent.integrationCode)}`,
        pageSize: "2",
      });
      const result = z
        .object({ userLists: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() })
        .safeParse(await call(`${parent}/userLists?${query}`, signal));
      if (!result.success || result.data.nextPageToken || result.data.userLists.length > 1) return fail();
      return result.data.userLists.length ? verify(result.data.userLists[0], intent) : undefined;
    },
    async verifyManaged(binding: GoogleManagedAudience, signal: AbortSignal) {
      const saved = GoogleManagedAudience.parse(binding);
      if (saved.customerId !== c.customerId) return fail();
      return verify(await call(`${parent}/userLists/${saved.audienceId}`, signal), saved, saved.audienceId);
    },
  };
}
