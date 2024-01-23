import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";
import { isCnameValid } from "../../../lib/server/custom-domains";

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
            w.id as "workspaceId"
        from newjitsu."ConfigurationObject" s
             join "Workspace" w on w.id = s."workspaceId"
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
        const validCname = cache[domain] ?? (cache[domain] = await isCnameValid(domain));
        const resRow = {
          configured: validCname,
          domain,
          lastValidated: row.updatedAt,
          misconfigurationReason: validCname ? null : "invalid_cname",
          sourceId: row.id,
          workspaceId: row.workspaceId,
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
