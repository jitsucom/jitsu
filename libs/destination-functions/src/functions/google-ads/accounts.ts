import { z } from "zod";
import { googleCustomerId } from "./credentials";
import { googleAdsBaseUrl, googleAdsHeaders } from "./clients/google-ads";

export class GoogleAccountLookupError extends Error {}
const customer = z.object({
  id: googleCustomerId,
  descriptiveName: z.string().optional(),
  manager: z.boolean().optional(),
});

/**
 * Direct access roots plus all advertising descendants, preserving the manager used for access.
 * https://developers.google.com/google-ads/api/docs/account-management/listing-accounts
 * https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy
 */
export async function listGoogleAccounts(
  accessToken: string,
  developerToken: string | undefined,
  request: typeof fetch = fetch,
  signal = AbortSignal.timeout(25_000)
) {
  if (!developerToken?.trim())
    throw new GoogleAccountLookupError(
      "Account discovery requires a Google Ads developer token. You can still enter Customer ID and Manager ID manually."
    );
  const read = async (path: string, root?: string, body?: unknown) => {
    const response = await request(`${googleAdsBaseUrl}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal,
      headers: googleAdsHeaders(accessToken, developerToken.trim(), root),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Google account lookup failed");
    }
    return response.json();
  };
  try {
    const roots = z
      .object({ resourceNames: z.array(z.string().regex(/^customers\/\d{10}$/)).default([]) })
      .parse(await read("customers:listAccessibleCustomers"))
      .resourceNames.map(name => name.split("/")[1]);
    const options = new Map<string, { value: string; label: string; customerId: string; loginCustomerId: string }>();
    let truncated = roots.length > 20;
    let partial = false;
    let requests = 0;
    let successfulRoots = 0;
    for (const root of [...new Set(roots)].slice(0, 20)) {
      if (requests >= 40 || options.size >= 1000) {
        truncated = true;
        break;
      }
      let pageToken: string | undefined;
      try {
        // CustomerClient only exists for manager customers. Direct advertiser roots need Customer.
        requests++;
        const metadata = z
          .object({ results: z.array(z.object({ customer: customer.extend({ status: z.string() }) })).length(1) })
          .parse(
            await read(`customers/${root}/googleAds:search`, root, {
              query: "SELECT customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer",
            })
          ).results[0].customer;
        if (metadata.id !== root) throw new Error("Unexpected Google customer");
        if (!metadata.manager) {
          if (metadata.status === "ENABLED")
            options.set(`${root}:`, {
              value: `${root}:`,
              customerId: root,
              loginCustomerId: "",
              label: `${metadata.descriptiveName || "Google Ads"} (${root})`,
            });
          successfulRoots++;
          continue;
        }
        if (requests >= 40) {
          truncated = true;
          break;
        }
        do {
          requests++;
          const data = z
            .object({
              results: z.array(z.object({ customerClient: customer })).default([]),
              nextPageToken: z.string().optional(),
            })
            .parse(
              await read(`customers/${root}/googleAds:search`, root, {
                query:
                  "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED'",
                ...(pageToken ? { pageToken } : {}),
              })
            );
          for (const { customerClient: account } of data.results) {
            if (account.manager) continue;
            const loginCustomerId = account.id === root ? "" : root;
            const value = `${account.id}:${loginCustomerId}`;
            if (options.size >= 1000) {
              truncated = true;
              break;
            }
            options.set(value, {
              value,
              customerId: account.id,
              loginCustomerId,
              label: `${account.descriptiveName || "Google Ads"} (${account.id})${
                loginCustomerId ? ` · manager ${loginCustomerId}` : ""
              }`,
            });
          }
          pageToken = data.nextPageToken;
          if (pageToken && (requests >= 40 || options.size >= 1000)) {
            truncated = true;
            break;
          }
        } while (pageToken);
        successfulRoots++;
      } catch {
        partial = true;
        if (signal.aborted) break;
      }
    }
    if (roots.length && !successfulRoots && !options.size) throw new Error("No accounts could be read");
    return { options: [...options.values()], truncated, partial };
  } catch {
    throw new GoogleAccountLookupError(
      "Could not load Google Ads accounts. Check OAuth Ads scope, developer token and account permissions, or enter IDs manually."
    );
  }
}
