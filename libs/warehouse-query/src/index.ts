import { createPostgresReader, postgresSql } from "./postgres";
import { createClickHouseReader, clickhouseSql } from "./clickhouse";
import { supportsWarehouseReader } from "./schema";
import type { WarehouseReader, WarehouseSqlDialect } from "./types";

export type { CompositeCursor, SourceRecord, WarehouseReader, WarehouseSqlDialect, CompiledModelQuery } from "./types";
export type { ModelDefinition, WarehouseColumn, PreviewResult } from "./schema";

/** Select SQL rules without parsing credentials or allocating a database client. */
export function getWarehouseSqlDialect(destinationType: string): WarehouseSqlDialect {
  switch (destinationType) {
    case "postgres":
      return postgresSql;
    case "clickhouse":
      return clickhouseSql;
    default:
      throw new Error("This warehouse connection is not supported for models yet");
  }
}

export function createWarehouseReader(config: Record<string, any>): WarehouseReader {
  if (!supportsWarehouseReader(config)) throw new Error("This warehouse connection is not supported for models yet");
  return config.destinationType === "postgres" ? createPostgresReader(config) : createClickHouseReader(config);
}
