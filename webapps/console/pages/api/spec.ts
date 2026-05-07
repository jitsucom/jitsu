import { NextApiRequest, NextApiResponse } from "next";
import { buildOpenApiSpec } from "../../lib/openapi/buildSpec";
import { getServerLog } from "../../lib/server/log";

const log = getServerLog("openapi-spec");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const spec = buildOpenApiSpec();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(JSON.stringify(spec, null, 2));
  } catch (e) {
    log.atError().withCause(e).log("Failed to build OpenAPI spec");
    res.status(500).json({ error: "Failed to build OpenAPI spec" });
  }
}
