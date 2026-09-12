import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { createWarehouseReader, SourceRecord } from "@jitsu/warehouse-query";
import { ModelDefinition } from "@jitsu/warehouse-query/src/schema";
import { compilePostgresPreview, postgresSql } from "@jitsu/warehouse-query/src/postgres";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { modelMutation, previewModel, recheckModelWarehouse } from "../../lib/server/reverse-etl-models";
import { getServerEnv } from "../../lib/server/serverEnv";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";

const env = getServerEnv();
const pgUrl = new URL(env.DATABASE_URL);
const chUrl = new URL(env.CLICKHOUSE_URL!);
const pgConfig = {
  destinationType: "postgres",
  host: pgUrl.hostname,
  port: Number(pgUrl.port),
  database: pgUrl.pathname.slice(1),
  username: pgUrl.username,
  password: pgUrl.password,
  sslMode: "disable",
  defaultSchema: "public",
};
const chConfig = {
  destinationType: "clickhouse",
  protocol: "http",
  hosts: [chUrl.host],
  database: env.CLICKHOUSE_DATABASE,
  username: "default",
  password: "",
};
const pgReader = createWarehouseReader(pgConfig);
const chReader = createWarehouseReader(chConfig);
const keyTypes = [
  "LowCardinality(String)",
  "FixedString(16)",
  "LowCardinality(FixedString(16))",
  "LowCardinality(Nullable(String))",
  "Nullable(FixedString(16))",
];
const structuredKeyTypes = ["Array(String)", "Map(String, UInt64)", "Tuple(String, UInt64)"];
const definition = ModelDefinition.parse({
  warehouseId: "test",
  query: "SELECT id, changed, removed FROM retl_audience",
  primaryKey: ["id"],
  cursor: { column: "changed", type: "timestamp" },
  deleteColumn: "removed",
  pageSize: 1,
});
async function collect(rows: AsyncIterable<SourceRecord>) {
  const result: SourceRecord[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

beforeAll(async () => {
  await deps().clickhouse.command({ query: "CREATE TABLE retl_delete_flags (id UInt64, flag UInt8) ENGINE = Memory" });
  await deps().clickhouse.command({ query: "INSERT INTO retl_delete_flags VALUES (1, 0), (2, 1)" });
  for (const [index, type] of structuredKeyTypes.entries()) {
    await deps().clickhouse.command({
      query: `CREATE TABLE retl_structured_keys_${index} (id ${type}, changed DateTime64(6)) ENGINE = Memory`,
    });
  }
  for (const [index, type] of keyTypes.entries()) {
    await deps().clickhouse.command({
      query: `CREATE TABLE retl_keys_${index} (id ${type}, changed UInt64) ENGINE = Memory`,
    });
    await deps().clickhouse.command({ query: `INSERT INTO retl_keys_${index} VALUES ('a', 7), ('b', 7), ('c', 8)` });
  }
  await deps().clickhouse.command({
    query: "CREATE TABLE retl_unsupported_keys (id Enum8('a' = 1), changed UInt64) ENGINE = Memory",
  });
  await deps().pgPool.query("CREATE TABLE public.retl_audience (id bigint, changed timestamptz, removed boolean)");
  await deps().pgPool.query(
    "INSERT INTO public.retl_audience VALUES (9007199254740993, '2026-01-01 00:00:00.123456+00', false), (9007199254740994, '2026-01-01 00:00:00.123456+00', true), (9007199254740995, '2026-01-01 00:00:00.123457+00', false)"
  );
  await deps().clickhouse.command({
    query:
      "CREATE TABLE retl_audience (id UInt64, changed DateTime64(6, 'UTC'), removed UInt8) ENGINE = MergeTree ORDER BY id",
  });
  await deps().clickhouse.command({
    query:
      "INSERT INTO retl_audience VALUES (9007199254740993, '2026-01-01 00:00:00.123456', 0), (9007199254740994, '2026-01-01 00:00:00.123456', 1), (9007199254740995, '2026-01-01 00:00:00.123457', 0)",
  });
});
afterAll(async () => {
  await pgReader.close();
  await chReader.close();
});

it.each([
  ["https", 443, ""],
  ["http", 80, ""],
  ["https", 443, "/"],
  ["http", 80, "/"],
] as const)("preserves an explicit %s port %s with suffix '%s'", async (protocol, port, suffix) => {
  server.use(
    http.post(`${protocol}://warehouse.test.local`, () =>
      HttpResponse.json({
        meta: [{ name: "id", type: "UInt8" }],
        data: [],
        rows: 0,
      })
    )
  );
  const reader = createWarehouseReader({ ...chConfig, protocol, hosts: [`warehouse.test.local:${port}${suffix}`] });
  try {
    expect(await reader.columns("SELECT 1 AS id")).toEqual([{ name: "id", type: "UInt8" }]);
  } finally {
    await reader.close();
  }
});

describe.each([
  ["Postgres", pgReader],
  ["ClickHouse", chReader],
] as const)("%s reader", (_, reader) => {
  it("preserves big integers, microseconds and cursor ties through resume", async () => {
    const rows = await collect(reader.stream(definition));
    expect(rows.map(r => r.row.id)).toEqual(["9007199254740993", "9007199254740994", "9007199254740995"]);
    expect(rows.map(r => r.deleted)).toEqual([false, true, false]);
    expect(rows[0].checkpoint!.value).toContain(".123456");
    const resumed = await collect(reader.stream(definition, rows[0].checkpoint));
    expect(resumed.map(r => r.row.id)).toEqual(["9007199254740994", "9007199254740995"]);
    const lookback = await collect(
      reader.stream({ ...definition, cursor: { ...definition.cursor!, lookbackSeconds: 60 } }, rows[1].checkpoint)
    );
    expect(lookback).toHaveLength(3);
  });
  it("rejects duplicate keys even across different cursor values", async () => {
    await expect(
      collect(reader.stream({ ...definition, query: "SELECT 1 AS id, changed, removed FROM retl_audience" }))
    ).rejects.toThrow(/duplicate primary keys/);
  });
  it("zero lookback replays cursor ties before the saved key, but not older rows", async () => {
    const input = { ...definition, cursor: { ...definition.cursor!, lookbackSeconds: 0 } };
    const rows = await collect(reader.stream(input));
    expect(await collect(reader.stream(input, rows[1].checkpoint))).toEqual(rows);
    expect(await collect(reader.stream(input, rows[2].checkpoint))).toEqual(rows.slice(2));
    // An omitted lookback retains strict composite resume semantics.
    expect(await collect(reader.stream(definition, rows[1].checkpoint))).toEqual(rows.slice(2));
  });
  it("rejects null keys", async () => {
    await expect(
      collect(
        reader.stream({
          ...definition,
          query: "SELECT NULL AS id, changed, removed FROM retl_audience",
          cursor: undefined,
        })
      )
    ).rejects.toThrow();
  });
  it("cancels before sending SQL", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(reader.preview("SELECT 1 AS id", controller.signal)).rejects.toThrow();
  });
});

it("Postgres preview caps rows and does not lose precision", async () => {
  const preview = await pgReader.preview("SELECT id FROM generate_series(1, 150) AS id");
  expect(preview.rows).toHaveLength(100);
  expect(preview.truncated).toBe(true);
  expect((await pgReader.preview(definition.query)).rows[0].id).toBe("9007199254740993");
});

it("preserves PostgreSQL case folding and literal semicolons", async () => {
  const result = await pgReader.preview(
    "SELECT ID AS ID, '; -- not a comment' AS literal FROM RETL_AUDIENCE; -- tail;"
  );
  expect(result.columns.map(c => c.name)).toEqual(["id", "literal"]);
  expect(result.rows[0].literal).toBe("; -- not a comment");
});
it("Postgres enforces read-only even inside a mutating function", async () => {
  await deps().pgPool.query(
    "CREATE FUNCTION public.retl_mutate() RETURNS integer LANGUAGE sql AS 'INSERT INTO public.retl_audience VALUES (4, now(), false) RETURNING 1'"
  );
  await expect(pgReader.preview("SELECT retl_mutate() AS value")).rejects.toThrow(/read-only/);
});
it("Postgres cancels an in-flight query", async () => {
  await expect(pgReader.preview("SELECT pg_sleep(10)", AbortSignal.timeout(50))).rejects.toThrow();
});

it("ClickHouse preserves null, boolean, and decimal values", async () => {
  const result = await chReader.preview(
    "SELECT NULL AS missing, true AS enabled, toDecimal64('1234567890.123456', 6) AS amount"
  );
  expect(result.rows[0]).toEqual({ missing: null, enabled: true, amount: "1234567890.123456" });
});

it("both readers enforce the preview byte limit", async () => {
  await expect(pgReader.preview("SELECT repeat('x', 2000001) AS large")).rejects.toThrow(/2 MB/);
  await expect(chReader.preview("SELECT repeat('x', 2000001) AS large")).rejects.toThrow();
});

describe("Postgres preview server-side byte guard", () => {
  it("evaluates volatile source expressions only once for sizing and delivery", async () => {
    await deps().pgPool.query(`CREATE FUNCTION public.retl_preview_once() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
      BEGIN
        IF current_setting('jitsu.preview_evaluated', true) = 'yes' THEN
          RAISE EXCEPTION 'Source expression was evaluated twice';
        END IF;
        PERFORM set_config('jitsu.preview_evaluated', 'yes', true);
        RETURN 'small';
      END;
    $$`);
    expect((await pgReader.preview("SELECT retl_preview_once() AS value")).rows).toEqual([{ value: "small" }]);
  });
  it("never transfers the overflow row's large payload", async () => {
    const query =
      "SELECT id, CASE WHEN id = 101 THEN repeat('x', 4000000) ELSE 'small' END AS value FROM generate_series(1, 101) AS id ORDER BY id";
    const raw = await deps().pgPool.query(compilePostgresPreview(postgresSql.validateQuery(query), 2));
    expect(raw.rows).toHaveLength(101);
    expect(raw.rows[100]).toEqual(["101", false, null, null]);
    expect(Buffer.byteLength(JSON.stringify(raw.rows))).toBeLessThan(10_000);
    const preview = await pgReader.preview(query);
    expect(preview.rows).toHaveLength(100);
    expect(preview.truncated).toBe(true);
    expect(preview.rows.every(row => row.value === "small")).toBe(true);
  });
  it.each([
    "SELECT repeat('x', 2000001) AS value",
    "SELECT repeat('x', 30000) AS value FROM generate_series(1, 100)",
    "SELECT repeat('界', 700000) AS value",
  ])("withholds oversized displayed values at the SQL boundary: %s", async query => {
    const raw = await deps().pgPool.query(compilePostgresPreview(postgresSql.validateQuery(query), 1));
    expect(raw.rows.length).toBeGreaterThan(0);
    expect(raw.rows.every(row => row[1] === true && row[2] === null)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(raw.rows))).toBeLessThan(10_000);
    await expect(pgReader.preview(query)).rejects.toThrow(/2 MB/);
  });
  it("still rejects values that exceed the final JSON budget after escaping", async () => {
    await expect(pgReader.preview("SELECT repeat(chr(1), 400000) AS value")).rejects.toThrow(/2 MB/);
  });
  it("preserves native decoding, metadata and names that match internal columns", async () => {
    const result = await pgReader.preview(
      "SELECT 9007199254740993::bigint AS n, 1.234567890123456789::numeric AS oversized, '2026-01-01 00:00:00.123456+00'::timestamptz AS c0, true AS enabled, NULL::text AS missing, '{\"x\":1}'::jsonb AS obj"
    );
    expect(result.rows).toEqual([
      {
        n: "9007199254740993",
        oversized: "1.234567890123456789",
        c0: "2026-01-01 00:00:00.123456+00",
        enabled: true,
        missing: null,
        obj: { x: 1 },
      },
    ]);
    expect(result.columns.map(c => c.name)).toEqual(["n", "oversized", "c0", "enabled", "missing", "obj"]);
    expect(result.truncated).toBe(false);
    const empty = await pgReader.preview("SELECT id FROM retl_audience WHERE false");
    expect(empty.rows).toEqual([]);
    expect(empty.columns).toEqual([{ name: "id", type: "20" }]);
    expect(empty.truncated).toBe(false);
  });
});

describe("Models service", () => {
  const service = new ConfigObjectsService({ prisma: deps().prisma });
  async function fixture(config: Record<string, unknown> = pgConfig) {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
    const warehouse = await deps().prisma.configurationObject.create({
      data: {
        workspaceId: workspace.id,
        type: "destination",
        config: { ...config, type: "destination", name: "Warehouse" },
      },
    });
    return { user, workspace, warehouse, model: { ...definition, name: "Audience", warehouseId: warehouse.id } };
  }
  it("gates Models and denies foreign warehouse references", async () => {
    const disabled = await seedWorkspace();
    await expect(service.list(disabled.user, disabled.workspace.id, "model")).resolves.toEqual([]);
    const a = await fixture();
    const b = await fixture();
    await expect(
      service.create(a.user, a.workspace.id, "model", { ...a.model, warehouseId: b.warehouse.id }, { generateId: true })
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.list(b.user, a.workspace.id, "model")).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    ["Postgres bytea", pgConfig, "SELECT 1 AS pk, NULL::bytea AS removed WHERE false"],
    ["Postgres jsonb", pgConfig, "SELECT 1 AS pk, NULL::jsonb AS removed WHERE false"],
    ["Postgres array", pgConfig, "SELECT 1 AS pk, NULL::integer[] AS removed WHERE false"],
    ["Postgres timestamp", pgConfig, "SELECT 1 AS pk, now() AS removed WHERE false"],
    ["ClickHouse timestamp", chConfig, "SELECT 1 AS pk, now() AS removed WHERE false"],
    ...structuredKeyTypes.map(
      (type, index) =>
        ["ClickHouse " + type, chConfig, `SELECT 1 AS pk, id AS removed FROM retl_structured_keys_${index}`] as const
    ),
  ] as const)("rejects incompatible %s delete columns even without rows", async (_, config, query) => {
    const { user, workspace, warehouse, model } = await fixture(config);
    const input = { ...model, query, primaryKey: ["pk"], cursor: undefined };
    await expect(service.create(user, workspace.id, "model", input, { generateId: true })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Delete column 'removed'.*use a boolean expression/),
    });
    expect(await service.list(user, workspace.id, "model")).toEqual([]);
    const preview = await previewModel(deps().prisma, workspace.id, warehouse.id, query);
    expect(preview.columns.find(c => c.name === "removed")?.supportsDelete).toBe(false);
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    await expect(
      service.update(user, workspace.id, "model", id, { query, primaryKey: ["pk"], cursor: null })
    ).rejects.toMatchObject({ status: 400 });
    expect((await service.get(user, workspace.id, "model", id)).query).toBe(model.query);
  });
  it.each([
    [
      "Postgres boolean",
      pgConfig,
      pgReader,
      "SELECT id, id = 2 AS removed FROM generate_series(1, 2) AS id",
      [false, true],
    ],
    [
      "Postgres bigint",
      pgConfig,
      pgReader,
      "SELECT id, (id - 1)::bigint AS removed FROM generate_series(1, 2) AS id",
      [false, true],
    ],
    [
      "Postgres text",
      pgConfig,
      pgReader,
      "SELECT id, (id - 1)::text AS removed FROM generate_series(1, 2) AS id",
      [false, true],
    ],
    [
      "Postgres null",
      pgConfig,
      pgReader,
      "SELECT id, NULL::text AS removed FROM generate_series(1, 2) AS id",
      [false, false],
    ],
    ["ClickHouse boolean", chConfig, chReader, "SELECT id, flag = 1 AS removed FROM retl_delete_flags", [false, true]],
    [
      "ClickHouse Int64",
      chConfig,
      chReader,
      "SELECT id, toInt64(flag) AS removed FROM retl_delete_flags",
      [false, true],
    ],
    [
      "ClickHouse String",
      chConfig,
      chReader,
      "SELECT id, toString(flag) AS removed FROM retl_delete_flags",
      [false, true],
    ],
    [
      "ClickHouse FixedString",
      chConfig,
      chReader,
      "SELECT id, toFixedString(toString(flag), 1) AS removed FROM retl_delete_flags",
      [false, true],
    ],
    ["ClickHouse null", chConfig, chReader, "SELECT id, NULL AS removed FROM retl_delete_flags", [false, false]],
  ] as const)("preserves supported %s delete values", async (_, config, reader, query, expected) => {
    const { user, workspace, warehouse, model } = await fixture(config);
    const input = { ...model, query, cursor: undefined };
    await expect(service.create(user, workspace.id, "model", input, { generateId: true })).resolves.toHaveProperty(
      "id"
    );
    expect((await collect(reader.stream(input))).map(r => r.deleted)).toEqual(expected);
    const preview = await previewModel(deps().prisma, workspace.id, warehouse.id, query);
    expect(preview.columns.find(c => c.name === "removed")?.supportsDelete).toBe(true);
  });
  it.each([
    [pgConfig, pgReader, "SELECT 1 AS id, 2::bigint AS removed"],
    [pgConfig, pgReader, "SELECT 1 AS id, 'customer' AS removed"],
    [chConfig, chReader, "SELECT 1 AS id, 2 AS removed"],
    [chConfig, chReader, "SELECT 1 AS id, 'customer' AS removed"],
  ] as const)(
    "still fails immediately for invalid values in a compatible delete type: %j",
    async (config, reader, query) => {
      const { user, workspace, model } = await fixture(config);
      const input = { ...model, query, cursor: undefined };
      await service.create(user, workspace.id, "model", input, { generateId: true });
      await expect(collect(reader.stream(input))).rejects.toThrow(/Delete column must contain/);
    }
  );
  it.each([
    ["Postgres bytea", pgConfig, "SELECT NULL::bytea AS id, now() AS changed WHERE false"],
    ["Postgres json", pgConfig, "SELECT NULL::json AS id, now() AS changed WHERE false"],
    ["Postgres jsonb", pgConfig, "SELECT NULL::jsonb AS id, now() AS changed WHERE false"],
    ["Postgres array", pgConfig, "SELECT NULL::integer[] AS id, now() AS changed WHERE false"],
    ...structuredKeyTypes.map(
      (type, index) =>
        ["ClickHouse " + type, chConfig, `SELECT id, changed FROM retl_structured_keys_${index}`] as const
    ),
  ] as const)("rejects %s from metadata before saving, even with zero rows", async (_, config, query) => {
    const { user, workspace, model } = await fixture(config);
    for (const cursor of [undefined, definition.cursor, { ...definition.cursor!, lookbackSeconds: 60 }]) {
      await expect(
        service.create(
          user,
          workspace.id,
          "model",
          { ...model, query, cursor, deleteColumn: undefined },
          { generateId: true }
        )
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Primary-key column 'id'.*cast it to a supported scalar type/),
      });
    }
    expect(await service.list(user, workspace.id, "model")).toEqual([]);
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    await expect(
      service.update(user, workspace.id, "model", id, { query, deleteColumn: undefined })
    ).rejects.toMatchObject({ status: 400 });
    expect((await service.get(user, workspace.id, "model", id)).query).toBe(model.query);
  });
  it.each([
    ["Postgres boolean", pgConfig, pgReader, "SELECT true AS id, now() AS changed"],
    ["Postgres JSON cast to text", pgConfig, pgReader, "SELECT ('{\"key\":1}'::jsonb)::text AS id, now() AS changed"],
    ["ClickHouse boolean", chConfig, chReader, "SELECT true AS id, now() AS changed"],
    ["ClickHouse enum", chConfig, chReader, "SELECT CAST('a', 'Enum8(''a'' = 1)') AS id, now() AS changed"],
    ["ClickHouse IPv4", chConfig, chReader, "SELECT toIPv4('127.0.0.1') AS id, now() AS changed"],
    [
      "ClickHouse DateTime timezone",
      chConfig,
      chReader,
      "SELECT toDateTime('2026-01-01 00:00:00', 'Etc/GMT+3') AS id, now() AS changed",
    ],
    [
      "ClickHouse DateTime64 timezone",
      chConfig,
      chReader,
      "SELECT toDateTime64('2026-01-01 00:00:00.123456', 6, 'Etc/GMT+3') AS id, now() AS changed",
    ],
    ["ClickHouse array cast to String", chConfig, chReader, "SELECT toString(array('a', 'b')) AS id, now() AS changed"],
  ] as const)("saves and reads %s keys in full-query and lookback models", async (_, config, reader, query) => {
    const { user, workspace, model } = await fixture(config);
    for (const cursor of [undefined, { ...definition.cursor!, lookbackSeconds: 60 }]) {
      const input = { ...model, query, cursor, deleteColumn: undefined };
      await expect(service.create(user, workspace.id, "model", input, { generateId: true })).resolves.toHaveProperty(
        "id"
      );
      const rows = await collect(reader.stream(input));
      expect(rows).toHaveLength(1);
      expect(["boolean", "string", "number"]).toContain(typeof rows[0].row.id);
      if (cursor) expect(await collect(reader.stream(input, rows[0].checkpoint))).toHaveLength(1);
    }
  });
  it("allows authorized cleanup after disabling the flag, but still gates use and protects references", async () => {
    const { user, workspace, warehouse, model } = await fixture();
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: [] } });
    expect((await service.list(user, workspace.id, "model")).map(m => m.id)).toEqual([id]);
    await expect(service.get(user, workspace.id, "model", id)).resolves.toMatchObject({ id });
    await expect(service.create(user, workspace.id, "model", model, { generateId: true })).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.update(user, workspace.id, "model", id, { name: "Changed" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(previewModel(deps().prisma, workspace.id, warehouse.id, model.query)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.delete(user, workspace.id, "destination", warehouse.id, { cascade: true })
    ).rejects.toMatchObject({ status: 409 });
    const link = await deps().prisma.configurationObjectLink.create({
      data: { workspaceId: workspace.id, fromId: id, toId: warehouse.id, type: "reverse-sync", data: {} },
    });
    await expect(service.delete(user, workspace.id, "model", id, { cascade: true })).rejects.toMatchObject({
      status: 409,
    });
    await service.deleteLink(user, workspace.id, { id: link.id });
    await service.delete(user, workspace.id, "model", id);
    expect(await deps().prisma.auditLog.count({ where: { objectId: id, type: "config-object-delete" } })).toBe(1);
    await expect(service.delete(user, workspace.id, "destination", warehouse.id)).resolves.toMatchObject({
      id: warehouse.id,
    });
  });
  it("does not grant foreign-workspace or analyst deletion access during cleanup", async () => {
    const { user, workspace, model } = await fixture();
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    const foreign = await seedWorkspace();
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: [] } });
    await expect(service.list(foreign.user, workspace.id, "model")).rejects.toMatchObject({ status: 403 });
    await expect(service.get(foreign.user, workspace.id, "model", id)).rejects.toMatchObject({ status: 403 });
    await expect(service.delete(foreign.user, workspace.id, "model", id)).rejects.toMatchObject({ status: 403 });
    await deps().prisma.workspaceAccess.updateMany({
      where: { workspaceId: workspace.id, userId: user.internalId },
      data: { role: "analyst" },
    });
    await expect(service.get(user, workspace.id, "model", id)).resolves.toMatchObject({ id });
    await expect(service.delete(user, workspace.id, "model", id)).rejects.toMatchObject({ status: 403 });
  });
  it.each(keyTypes.map((type, index) => [type, index] as const))(
    "saves and resumes ClickHouse %s keys and cursors",
    async (_, index) => {
      const { user, workspace, model } = await fixture(chConfig);
      for (const cursor of [
        { column: "changed", type: "number" },
        { column: "id", type: "string" },
      ]) {
        const { id } = await service.create(
          user,
          workspace.id,
          "model",
          {
            ...model,
            query: `SELECT id, changed FROM retl_keys_${index}`,
            cursor,
            deleteColumn: undefined,
          },
          { generateId: true }
        );
        const saved = ModelDefinition.parse(await service.get(user, workspace.id, "model", id));
        const rows = await collect(chReader.stream(saved));
        expect(rows).toHaveLength(3);
        if (keyTypes[index].includes("FixedString"))
          expect(rows[0].checkpoint!.primaryKeyValues[0]).toBe("a" + "\0".repeat(15));
        expect(await collect(chReader.stream(saved, rows[0].checkpoint))).toEqual(rows.slice(1));
        expect(await collect(chReader.stream(saved, rows[2].checkpoint))).toEqual([]);
      }
    }
  );
  it("rejects unsupported ClickHouse checkpoint keys before saving", async () => {
    const { user, workspace, model } = await fixture(chConfig);
    await expect(
      service.create(
        user,
        workspace.id,
        "model",
        {
          ...model,
          query: "SELECT id, changed FROM retl_unsupported_keys",
          cursor: { column: "changed", type: "number" },
          deleteColumn: undefined,
        },
        { generateId: true }
      )
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Unsupported checkpoint type") });
    expect(await deps().prisma.configurationObject.count({ where: { workspaceId: workspace.id, type: "model" } })).toBe(
      0
    );
  });
  it.each(["toDateTime(changed, 'Etc/GMT+3')", "toTimeZone(changed, 'Etc/GMT+3')"])(
    "saves and resumes numeric-timezone cursor %s",
    async expression => {
      const { user, workspace, model } = await fixture(chConfig);
      const { id } = await service.create(
        user,
        workspace.id,
        "model",
        { ...model, query: `SELECT id, ${expression} AS changed, removed FROM retl_audience` },
        { generateId: true }
      );
      const saved = ModelDefinition.parse(await service.get(user, workspace.id, "model", id));
      const rows = await collect(chReader.stream(saved));
      expect(rows).toHaveLength(3);
      expect(await collect(chReader.stream(saved, rows[0].checkpoint))).toEqual(rows.slice(1));
      expect(await collect(chReader.stream(saved, rows[2].checkpoint))).toEqual([]);
      for (const lookbackSeconds of [0, 60]) {
        expect(
          await collect(
            chReader.stream({ ...saved, cursor: { ...saved.cursor!, lookbackSeconds } }, rows[0].checkpoint)
          )
        ).toEqual(rows);
      }
    }
  );
  it("saves with audit, checks projections, and protects referenced warehouses", async () => {
    const { user, workspace, warehouse, model } = await fixture();
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    expect(await deps().prisma.auditLog.count({ where: { workspaceId: workspace.id, objectId: id } })).toBe(1);
    await expect(
      service.delete(user, workspace.id, "destination", warehouse.id, { cascade: true })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.update(user, workspace.id, "model", id, { query: "SELECT id FROM retl_audience" })
    ).rejects.toThrow(/project/);
    await service.update(user, workspace.id, "model", id, { cursor: null, deleteColumn: null });
    expect(await service.get(user, workspace.id, "model", id)).not.toHaveProperty("cursor");
    await service.delete(user, workspace.id, "model", id);
    await expect(service.delete(user, workspace.id, "destination", warehouse.id)).resolves.toMatchObject({
      id: warehouse.id,
    });
  });
  it("does not expose warehouse exceptions from preview", async () => {
    const { workspace, warehouse } = await fixture();
    await expect(
      previewModel(deps().prisma, workspace.id, warehouse.id, "SELECT secret_customer_value FROM nonexistent")
    ).rejects.toThrow("Preview failed or exceeded its limit");
  });

  it.each(["create", "update"] as const)(
    "rejects %s when the flag is disabled during warehouse inspection",
    async operation => {
      const { user, workspace, model } = await fixture({ ...chConfig, hosts: ["flag-race.test.local"] });
      let disableDuringInspection = false;
      server.use(
        http.post("http://flag-race.test.local:8123", async () => {
          if (disableDuringInspection) {
            await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: [] } });
          }
          return HttpResponse.json({
            meta: [
              { name: "id", type: "UInt64" },
              { name: "changed", type: "DateTime64(6)" },
              { name: "removed", type: "UInt8" },
            ],
            data: [],
            rows: 0,
          });
        })
      );
      const existing =
        operation === "update"
          ? await service.create(user, workspace.id, "model", model, { generateId: true })
          : undefined;
      disableDuringInspection = true;
      const write = existing
        ? service.update(user, workspace.id, "model", existing.id, { name: "Changed" })
        : service.create(user, workspace.id, "model", model, { generateId: true });
      await expect(write).rejects.toMatchObject({
        status: 403,
        message: "Reverse ETL is not enabled for this workspace",
      });
      const saved = await service.list(user, workspace.id, "model");
      expect(saved.map(m => m.name)).toEqual(existing ? [model.name] : []);
      expect(
        await deps().prisma.auditLog.count({ where: { workspaceId: workspace.id, type: `config-object-${operation}` } })
      ).toBe(0);
    }
  );
  it("keeps the final rollout check stable against ordinary workspace updates until commit", async () => {
    const { workspace, warehouse } = await fixture();
    await modelMutation(deps().prisma, workspace.id, "model", async tx => {
      await recheckModelWarehouse(tx, workspace.id, warehouse.id, warehouse.config);
      // A separate transaction updating flags must wait for the reader's SHARE
      // lock even though it does not participate in modelMutation's advisory lock.
      await expect(
        deps().prisma.$transaction(async competing => {
          await competing.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
          await competing.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: [] } });
        })
      ).rejects.toThrow(/lock timeout/);
    });
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: [] } });
    await expect(
      modelMutation(deps().prisma, workspace.id, "model", tx =>
        recheckModelWarehouse(tx, workspace.id, warehouse.id, warehouse.config)
      )
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not leave a live model referencing a concurrently deleted warehouse", async () => {
    const { user, workspace, warehouse, model } = await fixture();
    await Promise.allSettled([
      service.create(user, workspace.id, "model", model, { generateId: true }),
      service.delete(user, workspace.id, "destination", warehouse.id),
    ]);
    const current = await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id: warehouse.id } });
    const models = await deps().prisma.configurationObject.count({
      where: { workspaceId: workspace.id, type: "model", deleted: false },
    });
    expect(current.deleted && models > 0).toBe(false);
  });

  it("denies analyst writes and incompatible changes to a model's warehouse", async () => {
    const { user, workspace, warehouse, model } = await fixture();
    const { id } = await service.create(user, workspace.id, "model", model, { generateId: true });
    await expect(
      service.update(user, workspace.id, "destination", warehouse.id, {
        ...chConfig,
        name: "Changed warehouse",
        type: "destination",
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.update(user, workspace.id, "destination", warehouse.id, {
        authenticationMethod: "google-psc",
      })
    ).rejects.toMatchObject({ status: 409 });
    await deps().prisma.workspaceAccess.updateMany({
      where: { workspaceId: workspace.id, userId: user.internalId },
      data: { role: "analyst" },
    });
    await expect(service.create(user, workspace.id, "model", model, { generateId: true })).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.update(user, workspace.id, "model", id, { name: "changed" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.delete(user, workspace.id, "model", id)).rejects.toMatchObject({ status: 403 });
  });
});
