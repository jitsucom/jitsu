import { NextApiRequest, NextApiResponse } from "next";
import { getUser } from "../../lib/api";
import { getLog, requireDefined } from "juava";
import { getRequestHost, getTopLevelDomain } from "../../lib/server/origin";
import { db } from "../../lib/server/db";

const allowedOrigins = process.env.ALLOWED_API_ORIGINS || "*.[originTopLevelDomain],[originTopLevelDomain]";

function getMatcher(mask: string): (test: string) => boolean {
  if (mask.startsWith("*")) {
    const suffix = mask.substring(1);
    return (test: string) => {
      console.log(`Matching ${mask} (suffix: ${suffix}) with ${test} - wildcard`);
      return test.toLowerCase().trim().endsWith(suffix.toLowerCase().trim());
    };
  } else {
    return (test: string) => {
      console.log(`Matching ${mask} with ${test}`);
      return test.toLowerCase().trim() === mask.toLowerCase().trim();
    };
  }
}

function handleCors(requestDomain: string, origin: string | undefined, res: NextApiResponse) {
  if (!origin) {
    //pass
    return;
  }
  const originHost = origin.replaceAll("http://", "").replaceAll("https://", "").split(":")[0];
  const topLevelDomain = getTopLevelDomain(requestDomain);
  const compiledMasks = allowedOrigins
    .split(",")
    .map(mask => mask.replaceAll("[originTopLevelDomain]", topLevelDomain));
  if (!compiledMasks.map(getMatcher).find(matcher => matcher(originHost))) {
    getLog()
      .atError()
      .log(
        `CORS error - origin ${origin} is not allowed. Masks: ${allowedOrigins} (compiled: ${compiledMasks}), request domain: ${requestDomain}, top level domain: ${topLevelDomain}`
      );
    res.status(403).send(`Origin ${origin} is not allowed`);
  } else {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

async function getWorkspaces(internalUserId: string) {
  const userModel = requireDefined(
    await db.prisma().userProfile.findUnique({ where: { id: internalUserId } }),
    `User ${internalUserId} does not exist`
  );
  if (userModel.admin) {
    return await db.prisma().workspace.findMany({ where: { deleted: false } });
  }
  return (
    await db.prisma().workspaceAccess.findMany({ where: { userId: internalUserId }, include: { workspace: true } })
  )
    .map(res => res.workspace)
    .filter(w => !w.deleted);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const [hostname] = getRequestHost(req).split(":");
  handleCors(hostname, req.headers.origin, res);
  const user = await getUser(res, req, true);
  if (!user) {
    res.send({ auth: false });
  } else {
    res.send({
      auth: true,
      user: user,
      workspaces: req.query.workspaces === "true" ? await getWorkspaces(user.internalId) : undefined,
    });
  }
}
