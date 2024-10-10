import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../lib/auth";
import { assertTrue, requireDefined } from "juava";
import { withErrorHandler } from "../../lib/route-helpers";
import { s3client, store } from "../../lib/services";
import { CreateBucketCommand, CreateBucketCommandInput } from "@aws-sdk/client-s3";
import { getServerLog } from "../../lib/log";

const log = getServerLog("s3-bucket-init");

export type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
};

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
  const workspaceId = requireDefined(req.query.workspaceId as string, `?workspaceId= is required. Query: ${req.query}`);
  assertTrue(
    claims.type === "admin" || (claims.type === "user" && claims.workspaceId === workspaceId),
    `Token can't access workspace ${workspaceId}`
  );

  let credentials = await store.getTable("s3-buckets").get(workspaceId);
  if (credentials) {
    return res.status(200).json({
      ...credentials,
    });
  }

  const bucketName = `${workspaceId}.data.use.jitsu.com`;
  const bucketParams: CreateBucketCommandInput = {
    Bucket: bucketName,
  };
  const command = new CreateBucketCommand(bucketParams);

  const result = await s3client.send(command);

  log.atInfo().log(`Bucket ${workspaceId} status: ${JSON.stringify(result)}`);

  credentials = {
    bucket: bucketName,
    region: process.env.S3_REGION,
  };

  await store.getTable("s3-buckets").put(workspaceId, credentials);
  return {
    ...credentials,
  };
};
export default withErrorHandler(handler);
