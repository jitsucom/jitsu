import { z } from "zod";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";

const token = z.object({ accessToken: z.string().min(1).max(16384), expiresAt: z.string().datetime() }).strict();
export type ConsoleRequest = (url: URL, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** One process/immutable sync: OAuth secrets never enter config, store or journal state. */
export function createConsoleClient(
  baseUrl: string,
  serviceToken: string,
  config: ReverseRunConfig,
  request: ConsoleRequest = fetch,
  refreshTaskId?: string
) {
  let cached: z.infer<typeof token> | undefined;
  let cacheUntil = 0;
  async function get(path: string, signal: AbortSignal, revision = false) {
    signal.throwIfAborted();
    const url = new URL(`/api/admin/${path}/${encodeURIComponent(config.id)}`, baseUrl);
    url.searchParams.set("workspaceId", config.workspaceId);
    if (revision) url.searchParams.set("configRevision", config.configRevision);
    if (refreshTaskId) url.searchParams.set("refreshTaskId", refreshTaskId);
    try {
      const response = await request(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: { Authorization: `Bearer ${serviceToken}` },
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new Error("Reverse console admission/OAuth request denied or unavailable");
    }
  }
  return {
    admit: async (signal: AbortSignal) => ReverseRunConfig.parse(await get("reverse-syncs", signal)),
    accessToken: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (cached && Date.now() < cacheUntil) return cached.accessToken;
      cached = undefined;
      const parsed = token.safeParse(await get("reverse-sync-oauth", signal, true));
      if (!parsed.success) throw new Error("Invalid reverse OAuth token response");
      cacheUntil = Math.min(Date.parse(parsed.data.expiresAt) - 30_000, Date.now() + 240_000);
      if (cacheUntil <= Date.now()) throw new Error("Reverse OAuth token is expired");
      cached = parsed.data;
      return cached.accessToken;
    },
  };
}
