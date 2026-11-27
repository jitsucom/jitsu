import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-280: what the API handler sends and logs when a config fails validation. The handler builds the body from the
// error's response object and logs the same object, so a config in it is both shown to the caller and written to the logs.

const mocks = vi.hoisted(() => ({ lines: [] as { level: string; msg: string }[] }));

vi.mock("../../lib/server/db", () => ({ db: {} }));
vi.mock("../../lib/server/clickhouse", () => ({ clickhouse: {} }));
// every logger call is recorded as { level, msg }
vi.mock("../../lib/server/log", async importOriginal => {
  const chain = (level: string) => {
    const link: any = {
      withCause: () => link,
      log: (msg: string) => {
        mocks.lines.push({ level, msg: String(msg) });
      },
    };
    return link;
  };
  return {
    ...(await importOriginal<any>()),
    getServerLog: () => new Proxy({}, { get: (_target, level) => () => chain(String(level)) }),
  };
});

import { nextJsApiHandler } from "../../lib/api";
import { parseObject } from "../../lib/schema/config-objects";

const SECRET = "stored-password-7f3a";
const HOST = "db.customer-only.example";

// the stored destination merged with a patch that puts a text value into the port, as `update` does before it parses
const merged = {
  id: "dst1",
  workspaceId: "ws1",
  type: "destination",
  name: "pg",
  destinationType: "postgres",
  database: "events",
  username: "jitsu",
  password: SECRET,
  host: HOST,
  port: "x",
};

async function put(handle: () => unknown) {
  const handler = nextJsApiHandler({ PUT: { auth: false, types: {}, handle: handle as any } });
  const res: any = { statusCode: undefined, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body: any) => {
    res.body = body;
    return res;
  };
  res.json = res.send;
  res.setHeader = () => res;
  await handler(
    { method: "PUT", url: "/api/ws1/config/destination/dst1", query: {}, headers: {}, body: undefined } as any,
    res
  );
  return res;
}

beforeEach(() => {
  mocks.lines.length = 0;
});

describe("the API handler, when an update fails validation", () => {
  it("answers 400, not 500", async () => {
    const res = await put(() => parseObject("destination", merged));
    expect(res.statusCode).toBe(400);
  });

  it("sends the validation issues and no value of the config", async () => {
    const res = await put(() => parseObject("destination", merged));
    const sent = JSON.stringify(res.body);
    expect(sent).not.toContain(SECRET);
    expect(sent).not.toContain(HOST);
    expect(res.body).not.toHaveProperty("object");
    expect(res.body.message).toMatch(/Failed to validate schema of destination/);
    expect(res.body.error.issues.map((i: any) => i.path.join("."))).toContain("port");
  });

  it("logs no value of the config", async () => {
    await put(() => parseObject("destination", merged));
    expect(mocks.lines.length).toBeGreaterThan(0);
    const logged = JSON.stringify(mocks.lines);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(HOST);
    expect(logged).toMatch(/Failed to validate schema of destination/);
  });
});
