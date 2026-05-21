import { createRoute, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { ClickhouseConnectionCredentials } from "../../../../../lib/schema/clickhouse-connection-credentials";
import { assertTrue, rpc } from "juava";
import { eeAuthHeaders, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), destinationId: z.string() }),
    result: ClickhouseConnectionCredentials,
  })
  .handler(async ({ user, query, req }) => {
    assertTrue(isEEAvailable(), `EE server URL is not set, DB can't be provisioned`);
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const { host } = getEeConnection();
    const provisionedDbCredentials = await rpc(`${host}api/provision-db`, {
      method: "POST",
      query: { workspaceId, slug: workspaceId }, //db is created, so the slug won't be really used
      headers: {
        "Content-Type": "application/json",
        //forward the caller's Firebase credential so ee-api authenticates them
        ...eeAuthHeaders(req),
      },
    });

    return {
      host: provisionedDbCredentials.hosts[0],
      username: provisionedDbCredentials.username,
      database: provisionedDbCredentials.database,
      httpPort: 8443,
      tcpPort: 9440,
      pgPort: 9005,
      password: provisionedDbCredentials.password,
    };
  })
  .toNextApiHandler();
