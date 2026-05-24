import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { sendEmail } from "../../lib/email";
import { makeAddress } from "./email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "use POST" });
    return;
  }
  // System-to-system call from console after signup, authenticated with the
  // service token. `auth()` accepts only system tokens here in practice —
  // the new user themselves isn't around to authenticate.
  const claims = requireDefined(await auth(req, res), `Auth is required`);
  if (claims.type !== "admin") {
    res.status(403).json({ error: "user-created requires a system caller" });
    return;
  }
  const { email, name } = req.body || {};
  await sendEmail({
    to: makeAddress({ name, email: requireDefined(email, `body.email is required`) }),
    template: "welcome",
    // new user means new email — no unsubscribe history to honor, and we want
    // them to be able to opt out from future mailings.
    respectUnsubscribe: false,
    allowUnsubscribe: true,
  });
};

export default withErrorHandler(handler);
