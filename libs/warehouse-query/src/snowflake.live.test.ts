import { expect, it } from "vitest";
import { createSnowflakeReader } from "./snowflake";
import { ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

// Explicit opt-in. Queries use literals only; no tables, schemas or accounts are mutated.
it.skipIf(!process.env.TEST_RETL_SNOWFLAKE)(
  "Snowflake live: metadata, exact preview, cursor resume and empty result",
  async () => {
    const reader = createSnowflakeReader(JSON.parse(process.env.TEST_RETL_SNOWFLAKE!));
    const query = `SELECT 'a' AS "id", 9007199254740993::NUMBER(38,0) AS "updated", FALSE AS "deleted"
    UNION ALL SELECT 'b', 9007199254740993::NUMBER(38,0), TRUE`;
    const model = ModelDefinition.parse({
      warehouseId: "live",
      query,
      primaryKey: ["id"],
      cursor: { column: "updated", type: "number" },
      deleteColumn: "deleted",
    });
    try {
      const columns = await reader.columns(query);
      reader.sql.validateColumns(model, columns);
      const preview = await reader.preview(query);
      expect(preview.rows.map(r => r.updated)).toEqual(["9007199254740993", "9007199254740993"]);
      const records: SourceRecord[] = [];
      for await (const record of reader.stream(model, { value: "9007199254740993", primaryKeyValues: ["a"] }))
        records.push(record);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ row: { id: "b" }, deleted: true });
      expect((await reader.preview(`SELECT * FROM (${query}) AS model WHERE 1=0`)).rows).toEqual([]);
    } finally {
      await reader.close();
    }
  },
  120_000
);
