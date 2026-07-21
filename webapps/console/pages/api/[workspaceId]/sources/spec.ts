import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { isTruish } from "juava";
import { syncService } from "../../../../lib/server/route-services";

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
  specs: z.object({}).passthrough().optional(),
  startedAt: z.number().optional(),
});

export const route = createRoute()
  .GET({
    auth: true,
    // Side-effecting on cache miss: dispatches /spec to syncctl and writes a
    // placeholder row to `newjitsu.source_spec` via pgPool (bypassing the
    // Prisma backstop). Block during maintenance.
    mutates: true,
    summary: "Get connector specs",
    description:
      "Returns the JSON schema describing a connector package's credentials/config form. " +
      "First call kicks off an async fetch from the sync controller and returns `{ ok: false, pending: true }`; " +
      "poll until `ok: true` and `specs` is populated. Pass `force=true` to bypass the cache.",
    tags: ["sync"],
    query: z.object({
      workspaceId: z.string(),
      package: z.string(),
      version: z.string(),
      force: z.string().optional(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    return syncService().getConnectorSpec(user, query.workspaceId, {
      package: query.package,
      version: query.version,
      force: isTruish(query.force),
    });
  });

export default route.toNextApiHandler();
