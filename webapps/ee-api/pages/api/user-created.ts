import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { sendEmail } from "../../lib/email";
import { makeAddress } from "./email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // Called by console right after signup, with the new user's own Firebase
    // token. The welcome email is sent to that verified address — a caller
    // can only ever trigger their own welcome email.
    const claims = requireDefined(await auth(req, res), `Auth is required`);
    const { name } = req.body || {};
    await sendEmail({
      to: makeAddress({ name, email: claims.email }),
      template: "welcome",
      //new user means new email, we don't allow to create multiple accounts with the same email
      //no need to respect unsubscribe for welcome email
      respectUnsubscribe: false,
      allowUnsubscribe: true,
    });
  } else {
    res.status(405).json({ error: "use POST" });
    res.end();
  }
};

export default withErrorHandler(handler);
