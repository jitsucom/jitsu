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

it.skipIf(!process.env.TEST_RETL_SNOWFLAKE)(
  "Snowflake live: nullable scalars, structured precision and decimal delete flags",
  async () => {
    const reader = createSnowflakeReader(JSON.parse(process.env.TEST_RETL_SNOWFLAKE!));
    const query = `SELECT 1::NUMBER AS "id", 1.00::NUMBER(38,2) AS "deleted",
      NULL::NUMBER AS "nullable_number", NULL::DATE AS "nullable_date",
      NULL::TIME AS "nullable_time", NULL::TIMESTAMP_NTZ AS "nullable_timestamp",
      OBJECT_CONSTRUCT('id', 9007199254740993) AS "object_value",
      ARRAY_CONSTRUCT(9007199254740993) AS "array_value",
      ARRAY_CONSTRUCT_STRUCTURED(9007199254740993) AS "typed_array",
      OBJECT_CONSTRUCT_KEEP_NULL_STRUCTURED('id', 9007199254740993) AS "typed_object",
      MAP_CONSTRUCT('id', 9007199254740993) AS "map_value"`;
    try {
      const preview = await reader.preview(query);
      for (const key of ["nullable_number", "nullable_date", "nullable_time", "nullable_timestamp"])
        expect(preview.rows[0][key]).toBeNull();
      for (const key of ["object_value", "array_value", "typed_array", "typed_object", "map_value"]) {
        expect(typeof preview.rows[0][key]).toBe("string");
        expect(preview.rows[0][key]).toContain("9007199254740993");
      }
      const records: SourceRecord[] = [];
      const model = ModelDefinition.parse({ warehouseId: "live", query, primaryKey: ["id"], deleteColumn: "deleted" });
      for await (const record of reader.stream(model)) records.push(record);
      expect(records).toHaveLength(1);
      expect(records[0].deleted).toBe(true);
      expect(records[0].row).toEqual(preview.rows[0]);
      await expect(async () => {
        for await (const _ of reader.stream({
          ...model,
          query: 'SELECT NULL::NUMBER AS "id"',
          deleteColumn: undefined,
        })) {
          /* consume */
        }
      }).rejects.toThrow(/non-null/);
    } finally {
      await reader.close();
    }
  },
  120_000
);
