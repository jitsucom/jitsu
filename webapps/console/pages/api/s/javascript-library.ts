import { NextApiRequest, NextApiResponse } from "next";
const scriptSrc = require("@jitsu/js/dist/web/p.js.txt").default;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).setHeader("Content-type", "application/javascript").send(scriptSrc);
}
