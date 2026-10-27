import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startTestFunctionsServer, type TestFunctionsServer } from "./functions-server-helper";

// JITSU-261: the real Deno functions-server, started with a token configured, over real HTTP.

const TOKEN = "e2e-test-token-123";
let server: TestFunctionsServer;
let configDir: string;

beforeAll(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-auth-"));
  process.env.FUNCTIONS_SERVER_RAW_AUTH_TOKENS = `${TOKEN},second-token-456`;
  server = await startTestFunctionsServer(configDir, 3471);
}, 90_000);

afterAll(async () => {
  await server?.close();
  delete process.env.FUNCTIONS_SERVER_RAW_AUTH_TOKENS;
  fs.rmSync(configDir, { recursive: true, force: true });
});

const post = (pathname: string, headers: Record<string, string> = {}) =>
  fetch(server.baseUrl + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      workspaceId: "someone-elses-workspace",
      functionId: "f",
      code: "export default () => 1",
      event: {},
    }),
  });

describe("functions-server bearer authentication (real Deno server)", () => {
  test("the health check stays open", async () => {
    expect((await fetch(server.baseUrl + "/health")).status).toBe(200);
  });

  test.each(["/udfrun", "/profileudfrun", "/multi?ids=x", "/connection/x"])("%s needs a token", async route => {
    const res = await post(route);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("a wrong or malformed token is refused", async () => {
    for (const headers of [
      { Authorization: "Bearer nope" },
      { Authorization: `Bearer ${TOKEN}x` },
      { Authorization: TOKEN },
      { Authorization: `Basic ${TOKEN}` },
    ]) {
      expect((await post("/udfrun", headers)).status).toBe(401);
    }
  });

  test("a valid token gets past authentication (either configured token)", async () => {
    for (const token of [TOKEN, "second-token-456"]) {
      const res = await post("/udfrun", { Authorization: `Bearer ${token}` });
      expect(res.status).not.toBe(401);
    }
  });
});
