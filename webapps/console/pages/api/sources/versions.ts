import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { rpc } from "juava";

export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      type: z.string().optional(),
      package: z.string().optional(),
    }),
  })
  .handler(async ({ req, query }) => {
    const type = query.type || "airbyte";
    if (type !== "airbyte") {
      throw new Error(`Only airbyte is supported, not ${type}`);
    }
    let error: any = null;
    for (let i = 0; i < 3; i++) {
      // endpoint prone to 500 errors
      try {
        const tags = (
          await rpc(`https://hub.docker.com/v2/repositories/${query.package}/tags?page_size=100`)
        ).results.map(({ name }) => ({ name, isRelease: name.match(/^[0-9.]+$/) !== null }));
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
