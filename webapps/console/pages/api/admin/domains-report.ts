/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument --
 * Pre-existing implicit-`any` debt, exempted when the unsafe-any gate was
 * introduced for pages/api/admin (JITSU-158 action item 3). Fix the `any`
 * flows in this file, then remove this header - do not add new ones. */
import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";
import { isDomainCnameValid } from "../../../lib/server/custom-domains";

export default createRoute()
  .GET({
    auth: true,
    streaming: true,
  })
  .handler(async ({ res, user }) => {
    const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
    assertDefined(userProfile, "User profile not found");
    assertTrue(userProfile.admin, "Not enough permissions");

    const domains = await db.pgPool().query(`
        select
            s.id,
            s.config ->> 'name' as "streamName",
            s."updatedAt" as "updatedAt",
            s.config,
            w.id as "workspaceId",
            (s.deleted or w.deleted) as "deleted"
        from newjitsu."ConfigurationObject" s
             join newjitsu."Workspace" w on w.id = s."workspaceId"
        where s.type = 'stream'
          and s.config ->> 'domains' <> '[]'
    `);

    const result: any[] = [];
    const cache: { [key: string]: boolean } = {};
    res.writeHead(200, {
      "Content-Type": "application/json",
    });
    res.write("[");
    let hasPrev: boolean = false;
    for (const row of domains.rows) {
      for (const domain of row.config.domains) {
        const validCname = cache[domain] ?? (cache[domain] = await isDomainCnameValid(domain));
        const resRow = {
          configured: validCname,
          domain,
          lastValidated: row.updatedAt,
          misconfigurationReason: validCname ? null : "invalid_cname",
          sourceId: row.id,
          workspaceId: row.workspaceId,
          deleted: row.deleted,
        };
        res.write(`${hasPrev ? "," : ""}${JSON.stringify(resRow)}\n`);
        hasPrev = true;
      }
    }
    res.write("]");
    res.end();
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 120, //2 mins, mostly becasue of workspace-stat call
};
