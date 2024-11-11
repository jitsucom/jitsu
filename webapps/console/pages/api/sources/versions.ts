import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { rpc } from "juava";
import { db } from "../../../lib/server/db";
import { externalSources, jitsuSources } from "./index";

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
    let isMit = false;
    const connectorPackage = await db.prisma().connectorPackage.findFirst({ where: { packageType: type, packageId } });
    if (connectorPackage) {
      isMit = !!(connectorPackage?.meta as any).mitVersions?.length;
    } else if (jitsuSources[packageId]) {
      isMit = true;
    } else if (externalSources[packageId]) {
      isMit = externalSources[packageId].meta.license === "MIT";
      if (Array.isArray(externalSources[packageId].versions)) {
        return {
          versions: externalSources[packageId].versions.map(v => ({ name: v, isRelease: true, isMit })),
        };
      }
    }
    for (let i = 0; i < 3; i++) {
      // endpoint prone to 500 errors
      try {
        const tags = (await rpc(`https://hub.docker.com/v2/repositories/${packageId}/tags?page_size=200`)).results.map(
          ({ name }) => ({
            name,
            isRelease: name.match(/^[0-9.]+$/) !== null,
            isMit,
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
