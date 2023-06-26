import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import pick from "lodash/pick";
import { SourceType } from "../index";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req }): Promise<SourceType | null> => {
    const packageType = req.query.packageType as string;
    const packageId = req.query.packageId as string;
    const connectorPackage = await db.prisma().connectorPackage.findFirst({ where: { packageType, packageId } });
    if (!connectorPackage) {
      throw new Error(`Source ${packageId} of ${packageType} type not found`);
    }
    const { id, logoSvg, meta, ...rest } = connectorPackage;
    return {
      id,
      ...rest,
      logo: logoSvg
        ? `/api/sources/logo?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(rest.packageId)}`
        : undefined,
      versions: `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
        rest.packageId
      )}`,
      meta: pick(
        meta as any,
        "name",
        "license",
        "releaseStage",
        "dockerImageTag",
        "connectorSubtype",
        "dockerRepository"
      ),
    };
  })
  .toNextApiHandler();
