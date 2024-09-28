import { NextApiRequest, NextApiResponse } from "next";
import { getOrigin, withErrorHandler } from "../../lib/route-helpers";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { pg } from "../../lib/services";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { result } from "lodash";
import { sendEmail, SendEmailRequest } from "../../lib/email";

dayjs.extend(utc);

async function getWorkspaceMembers(workspaceId: string | undefined) {
  const query = `
    select profile.name, profile.email
    from newjitsu."WorkspaceAccess"
    join newjitsu."UserProfile" profile on profile.id = "WorkspaceAccess"."userId"
    where "workspaceId" = $1`;

  return (await pg.query(query, [workspaceId])).rows;
}

export function makeAddress({ name, email }): string {
  assertDefined(email, "email is required");
  return name ? `${name} <${email}>` : email;
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const claims = requireDefined(await auth(req, res), `Auth is required`);
    assertTrue(claims.type === "admin", "Invalid auth claims");
    const payload = SendEmailRequest.parse(req.body);
    if (payload.workspaceId) {
      const members = await getWorkspaceMembers(payload.workspaceId);
      for (const member of members) {
        try {
          console.log(`Sending email to ${member.email} of workspace ${payload.workspaceId}`);
          result[member.email] = await sendEmail({ ...payload, to: makeAddress(member) });
        } catch (e: any) {
          result[member.email] = { error: e?.message };
          console.error(`Error sending email to ${member.email}: ${e?.message}`, e);
        }
      }
      res.status(200).json(result);
    } else {
      requireDefined(payload.from, "from is required");
      assertDefined(payload.to, "to is required");
      const result = await sendEmail(payload as any);
      res.status(200).json(result);
    }
  } else {
    res.status(405).json({ error: "use POST" });
    res.end();
  }
};

export default withErrorHandler(handler);
