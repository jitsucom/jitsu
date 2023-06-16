import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import omit from "lodash/omit";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req }) => {
    return {
      sources: (await db.prisma().connectorPackage.findMany()).map(({ id, logoSvg, meta, ...rest }) => ({
        ...rest,
        logo: logoSvg
          ? `/api/sources/logo?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
              rest.packageId
            )}`
          : undefined,
        versions: `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
          rest.packageId
        )}`,
        meta: omit(meta as any, "icon", "tags", "registries", "definitionId", "documentationUrl", "githubIssueLabel"),
      })),
    };
  })
  .toNextApiHandler();
