import { createRoute, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { ClickhouseConnectionCredentials } from "../../../../../lib/schema/clickhouse-connection-credentials";
import { assertTrue, rpc } from "juava";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), destinationId: z.string() }),
    result: ClickhouseConnectionCredentials,
  })
  .handler(async ({ user, query }) => {
    assertTrue(isEEAvailable(), `EE server URL is not set, DB can't be provisioned`);
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const url = `${getEeConnection().host}api/provision-db`;
    const provisionedDbCredentials = await rpc(url, {
      method: "POST",
      query: { workspaceId, slug: workspaceId }, //db is created, so the slug won't be really used
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${createJwt(user.internalId, user.email, workspaceId, 60).jwt}`,
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
