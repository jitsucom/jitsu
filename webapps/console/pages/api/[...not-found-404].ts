import { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res
    .status(404)
    .setHeader("Content-type", "application/json")
    .send({ error: "Path not found: " + req.url });
}
