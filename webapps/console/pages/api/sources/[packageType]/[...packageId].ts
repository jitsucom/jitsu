import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import pick from "lodash/pick";
import { externalSources, jitsuSources, SourceType } from "../index";
import { getLog } from "juava";
import capitalize from "lodash/capitalize";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req, res }): Promise<SourceType | null> => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    const packageType = req.query.packageType as string;
    const packageId = Array.isArray(req.query.packageId)
      ? req.query.packageId.join("/")
      : (req.query.packageId as string);
    getLog().atInfo().log(`packageType: ${packageType}, packageId: ${packageId}`);
    const jitsuSource = jitsuSources[packageId];
    if (jitsuSource) {
      return jitsuSource;
    }
    const externalSource = externalSources[packageId];
    if (externalSource) {
      return externalSource;
    }
    const connectorPackage = await db.prisma().connectorPackage.findFirst({ where: { packageType, packageId } });
    if (!connectorPackage) {
      return {
        id: packageId,
        versions: `/api/sources/versions?type=${encodeURIComponent(packageType)}&package=${encodeURIComponent(
          packageId
        )}`,
        packageId,
        packageType,
        createdAt: new Date(),
        updatedAt: new Date(),
        meta: {
          name: capitalize(
            packageId
              .split("/")
              .pop()
              ?.replace(/^source-/g, "")
          ),
          license: "unknown",
          connectorSubtype: "unknown",
        },
      };
    }
    const { id, logoSvg, meta, ...rest } = connectorPackage;
    return {
      id,
      ...rest,
      logoSvg: logoSvg ? Buffer.from(logoSvg) : undefined,
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
