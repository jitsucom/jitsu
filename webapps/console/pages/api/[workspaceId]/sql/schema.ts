import { createRoute, verifyAccess } from "../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined } from "juava";
import { ClickhouseCredentials } from "../../../../lib/schema/destinations";
import { columnType, getClickhouseClient } from "./query";
import { db } from "../../../../lib/server/db";

const log = getServerLog("sql-schema");

const resultType = z.record(z.array(columnType));

export type SQLSchemaType = z.infer<typeof resultType>;

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    const { workspaceId, destinationId } = query;
    await verifyAccess(user, workspaceId);
    const destination = requireDefined(
      await db.prisma().configurationObject.findFirst({
        where: { id: destinationId, workspaceId: workspaceId, type: "destination", deleted: false },
      }),
      `Destination ${destinationId} not found`
    );
    console.log(destination.config);

    const cred = ClickhouseCredentials.parse(destination.config);
    const clickhouse = getClickhouseClient(workspaceId, cred);
    const response: SQLSchemaType = {};
    const resultSet = await clickhouse.query({
      query: `select table_name, column_name, data_type
              from information_schema.columns
              where table_catalog = currentDatabase()
              order by table_name, ordinal_position`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    const result = await resultSet.json();
    let currentTable = null;
    let currentTableColumns: z.infer<typeof columnType>[] = [];
    (result as any).data.forEach(row => {
      const tableName = row["table_name"];
      if (tableName !== currentTable) {
        if (currentTable) {
          response[currentTable] = currentTableColumns;
        }
        currentTable = tableName;
        currentTableColumns = [];
      }
      currentTableColumns.push({ name: row["column_name"], type: row["data_type"] });
    });
    if (currentTable) {
      response[currentTable] = currentTableColumns;
    }
    return response;
  })
  .toNextApiHandler();
