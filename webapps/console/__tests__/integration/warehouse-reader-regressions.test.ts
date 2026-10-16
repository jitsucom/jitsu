import { afterAll, expect, it } from "vitest";
import { createWarehouseReader, type SourceRecord } from "@jitsu/warehouse-query";
import { ModelDefinition } from "@jitsu/warehouse-query/src/schema";
import { getServerEnv } from "../../lib/server/serverEnv";

const env = getServerEnv();
const pgUrl = new URL(env.DATABASE_URL);
const chUrl = new URL(env.CLICKHOUSE_URL!);
const pg = createWarehouseReader({
  destinationType: "postgres",
  host: pgUrl.hostname,
  port: Number(pgUrl.port),
  database: pgUrl.pathname.slice(1),
  username: pgUrl.username,
  password: pgUrl.password,
  sslMode: "disable",
});
const ch = createWarehouseReader({
  destinationType: "clickhouse",
  protocol: "http",
  hosts: [chUrl.host],
  database: env.CLICKHOUSE_DATABASE,
  username: "default",
  password: "",
});
afterAll(async () => {
  await Promise.all([pg.close(), ch.close()]);
});
const model = (query: string, extra = {}) =>
  ModelDefinition.parse({ warehouseId: "test", query, primaryKey: ["id"], ...extra });
async function collect(source: AsyncIterable<SourceRecord>) {
  const result: SourceRecord[] = [];
  for await (const row of source) result.push(row);
  return result;
}

it.each([
  ["PostgreSQL", pg, "SELECT 1 AS id, 0.00::numeric AS removed UNION ALL SELECT 2, 1.00::numeric"],
  ["ClickHouse", ch, "SELECT 1 AS id, toDecimal64('0.00', 2) AS removed UNION ALL SELECT 2, toDecimal64('1.00', 2)"],
] as const)("%s handles decimal delete flags without rewriting payloads or checkpoints", async (_, reader, query) => {
  const m = model(query, { deleteColumn: "removed", cursor: { column: "removed", type: "number" } });
  const rows = await collect(reader.stream(m));
  expect(rows.map(row => row.deleted)).toEqual([false, true]);
  const preview = await reader.preview(query);
  expect(rows.map(row => row.row.removed)).toEqual(preview.rows.map(row => row.removed));
  expect(rows[1].checkpoint?.value).toBe(String(preview.rows[1].removed));
  expect(await collect(reader.stream(m, rows[0].checkpoint))).toEqual(rows.slice(1));
});
it.each([
  ["PostgreSQL", pg, "1.01::numeric"],
  ["PostgreSQL text", pg, "'1.00'::text"],
  ["ClickHouse", ch, "toDecimal64('1.01', 2)"],
  ["ClickHouse text", ch, "'1.00'"],
] as const)("%s rejects invalid or textual decimal delete flags", async (_, reader, expression) => {
  await expect(
    collect(reader.stream(model(`SELECT 1 AS id, ${expression} AS removed`, { deleteColumn: "removed" })))
  ).rejects.toThrow(/0\/1/);
});

it("PostgreSQL preserves numeric and timestamp array precision and SQL nulls", async () => {
  const query = `SELECT 1 AS id, ARRAY[12345678901234567890.123456789::numeric, NULL] AS numbers,
    ARRAY['2026-01-01 00:00:00.123456'::timestamp, NULL] AS times,
    ARRAY['2026-01-01'::date, NULL] AS dates`;
  const preview = await pg.preview(query);
  expect(preview.rows[0]).toEqual({
    id: 1,
    numbers: ["12345678901234567890.123456789", null],
    times: ["2026-01-01 00:00:00.123456", null],
    dates: ["2026-01-01", null],
  });
  expect((await collect(pg.stream(model(query))))[0].row).toEqual(preview.rows[0]);
});
it.each(["nan", "inf", "-inf"])("ClickHouse does not silently treat %s delete flags as SQL null", async value => {
  const query = `SELECT 1 AS id, toFloat64('${value}') AS removed`;
  expect((await ch.preview(query)).rows[0].removed).toBe(value);
  await expect(collect(ch.stream(model(query, { deleteColumn: "removed" })))).rejects.toThrow(/0\/1/);
  await expect(collect(ch.stream(model(query, { primaryKey: ["removed"] })))).rejects.toThrow(/finite values/);
  await expect(collect(ch.stream(model(query, { cursor: { column: "removed", type: "number" } })))).rejects.toThrow(
    /finite values/
  );
});
