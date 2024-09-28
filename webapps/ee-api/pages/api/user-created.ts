import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { sendEmail } from "../../lib/email";
import { makeAddress } from "./email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const claims = requireDefined(await auth(req, res), `Auth is required`);
    assertTrue(claims.type === "admin", "Should be admin");
    const { email, name } = requireDefined(req.body, "Body is required");
    assertDefined(email, "email is required");
    await sendEmail({
      to: makeAddress({ name, email }),
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
