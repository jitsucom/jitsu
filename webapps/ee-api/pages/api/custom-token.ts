import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/error-handler";
import { createCustomToken } from "../../lib/firebase-auth";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  const customToken = await createCustomToken(req);
  if (customToken) {
    return { customToken: customToken };
  } else {
    return {};
  }
};

export default withErrorHandler(handler);
