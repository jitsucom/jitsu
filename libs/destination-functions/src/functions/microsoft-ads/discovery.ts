import { z } from "zod";
import { MicrosoftId } from "./meta";

export const microsoftRemoteId = z.union([MicrosoftId, z.number().int().positive().safe().transform(String)]);
export type MicrosoftReadAuth = {
  accessToken: string;
  developerToken: string;
  customerId?: string;
  accountId?: string;
};
const operations = {
  user: "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query",
  accounts: "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/Accounts/Search",
  audience: "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/Audiences/QueryByIds",
  goals: "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/ConversionGoals/QueryByIds",
  report: "https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit",
  poll: "https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Poll",
} as const;
export class MicrosoftReadError extends Error {}
/** Separate from the delivery client: lookup/report failures never imply an uncertain upload. */
export function microsoftReadClient(
  auth: MicrosoftReadAuth,
  request: typeof fetch = fetch,
  signal = AbortSignal.timeout(25_000)
) {
  return async (operation: keyof typeof operations, body: unknown) => {
    if (!auth.developerToken.trim())
      throw new MicrosoftReadError("Configure a Microsoft Ads developer token to browse targets and results.");
    const scoped = operation !== "user" && operation !== "accounts";
    if (scoped && (!MicrosoftId.safeParse(auth.accountId).success || !MicrosoftId.safeParse(auth.customerId).success))
      throw new MicrosoftReadError("Select and save a Microsoft advertising account first.");
    try {
      const response = await request(operations[operation], {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          DeveloperToken: auth.developerToken,
          "Content-Type": "application/json",
          ...(scoped ? { CustomerId: auth.customerId!, CustomerAccountId: auth.accountId! } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MicrosoftReadError(
          `Microsoft lookup/report request failed (HTTP ${response.status}). Check OAuth, developer token and account permissions.`
        );
      }
      const data = z.record(z.unknown()).parse(await response.json());
      for (const field of ["Errors", "OperationErrors", "PartialErrors"]) {
        if (data[field] != null && (!Array.isArray(data[field]) || (data[field] as unknown[]).length))
          throw new MicrosoftReadError(
            "Microsoft could not return all requested results. Check account and target permissions."
          );
      }
      return data;
    } catch (error) {
      if (error instanceof MicrosoftReadError) throw error;
      throw new MicrosoftReadError(
        "Microsoft results could not be loaded. Check the connection and try again; no delivery data was submitted."
      );
    }
  };
}
export type MicrosoftReader = ReturnType<typeof microsoftReadClient>;
const account = z.object({
  Id: microsoftRemoteId,
  ParentCustomerId: microsoftRemoteId,
  Name: z.string(),
  CurrencyCode: z.string().optional(),
});
export const microsoftGoal = z.object({
  Id: microsoftRemoteId,
  Name: z.string(),
  Type: z.literal("OfflineConversion"),
  Status: z.string().nullish(),
});
export async function microsoftGoals(read: MicrosoftReader) {
  const data = await read("goals", { ConversionGoalTypes: "OfflineConversion" });
  return z
    .array(microsoftGoal.nullable())
    .parse(data.ConversionGoals ?? [])
    .filter((x): x is z.infer<typeof microsoftGoal> => x !== null);
}
export async function listMicrosoftTargets(
  read: MicrosoftReader,
  kind: "microsoft-account" | "microsoft-audience" | "microsoft-goal"
) {
  if (kind === "microsoft-account") {
    const user = z.object({ User: z.object({ Id: microsoftRemoteId }) }).parse(await read("user", {}));
    const options: { value: string; label: string; customerId: string }[] = [];
    for (let page = 0; page < 10; page++) {
      const data = await read("accounts", {
        Predicates: [{ Field: "UserId", Operator: "Equals", Value: user.User.Id }],
        PageInfo: { Index: page, Size: 100 },
        Ordering: [{ Field: "Id", Order: "Ascending" }],
      });
      const accounts = z.array(account).parse(data.Accounts ?? []);
      options.push(
        ...accounts.map(a => ({
          value: a.Id,
          label: `${a.Name} (${a.Id}) · customer ${a.ParentCustomerId}`,
          customerId: a.ParentCustomerId,
        }))
      );
      if (accounts.length < 100) return { options, truncated: false };
    }
    return { options, truncated: true };
  }
  if (kind === "microsoft-goal") {
    const goals = await microsoftGoals(read);
    return {
      options: goals
        .slice(0, 1000)
        .map(g => ({ value: g.Name, label: `${g.Name} (${g.Id}${g.Status ? `, ${g.Status}` : ""})` })),
      truncated: goals.length > 1000,
    };
  }
  const data = await read("audience", { Type: "CustomerList" });
  const audiences = z
    .array(z.object({ Id: microsoftRemoteId, Name: z.string(), Type: z.literal("CustomerList") }).nullable())
    .parse(data.Audiences ?? [])
    .filter(a => a !== null);
  return {
    options: audiences.slice(0, 1000).map(a => ({ value: a!.Id, label: `${a!.Name} (${a!.Id})` })),
    truncated: audiences.length > 1000,
  };
}
