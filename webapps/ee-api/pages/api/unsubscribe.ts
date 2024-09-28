import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { getUnsubscribeCode, isUnsubscribed, unsubscribe } from "../../lib/email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const email = req.query.email as string;
  const code = req.query.code as string;
  const codeValidation = await getUnsubscribeCode(email.toLowerCase().trim(), { rotateExpired: false });
  if (codeValidation !== code) {
    res.status(400);
    res.write("ERROR: validation code is invalid or expired. Please try again.");
    res.end();
    return;
  } else if (await isUnsubscribed(email.toLowerCase().trim())) {
    res.status(200);
    res.write(`${email} is already unsubscribed. You can close this page.`);
    res.end();
  } else {
    await unsubscribe(email.toLowerCase().trim());
    res.status(200);
    res.write(`${email} has been unsubscribed. You can close this page.`);
    res.end();
  }
  //res.setHeader("Content-Type", "html/text");
  res.status(200);
  res.write("Hey!");
  res.end();
};

export default withErrorHandler(handler);
