import { beforeEach, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock("../../lib/server/log", () => {
  const chain: any = {
    withCause: () => chain,
    log: (message: string) => logged.lines.push(String(message)),
  };
  const logger = { atDebug: () => chain, atInfo: () => chain, atWarn: () => chain, atError: () => chain };
  return { getServerLog: () => logger };
});
vi.mock("../../lib/server/db", () => ({ db: { prisma: () => ({}) } }));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
import { createRoute } from "../../lib/api";

beforeEach(() => {
  logged.lines.length = 0;
});

function response() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string> };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.setHeader = (name: string, value: string) => ((res.headers[name] = value), res);
  res.json = (body: unknown) => ((res.body = body), res);
  res.send = (body: unknown) => ((res.body = body), res);
  res.end = () => res;
  return res;
}

// A failing request is logged with its URL. The query string can hold a credential
// (`__unsafe_token=keyId:secret`), so only the path may reach the log.
it("does not write the query string of a failed request to the log", async () => {
  const handler = createRoute()
    .GET({ auth: false })
    .handler(async () => {
      throw new Error("boom");
    })
    .toNextApiHandler();
  const req: any = {
    method: "GET",
    url: "/api/probe?__unsafe_token=keyid123:secretvalue456",
    headers: {},
    query: {},
    cookies: {},
  };
  await handler(req, response());
  const failure = logged.lines.filter(line => line.includes("/api/probe"));
  expect(failure.length).toBeGreaterThan(0);
  expect(logged.lines.join("\n")).not.toContain("secretvalue456");
  expect(logged.lines.join("\n")).not.toContain("__unsafe_token");
});
