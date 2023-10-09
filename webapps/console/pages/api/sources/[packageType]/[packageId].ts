import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import pick from "lodash/pick";
import { jitsuSources, SourceType } from "../index";
import { getLog } from "juava";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req, res }): Promise<SourceType | null> => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    const packageType = req.query.packageType as string;
    const _packageId = req.query.packageId as string;
    const packageId = _packageId.startsWith(`${packageType}/`) ? _packageId : `${packageType}/${_packageId}`;
    getLog().atDebug().log(`packageType: ${packageType}, packageId: ${packageId}`);
    const jitsuSource = jitsuSources[packageType + "/" + packageId];
    if (jitsuSource) {
      return jitsuSource;
    }
    const connectorPackage = await db.prisma().connectorPackage.findFirst({ where: { packageType, packageId } });
    if (!connectorPackage) {
      throw new Error(`Source ${packageId} of ${packageType} type not found`);
    }
    const { id, logoSvg, meta, ...rest } = connectorPackage;
    return {
      id,
      ...rest,
      logoSvg,
      versions: `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
        rest.packageId
      )}`,
      meta: pick(
        meta as any,
        "name",
        "mitVersions",
        "license",
        "releaseStage",
        "dockerImageTag",
        "connectorSubtype",
        "dockerRepository"
      ),
    };
  })
  .toNextApiHandler();
