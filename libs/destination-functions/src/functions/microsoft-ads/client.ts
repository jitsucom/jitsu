import { z } from "zod";
import type { DestinationServices } from "@jitsu/protocols/reverse-etl-runtime";
import { ReverseEtlManualReconciliationError } from "../../reverse-etl/failure";
import { MicrosoftRuntimeCredentials } from "./meta";

const baseUrl = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";
/** The provider fetch has not been called; safe to retry a saved creation intent. */
export class MicrosoftNotSubmittedError extends Error {
  constructor() {
    super("Microsoft Ads request was not submitted; verify developer token and OAuth authorization");
  }
}
export class MicrosoftUncertainDelivery extends ReverseEtlManualReconciliationError {
  constructor() {
    super();
    this.message = "Microsoft Ads delivery is unconfirmed; manual reconciliation required, no automatic replay";
  }
}
export class MicrosoftApiError extends Error {
  constructor(readonly status: number, readonly codes: number[], readonly rejected: boolean) {
    super(`Microsoft Ads HTTP ${status}${codes.length ? `, error codes ${codes.join(", ")}` : ""}`);
  }
}
const fault = z.object({ Code: z.number().int().nonnegative() });
export const microsoftPartialErrors = z.array(
  z.object({ Index: z.number().int().nonnegative(), Code: z.number().int().nonnegative() })
);

export function microsoftClient(
  credentials: z.infer<typeof MicrosoftRuntimeCredentials>,
  services: DestinationServices
) {
  return async (path: string, body: unknown, signal: AbortSignal = services.signal): Promise<Record<string, any>> => {
    const developerToken = services.developerToken?.trim() || credentials.developerToken;
    let token: string;
    try {
      signal.throwIfAborted();
      if (!developerToken) throw new Error();
      token = await services.getAccessToken(signal);
      if (!token) throw new Error();
      signal.throwIfAborted();
    } catch {
      throw new MicrosoftNotSubmittedError();
    }
    // No automatic write retries, including auth refresh after a submitted call.
    const response = await services.fetch(`${baseUrl}/${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: {
        Authorization: `Bearer ${token}`,
        DeveloperToken: developerToken,
        CustomerId: credentials.customerId,
        CustomerAccountId: credentials.accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let data: Record<string, any>;
    try {
      data = z.record(z.any()).parse(await response.json());
    } catch {
      throw new MicrosoftUncertainDelivery();
    }
    if (!response.ok || data.Errors?.length || data.OperationErrors?.length) {
      const errors = z
        .array(fault)
        .safeParse([
          ...(Array.isArray(data.Errors) ? data.Errors : []),
          ...(Array.isArray(data.OperationErrors) ? data.OperationErrors : []),
        ]);
      const codes = errors.success ? errors.data.map(e => e.Code).slice(0, 20) : [];
      // Structured 4xx rejection is conclusive; gateways, 5xx and malformed errors are not.
      const rejected = response.status >= 400 && response.status < 500 && codes.length > 0;
      const error = new MicrosoftApiError(response.status, codes, rejected);
      await microsoftLog(
        services,
        `${error.message}; request ${
          rejected ? "rejected" : "unconfirmed"
        }. Provider messages and row data are omitted.`
      );
      throw error;
    }
    return data;
  };
}
export async function microsoftLog(services: Pick<DestinationServices, "log">, message: string) {
  try {
    await services.log(message);
  } catch {
    /* Logging cannot invalidate an API acknowledgement. */
  }
}
