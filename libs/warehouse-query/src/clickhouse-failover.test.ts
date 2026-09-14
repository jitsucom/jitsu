import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createClickHouseReader } from "./clickhouse";
import { ModelDefinition } from "./schema";
import type { WarehouseReader } from "./types";

const cleanup: (() => Promise<void>)[] = [];
const query = "SELECT id, changed FROM audience";
const model = ModelDefinition.parse({
  warehouseId: "wh",
  query,
  primaryKey: ["id"],
  cursor: { column: "changed", type: "number" },
});
const row = { id: "1", changed: "10", __jitsu_retl_key_count: "1" };
const metadata = {
  meta: [
    { name: "id", type: "UInt64" },
    { name: "changed", type: "Int64" },
  ],
  data: [],
  rows: 0,
};

async function host(handle: (sql: string, response: ServerResponse) => void) {
  const requests: { sql: string; url: URL }[] = [];
  const server = createServer(async (request, response) => {
    try {
      let sql = "";
      for await (const chunk of request) sql += chunk.toString();
      requests.push({ sql, url: new URL(request.url!, "http://localhost") });
      handle(sql, response);
    } catch {
      response.destroy();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const close = async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  };
  cleanup.push(close);
  return { address: `127.0.0.1:${address.port}`, requests, close };
}

function healthy(sql: string, response: ServerResponse) {
  response.end(sql.includes("LIMIT 0") ? JSON.stringify(metadata) : JSON.stringify(row) + "\n");
}

function reader(hosts: string[]): WarehouseReader {
  const result = createClickHouseReader({ protocol: "http", hosts, password: "" });
  cleanup.push(() => result.close());
  return result;
}

async function collect(source: AsyncIterable<unknown>) {
  const rows: unknown[] = [];
  for await (const value of source) rows.push(value);
  return rows;
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("ClickHouse host failover with the real HTTP client", () => {
  it.each(["columns", "preview", "stream"] as const)(
    "%s uses a healthy later host when the first connection is refused",
    async operation => {
      const unavailable = await host(healthy);
      await unavailable.close();
      const available = await host(healthy);
      const input = reader([unavailable.address, available.address]);
      const result = operation === "stream" ? await collect(input.stream(model)) : await input[operation](query);
      expect(result).toBeTruthy();
      expect(available.requests.length).toBe(operation === "columns" ? 1 : 2);
      for (const request of available.requests) expect(request.url.searchParams.get("readonly")).toBe("1");
    }
  );

  it("validates secondary endpoints before sending any requests", async () => {
    const available = await host(healthy);
    expect(() => reader([available.address, "other.test?readonly=0"])).toThrow(/host\[:port\]/);
    expect(available.requests).toHaveLength(0);
  });

  it("reprobes the new host if the data request fails before the first row", async () => {
    const first = await host((sql, response) =>
      sql.includes("LIMIT 0") ? healthy(sql, response) : response.destroy()
    );
    const second = await host((sql, response) => {
      response.end(
        sql.includes("LIMIT 0")
          ? JSON.stringify({ ...metadata, meta: [{ name: "id", type: "String" }, metadata.meta[1]] })
          : JSON.stringify(row) + "\n"
      );
    });
    expect(
      await collect(reader([first.address, second.address]).stream(model, { value: "9", primaryKeyValues: ["0"] }))
    ).toHaveLength(1);
    expect(first.requests).toHaveLength(2);
    expect(second.requests).toHaveLength(2);
    expect(second.requests[0].sql).toContain("LIMIT 0");
    expect(second.requests[1].sql).toContain("{p1: String}");
  });

  it("discards a partial buffered preview before trying another host", async () => {
    const first = await host((sql, response) => {
      if (sql.includes("LIMIT 0")) return healthy(sql, response);
      response.write(JSON.stringify({ id: "old" }) + "\n");
      setImmediate(() => response.destroy());
    });
    const second = await host(healthy);
    const result = await reader([first.address, second.address]).preview(query);
    expect(result.rows).toEqual([row]);
    expect(second.requests).toHaveLength(2);
  });

  it("never switches hosts after emitting a stream row", async () => {
    let active: ServerResponse | undefined;
    const first = await host((sql, response) => {
      if (sql.includes("LIMIT 0")) return healthy(sql, response);
      active = response;
      response.write(JSON.stringify(row) + "\n");
    });
    const second = await host(healthy);
    const source = reader([first.address, second.address]).stream(model)[Symbol.asyncIterator]();
    expect((await source.next()).value).toMatchObject({ row: { id: "1" } });
    active!.destroy();
    await expect(source.next()).rejects.toThrow();
    expect(second.requests).toHaveLength(0);
  });

  it.each(["syntax", "auth", "invalid row", "malformed metadata", "preview limit"])(
    "does not retry %s failures",
    async failure => {
      const first = await host((sql, response) => {
        if (failure === "syntax") {
          response.statusCode = 400;
          return void response.end("Code: 62. DB::Exception: invalid query (SYNTAX_ERROR)");
        }
        if (failure === "auth") {
          response.statusCode = 401;
          return void response.end("Unauthorized");
        }
        if (failure === "malformed metadata") return void response.end("not json");
        if (sql.includes("LIMIT 0")) return healthy(sql, response);
        response.end(
          JSON.stringify(
            failure === "preview limit" ? { id: "x".repeat(2_000_001) } : { ...row, __jitsu_retl_key_count: "2" }
          ) + "\n"
        );
      });
      const second = await host(healthy);
      const input = reader([first.address, second.address]);
      await expect(failure === "preview limit" ? input.preview(query) : collect(input.stream(model))).rejects.toThrow();
      expect(second.requests).toHaveLength(0);
    }
  );

  it.each(["cancel", "close"])("%s interrupts a pending probe without trying another host", async action => {
    let started!: () => void;
    const pending = new Promise<void>(resolve => {
      started = resolve;
    });
    const first = await host(() => started());
    const second = await host(healthy);
    const input = reader([first.address, second.address]);
    const abort = new AbortController();
    const result = expect(input.columns(query, abort.signal)).rejects.toThrow();
    await pending;
    if (action === "cancel") abort.abort();
    else await input.close();
    await result;
    expect(second.requests).toHaveLength(0);
  });

  it.each([false, true])(
    "times out a hung metadata host, including after headers (%s)",
    async headers => {
      let started!: () => void;
      const pending = new Promise<void>(resolve => {
        started = resolve;
      });
      const first = await host((_, response) => {
        if (headers) response.flushHeaders();
        started();
      });
      const second = await host(healthy);
      const result = reader([first.address, second.address]).columns(query, AbortSignal.timeout(8_000));
      await pending;
      expect(await result).toEqual(metadata.meta);
      expect(second.requests).toHaveLength(1);
    },
    10_000
  );

  it.each(["cancel", "close"])("%s interrupts a stalled stream body after a delivered row", async action => {
    const first = await host((sql, response) => {
      if (sql.includes("LIMIT 0")) return healthy(sql, response);
      response.write(JSON.stringify(row) + "\n");
    });
    const second = await host(healthy);
    const input = reader([first.address, second.address]);
    const abort = new AbortController();
    const source = input.stream(model, undefined, abort.signal)[Symbol.asyncIterator]();
    expect((await source.next()).value).toMatchObject({ row: { id: "1" } });
    const pending = expect(source.next()).rejects.toThrow();
    if (action === "cancel") abort.abort();
    else await input.close();
    await pending;
    expect(second.requests).toHaveLength(0);
  });

  it("tries each unique endpoint once and rejects when all fail", async () => {
    const first = await host((_, response) => response.destroy());
    const second = await host((_, response) => response.destroy());
    await expect(reader([first.address, first.address, second.address]).columns(query)).rejects.toThrow();
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
  });
});
