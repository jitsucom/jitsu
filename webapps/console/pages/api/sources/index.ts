import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import * as z from "zod";
import { ConnectorPackageDbModel } from "../../../prisma/schema";
import pick from "lodash/pick";

export const SourceType = ConnectorPackageDbModel.merge(
  z.object({
    logo: z.string().optional(),
    versions: z.string(),
    meta: z.object({
      name: z.string(),
      license: z.string(),
      mitVersions: z.array(z.string()).optional(),
      releaseStage: z.string(),
      dockerImageTag: z.string(),
      connectorSubtype: z.string(),
      dockerRepository: z.string(),
    }),
  })
);

export type SourceType = z.infer<typeof SourceType>;

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req }): Promise<{ sources: SourceType[] }> => {
    return {
      sources: (await db.prisma().connectorPackage.findMany()).map(({ id, logoSvg, meta, ...rest }) => ({
        id,
        ...rest,
        logo: logoSvg
          ? `/api/sources/logo?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
              rest.packageId
            )}`
          : undefined,
        versions: `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
          rest.packageId
        )}`,
        meta: pick(
          meta as any,
          "name",
          "license",
          "mitVersions",
          "releaseStage",
          "dockerImageTag",
          "connectorSubtype",
          "dockerRepository"
        ),
      })),
    };
  })
  .toNextApiHandler();
