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
    const tags = (await rpc(`https://hub.docker.com/v2/repositories/${query.package}/tags`)).results.map(
      ({ name }) => ({ name, isRelease: name.match(/^[0-9.]+$/) !== null })
    );
    return {
      versions: tags,
    };
  })
  .toNextApiHandler();
