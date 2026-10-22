import { afterEach, expect, it, vi } from "vitest";
import { ModelDefinition } from "./schema";
import { createPostgresReader } from "./postgres";
import { createClickHouseReader } from "./clickhouse";

const pg = vi.hoisted(() => ({ Client: vi.fn() }));
const ch = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("pg", async original => ({ ...(await original<typeof import("pg")>()), Client: pg.Client }));
vi.mock("@clickhouse/client", () => ch);
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
const model = ModelDefinition.parse({ warehouseId: "wh", query: "SELECT id FROM source", primaryKey: ["id"] });
const row = { id: "a", __jitsu_retl_key_count: "1" };
const config = { host: "test", database: "test" };
const chConfig = { protocol: "http", hosts: ["test"], password: "" };
const delayed = <T>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 35_000));

function pgFixture() {
  const cursor = { read: vi.fn().mockResolvedValue([]) };
  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    query: vi.fn((query: unknown) =>
      typeof query === "string" ? Promise.resolve({ fields: [{ name: "id", dataTypeID: 25 }], rows: [] }) : cursor
    ),
  };
  pg.Client.mockImplementation(function () {
    return client;
  });
  return { client, cursor };
}
it("Postgres allows initial execution beyond 30 seconds but retains short preview limits", async () => {
  vi.useFakeTimers();
  const { cursor } = pgFixture();
  cursor.read.mockImplementationOnce(() => delayed([{ ...row }]));
  const reader = createPostgresReader(config);
  const iterator = reader.stream(model)[Symbol.asyncIterator]();
  const result = iterator.next();
  await vi.advanceTimersByTimeAsync(35_000);
  expect((await result).value?.row.id).toBe("a");
  expect(pg.Client.mock.calls[0][0].statement_timeout).toBe(7_200_000);
  await iterator.return?.();
  await reader.columns("SELECT id FROM source");
  expect(pg.Client.mock.calls[1][0].statement_timeout).toBe(30_000);
  await reader.close();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["overall", "parent"])("Postgres cancels initial execution on %s deadline", async kind => {
  vi.useFakeTimers();
  const { client, cursor } = pgFixture();
  cursor.read.mockImplementation(() => new Promise(() => {}));
  const reader = createPostgresReader(config);
  const parent = new AbortController();
  const iterator = reader.stream(model, undefined, parent.signal)[Symbol.asyncIterator]();
  const rejected = expect(iterator.next()).rejects.toThrow(kind === "overall" ? "deadline exceeded" : "cancelled");
  await vi.advanceTimersByTimeAsync(kind === "overall" ? 7_200_000 : 1);
  if (kind === "parent") parent.abort(new Error("cancelled"));
  await rejected;
  expect(client.end).toHaveBeenCalled();
  await reader.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("Postgres still times out stalled fetches after the first page", async () => {
  vi.useFakeTimers();
  const { cursor, client } = pgFixture();
  cursor.read.mockResolvedValueOnce([{ ...row }]).mockImplementation(() => new Promise(() => {}));
  const reader = createPostgresReader(config);
  const iterator = reader.stream(model)[Symbol.asyncIterator]();
  await iterator.next();
  const rejected = expect(iterator.next()).rejects.toThrow("read timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(client.end).toHaveBeenCalled();
  await reader.close();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["headers", "first row"])("ClickHouse permits slow execution before %s", async stage => {
  vi.useFakeTimers();
  const started = vi.fn();
  const metadata = {
    query: vi.fn(async () => ({ json: async () => ({ meta: [{ name: "id", type: "String" }] }), close() {} })),
    close: vi.fn(async () => {}),
  };
  const result = {
    stream: () =>
      (async function* () {
        started();
        const chunk = [{ text: JSON.stringify(row) }];
        yield stage === "first row" ? await delayed(chunk) : chunk;
      })(),
  };
  const streaming = {
    query: vi.fn(async () => (stage === "headers" ? delayed(result) : result)),
    close: vi.fn(async () => {}),
  };
  ch.createClient.mockReturnValueOnce(metadata).mockReturnValueOnce(streaming);
  const reader = createClickHouseReader(chConfig);
  const iterator = reader.stream(model)[Symbol.asyncIterator]();
  const resultPromise = iterator.next();
  if (stage === "first row") await vi.waitFor(() => expect(started).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(35_000);
  expect((await resultPromise).value?.row.id).toBe("a");
  await iterator.return?.();
  await reader.close();
  expect(streaming.close).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
