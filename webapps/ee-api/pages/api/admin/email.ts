import { z } from "zod";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { broadcastEmailTemplates } from "../../../lib/email";
import { sendWorkspaceEmail } from "../email";

const SendEmailBody = z.object({
  template: z.string().min(1),
  workspaceId: z.string().min(1),
});

/**
 * Broadcastable email templates (GET) and sending a templated email to every
 * member of a workspace (POST `{ template, workspaceId }`).
 *
 * Only `broadcastEmailTemplates` may be sent — templates that need per-event
 * variables are rejected so this flow can't email placeholder values to users.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method === "GET") {
    return { templates: broadcastEmailTemplates };
  }
  if (req.method === "POST") {
    const { template, workspaceId } = SendEmailBody.parse(req.body);
    if (!(broadcastEmailTemplates as readonly string[]).includes(template)) {
      res.status(400).json({ error: `Template "${template}" cannot be broadcast from this screen` });
      return;
    }
    return await sendWorkspaceEmail({ template, workspaceId });
  }
  res.status(405).json({ error: "Method not allowed" });
  return;
});
