import { afterAll, beforeAll, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { signFunctionsRequest } from "juava/src/functions-auth";
import { startTestFunctionsServer, writeTestConfigs, type TestFunctionsServer } from "./functions-server-helper";

let server: TestFunctionsServer | undefined;
let directory: string;
const priorKey = process.env.FUNCTIONS_SERVER_PRIVATE_KEY;

beforeAll(async () => {
  // This smoke test must never connect to developer-configured external stores.
  vi.stubEnv("MONGODB_URL", "");
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("FUNCTIONS_CLASS", "test");
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "functions-health-"));
  await writeTestConfigs(directory, {}, {});
  server = await startTestFunctionsServer(directory, 3497);
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  if (priorKey === undefined) delete process.env.FUNCTIONS_SERVER_PRIVATE_KEY;
  else process.env.FUNCTIONS_SERVER_PRIVATE_KEY = priorKey;
  vi.unstubAllEnvs();
});

it("keeps both public health aliases minimal and requires a signature for diagnostics", async () => {
  for (const route of ["/", "/health"]) {
    const response = await fetch(server!.baseUrl + route);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  }
  const url = server!.baseUrl + "/status";
  const unsigned = await fetch(url, { method: "POST" });
  expect(unsigned.status).toBe(401);
  expect(await unsigned.json()).toEqual({ error: "Unauthorized" });
  const signed = await fetch(url, {
    method: "POST",
    body: "",
    headers: signFunctionsRequest(process.env.FUNCTIONS_SERVER_PRIVATE_KEY, "test", url, ""),
  });
  expect(signed.status).toBe(200);
  expect(signed.headers.get("cache-control")).toBe("no-store");
  expect(await signed.json()).toMatchObject({ status: "ok", configDir: directory, connections: [], runtimes: [] });
});
