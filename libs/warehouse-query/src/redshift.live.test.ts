import { expect, it } from "vitest";
import { createRedshiftReader } from "./redshift";
import { ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

it.skipIf(!process.env.TEST_RETL_REDSHIFT)(
  "Redshift live: metadata, exact values, cursor fetch and checkpoint resume",
  async () => {
    const reader = createRedshiftReader(JSON.parse(process.env.TEST_RETL_REDSHIFT!));
    const query = `SELECT 'a'::VARCHAR AS id, 9007199254740993::BIGINT AS updated, 0.00::DECIMAL(10,2) AS deleted UNION ALL SELECT 'b'::VARCHAR, 9007199254740993::BIGINT, 1.00::DECIMAL(10,2)`;
    const model = ModelDefinition.parse({
      warehouseId: "live",
      query,
      primaryKey: ["id"],
      cursor: { column: "updated", type: "number" },
      deleteColumn: "deleted",
      pageSize: 1,
    });
    try {
      reader.sql.validateColumns(model, await reader.columns(query));
      expect((await reader.preview(query)).rows.map(row => row.updated)).toEqual([
        "9007199254740993",
        "9007199254740993",
      ]);
      const records: SourceRecord[] = [];
      for await (const record of reader.stream(model, { value: "9007199254740993", primaryKeyValues: ["a"] }))
        records.push(record);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ row: { id: "b", deleted: "1.00" }, deleted: true });
      expect((await reader.preview(`SELECT * FROM (${query}) AS model WHERE 1=0`)).rows).toEqual([]);
    } finally {
      await reader.close();
    }
  },
  120_000
);
