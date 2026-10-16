import { expect, it, vi } from "vitest";
import { createSnowflakeReader } from "./snowflake";
import { ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

it.skipIf(!process.env.TEST_RETL_SNOWFLAKE)(
  "Snowflake live: extraction and duplicate detection with either quoted identifier case setting",
  async () => {
    const { default: sdk } = await import("snowflake-sdk");
    const createConnection = sdk.createConnection.bind(sdk);
    const reader = createSnowflakeReader(JSON.parse(process.env.TEST_RETL_SNOWFLAKE!));
    let ignoreCase = false;
    vi.spyOn(sdk, "createConnection").mockImplementation(options => {
      const connection = createConnection(options);
      const execute = connection.execute.bind(connection);
      vi.spyOn(connection, "execute").mockImplementation(options =>
        execute({
          ...options,
          parameters: { ...options.parameters, QUOTED_IDENTIFIERS_IGNORE_CASE: ignoreCase },
        })
      );
      return connection;
    });
    try {
      for (ignoreCase of [false, true]) {
        const query = "SELECT 1 AS id, OBJECT_CONSTRUCT('value', 9007199254740993) AS payload";
        const model = ModelDefinition.parse({ warehouseId: "live", query, primaryKey: ["ID"] });
        const preview = await reader.preview(query);
        const records: SourceRecord[] = [];
        for await (const record of reader.stream(model)) records.push(record);
        expect(records).toHaveLength(1);
        expect(records[0].row).toEqual(preview.rows[0]);
        expect(records[0].row).toEqual({ ID: "1", PAYLOAD: expect.stringContaining("9007199254740993") });
        await expect(async () => {
          for await (const _ of reader.stream({ ...model, query: `${query} UNION ALL ${query}` })) {
            /* consume */
          }
        }).rejects.toThrow("duplicate primary keys");
      }
    } finally {
      await reader.close();
      vi.restoreAllMocks();
    }
  },
  120_000
);

it.skipIf(!process.env.TEST_RETL_SNOWFLAKE)(
  "Snowflake live: temporal checkpoint resume ignores custom input formats",
  async () => {
    const { default: sdk } = await import("snowflake-sdk");
    const createConnection = sdk.createConnection.bind(sdk);
    // Simulate inherited user settings without altering the account/user or exposing
    // arbitrary session parameters through the production reader's configuration.
    vi.spyOn(sdk, "createConnection").mockImplementation(options => {
      const connection = createConnection(options);
      const execute = connection.execute.bind(connection);
      vi.spyOn(connection, "execute").mockImplementation(options =>
        execute({
          ...options,
          parameters: {
            ...options.parameters,
            DATE_INPUT_FORMAT: "DD/MM/YYYY",
            TIME_INPUT_FORMAT: "HH24:MI",
            TIMESTAMP_INPUT_FORMAT: "MM/DD/YYYY HH24:MI:SS",
            TIMESTAMP_TYPE_MAPPING: "TIMESTAMP_LTZ",
          },
        })
      );
      return connection;
    });
    const reader = createSnowflakeReader(JSON.parse(process.env.TEST_RETL_SNOWFLAKE!));
    const query = `SELECT "id", 1 AS "sequence",
      TO_DATE('2026-01-01', 'YYYY-MM-DD') AS "DATE",
      TO_TIME('12:34:56.123456789', 'HH24:MI:SS.FF9') AS "TIME",
      TO_TIMESTAMP_NTZ('2026-01-01 12:34:56.123456789', 'YYYY-MM-DD HH24:MI:SS.FF9') AS "TIMESTAMP_NTZ",
      TO_TIMESTAMP_LTZ('2026-01-01 12:34:56.123456789 +00:00', 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM') AS "TIMESTAMP_LTZ",
      TO_TIMESTAMP_TZ('2026-01-01 12:34:56.123456789 -07:00', 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM') AS "TIMESTAMP_TZ"
      FROM (SELECT 'a' AS "id" UNION ALL SELECT 'b' AS "id") AS fixture_rows`;
    try {
      for (const type of ["DATE", "TIME", "TIMESTAMP_NTZ", "TIMESTAMP_LTZ", "TIMESTAMP_TZ"]) {
        const model = ModelDefinition.parse({
          warehouseId: "live",
          query,
          primaryKey: [type, "id"],
          cursor: { column: type === "TIME" ? "sequence" : type, type: type === "TIME" ? "number" : "timestamp" },
        });
        const initial: SourceRecord[] = [];
        for await (const record of reader.stream(model)) initial.push(record);
        expect(initial.map(r => r.row.id)).toEqual(["a", "b"]);
        const resumed: SourceRecord[] = [];
        for await (const record of reader.stream(model, initial[0].checkpoint)) resumed.push(record);
        expect(resumed).toEqual([initial[1]]);
      }
    } finally {
      await reader.close();
      vi.restoreAllMocks();
    }
  },
  120_000
);

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
