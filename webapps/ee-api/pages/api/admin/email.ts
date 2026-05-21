import { z } from "zod";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { emailTemplates } from "../../../lib/email";
import { sendWorkspaceEmail } from "../email";

const SendEmailBody = z.object({
  template: z.string().min(1),
  workspaceId: z.string().min(1),
});

/**
 * Email templates (GET) and sending a templated email to every member of a
 * workspace (POST `{ template, workspaceId }`).
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method === "GET") {
    return { templates: emailTemplates };
  }
  if (req.method === "POST") {
    const { template, workspaceId } = SendEmailBody.parse(req.body);
    return await sendWorkspaceEmail({ template, workspaceId });
  }
  res.status(405).json({ error: "Method not allowed" });
  return;
});
