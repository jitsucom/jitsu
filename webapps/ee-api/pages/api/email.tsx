import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { pg, store } from "../../lib/services";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { EmailSendingResult, getWorkspaceInfo, sendEmail, SendEmailRequest, WorkspaceInfo } from "../../lib/email";

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

async function logWorkspaceEmail(opts: { workspaceId: string; [key: string]: any }) {
  const { workspaceId, ...data } = opts;
  const log = (await store.getTable("email-logs").get(workspaceId)) || { logs: [] };
  log.logs.push(data);
  await store.getTable("email-logs").put(workspaceId, log);
}

export async function sendWorkspaceEmail(payload: SendEmailRequest): Promise<{
  sent: Record<string, EmailSendingResult>;
  errors: Record<string, string>;
  workspace: WorkspaceInfo;
}> {
  const sent: Record<string, EmailSendingResult> = {};
  const errors: Record<string, string> = {};
  const workspace = requireDefined(
    await getWorkspaceInfo(payload.workspaceId),
    `Workspace not found: ${payload.workspaceId}`
  );
  const members = await getWorkspaceMembers(workspace.workspaceId);
  for (const member of members) {
    try {
      console.log(
        `Handling member  ${member.email} of workspace ${workspace.workspaceId} / ${workspace.workspaceSlug}`
      );
      sent[member.email] = await sendEmail({ ...payload, to: makeAddress(member) });
    } catch (e: any) {
      errors[member.email] = e?.message;
      console.error(`Error sending email to ${member.email}: ${e?.message}`, e);
    }
  }
  const subject = Object.values(sent)
    .filter(res => res.sent)
    .map(res => res.subject);
  await logWorkspaceEmail({
    timestamp: dayjs().utc().toISOString(),
    workspaceId: workspace.workspaceId,
    subject: subject || "No emails sent, all unsubscribed",
    template: payload.template,
    sentTo: Object.keys(sent).join(", "),
    errors: Object.keys(errors).length > 0 ? Object.keys(errors).join(", ") : undefined,
  });
  return { sent, errors, workspace };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const claims = requireDefined(await auth(req, res), `Auth is required`);
    assertTrue(claims.type === "admin", "Invalid auth claims");
    const payload = SendEmailRequest.parse(req.body);
    if (payload.workspaceId) {
      const result = await sendWorkspaceEmail(payload);
      res.status(200).json(result);
    } else {
      requireDefined(payload.from, "from is required");
      assertDefined(payload.to, "to is required");
      const result = await sendEmail(payload as any);
      res.status(200).json({ result });
    }
  } else {
    res.status(405).json({ error: "use POST" });
    res.end();
  }
};

export default withErrorHandler(handler);
