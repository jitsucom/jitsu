import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { isTruish } from "juava";
import { ApiError } from "../../../../lib/shared/errors";
import { syncService } from "../../../../lib/server/route-services";

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  catalog: z.object({}).passthrough().optional(),
  error: z.string().optional(),
});

export const route = createRoute()
  .GET({
    auth: true,
    // Side-effecting: on cache miss, dispatches /discover to syncctl and
    // writes a placeholder row to `newjitsu.source_catalog` via pgPool
    // (bypassing the Prisma backstop). Block during maintenance.
    mutates: true,
    summary: "Discover streams",
    description:
      "Asks the connector to list available streams for the given service (source). Returns the cached catalog when available; " +
      "a first call (or `refresh=true`) triggers an async fetch and returns `{ ok: false, pending: true }` — poll until `ok: true` and `catalog` is populated. " +
      "`force=true` bypasses the cache entirely.",
    tags: ["sync"],
    query: z.object({
      workspaceId: z.string(),
      serviceId: z.string(),
      refresh: z.string().optional(),
      force: z.string().optional(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    try {
      return await syncService().discoverStreams(user, query.workspaceId, {
        serviceId: query.serviceId,
        refresh: isTruish(query.refresh),
        force: isTruish(query.force),
      });
    } catch (e) {
      // The service 404s on an unknown service; this route has always answered
      // 200 { ok: false, error } and the pollers expect that.
      if (e instanceof ApiError) {
        return { ok: false, error: e.message };
      }
      throw e;
    }
  });

export default route.toNextApiHandler();
