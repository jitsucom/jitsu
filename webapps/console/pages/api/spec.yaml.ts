import { NextApiRequest, NextApiResponse } from "next";
import yaml from "js-yaml";
import { buildOpenApiSpec } from "../../lib/openapi/buildSpec";
import { getServerLog } from "../../lib/server/log";

const log = getServerLog("openapi-spec-yaml");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const spec = buildOpenApiSpec();
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(yaml.dump(spec, { noRefs: true }));
  } catch (e) {
    log.atError().withCause(e).log("Failed to build OpenAPI spec (YAML)");
    res.status(500).json({ error: "Failed to build OpenAPI spec" });
  }
}
