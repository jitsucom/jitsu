import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../lib/auth";
import { assertTrue } from "juava";
import { withErrorHandler } from "../../lib/route-helpers";
import { pg } from "../../lib/services";
import { getServerLog } from "../../lib/log";
import pick from "lodash/pick";

const log = getServerLog("s3-bucket-init");

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!process.env.S3_REGION || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return res.status(200).json({
      error: "S3 is not configured",
    });
  }

  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  assertTrue(claims.type === "admin", "Only admins can call this API");

  const workspaces = await pg.query(`
      select *
      from newjitsu."Workspace" ws
      where deleted = false
        and not 'nobackup' = any ("featuresEnabled")
        and (select count(*) from newjitsu."ConfigurationObjectLink" where "workspaceId" = ws.id and type = 'push' and deleted = false) > 0`);
  return workspaces.rows.map(w => ({
    __debug: {
      workspace: { ...pick(w, "id", "slug") },
    },
    id: `${w.id}_backup`,
    type: "s3",
    special: "backup",
    options: {
      dataLayout: "passthrough",
      deduplicate: false,
      frequency: 60,
      batchSize: 1_000_000,
    },
    credentials: {
      region: process.env.S3_REGION,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      bucket: `${w.id}.data.use.jitsu.com`,
      compression: "gzip",
      format: "ndjson",
      folder: "[DATE]",
    },
  }));
};
export default withErrorHandler(handler);
