import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";
import { isCnameValid } from "../../../lib/server/custom-domains";

export default createRoute()
  .GET({
    auth: true,
  })
  .handler(async ({ user }) => {
    const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
    assertDefined(userProfile, "User profile not found");
    assertTrue(userProfile.admin, "Not enough permissions");

    const domains = await db.pgPool().query(`
        select
            s.id,
            s.config ->> 'name' as "streamName",
            s."updatedAt" as "updatedAt",
            s.config,
            w.id as "workspaceId"
        from "ConfigurationObject" s
             join "Workspace" w on w.id = s."workspaceId"
        where s.type = 'stream'
          and s.config ->> 'domains' <> '[]'
    `);

    const result: any[] = [];
    const cache: { [key: string]: boolean } = {};

    for (const row of domains.rows) {
      for (const domain of row.config.domains) {
        const validCname = cache[domain] ?? (cache[domain] = await isCnameValid(domain));
        result.push({
          configured: validCname,
          domain,
          lastValidated: row.updatedAt,
          misconfigurationReason: validCname ? null : "invalid_cname",
          sourceId: row.id,
          workspaceId: row.workspaceId,
        });
      }
    }
    result.sort((a, b) => {
      if (a.configured && !b.configured) {
        return -1;
      }
      if (!a.configured && b.configured) {
        return 1;
      }
      if (a.configured && b.configured) {
        return a.domain.localeCompare(b.domain);
      }
      return 0;
    });

    return result;
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 120, //2 mins, mostly becasue of workspace-stat call
};
