import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { rpc } from "juava";
import { db } from "../../../lib/server/db";
import { jitsuSources } from "./index";

export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      type: z.string().optional(),
      package: z.string(),
    }),
  })
  .handler(async ({ req, query }) => {
    const type = query.type || "airbyte";
    const packageId = query.package;
    if (type !== "airbyte") {
      throw new Error(`Only airbyte is supported, not ${type}`);
    }
    let error: any = null;
    let mitVersions: string[] | undefined = undefined;
    if (!jitsuSources[packageId]) {
      const connectorPackage = await db
        .prisma()
        .connectorPackage.findFirst({ where: { packageType: type, packageId } });
      mitVersions = (connectorPackage?.meta as any).mitVersions;
    }
    for (let i = 0; i < 3; i++) {
      // endpoint prone to 500 errors
      try {
        const tags = (await rpc(`https://hub.docker.com/v2/repositories/${packageId}/tags?page_size=100`)).results.map(
          ({ name }) => ({
            name,
            isRelease: name.match(/^[0-9.]+$/) !== null,
            isMit: !mitVersions || mitVersions.includes(name),
          })
        );
        return {
          versions: tags,
        };
      } catch (e) {
        error = e;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw error;
  })
  .toNextApiHandler();
