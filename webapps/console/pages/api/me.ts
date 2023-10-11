import { NextApiRequest, NextApiResponse } from "next";
import { getUser } from "../../lib/api";
import { requireDefined } from "juava";
import { getRequestHost } from "../../lib/server/origin";
import { db } from "../../lib/server/db";
import { getServerLog } from "../../lib/server/log";
import { getTopLevelDomain } from "@jitsu/js";
import { getUserPreferenceService } from "../../lib/server/user-preferences";
import { SessionUser } from "../../lib/schema";

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
    getServerLog()
      .atError()
      .log(
        `CORS error - origin ${origin} is not allowed. Masks: ${allowedOrigins} (compiled: ${compiledMasks}), request domain: ${requestDomain}, top level domain: ${topLevelDomain}`
      );
    res.status(403).send(`Origin ${origin} is not allowed`);
  } else {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
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

async function getLastWorkspace(user: SessionUser) {
  const pref = await getUserPreferenceService(db.prisma()).getPreferences({ userId: user.internalId });
  if (pref?.lastUsedWorkspaceId) {
    return {
      id: pref.lastUsedWorkspaceId,
      slug:
        (await db.prisma().workspace.findUnique({ where: { id: pref?.lastUsedWorkspaceId } }))?.slug ||
        pref.lastUsedWorkspaceId,
    };
  }
  return undefined;
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
      lastUsedWorkspace: req.query.lastWorkspace === "true" ? await getLastWorkspace(user) : undefined,
    });
  }
}
