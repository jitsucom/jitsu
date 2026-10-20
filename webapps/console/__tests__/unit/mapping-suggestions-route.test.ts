import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  enabled: vi.fn(),
  columns: vi.fn(),
  findFirst: vi.fn(),
  suggest: vi.fn(),
  spec: {} as any,
  handle: undefined as any,
}));
// Capture the handler without replacing the behavior being tested: access ordering and workspace scoping.
// Authentication/session parsing and the rate limiter have their own API-wrapper tests.
vi.mock("../../lib/api", () => ({
  verifyAccessWithRole: mocks.access,
  createRoute: () => ({
    POST: (spec: unknown) => {
      mocks.spec = spec;
      return {
        handler: (handle: unknown) => {
          mocks.handle = handle;
          return { toNextApiHandler: () => handle };
        },
      };
    },
  }),
}));
vi.mock("../../lib/server/db", () => ({
  db: { prisma: () => ({ configurationObject: { findFirst: mocks.findFirst } }) },
}));
vi.mock("../../lib/server/reverse-etl-models", () => ({
  assertModelsEnabled: mocks.enabled,
  modelColumns: mocks.columns,
}));
vi.mock("../../lib/server/jev-mapping", () => ({ suggestWithJev: mocks.suggest }));
import "../../pages/api/[workspaceId]/reverse-etl/suggest-mappings";

beforeEach(() => {
  for (const mock of [mocks.access, mocks.enabled, mocks.columns, mocks.findFirst, mocks.suggest]) mock.mockReset();
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  mocks.findFirst.mockResolvedValue({ config: { destinationType: "google-ads", secret: "private-token" } });
  mocks.columns.mockResolvedValue({ columns: [{ name: "email", type: "text" }] });
  mocks.suggest.mockResolvedValue({ columns: [], suggestions: [] });
});
function invoke() {
  const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), writableEnded: false });
  return {
    res,
    result: mocks.handle({
      user: { internalId: "user" },
      query: { workspaceId: "workspace" },
      res,
      body: {
        modelId: "model",
        destinationId: "destination",
        stream: "audience",
        mode: "upsert",
        mapping: {},
        streamOptions: {},
      },
    }),
  };
}
it("requires authentication, bounds request rate, scopes destination and model, and disables caching", async () => {
  expect(mocks.spec.auth).toBe(true);
  expect(mocks.spec.rateLimit).toMatchObject({ session: 5, bearer: 5, windowMs: 60_000 });
  const { res, result } = invoke();
  await result;
  expect(mocks.access).toHaveBeenCalledWith({ internalId: "user" }, "workspace", "editEntities");
  expect(mocks.findFirst).toHaveBeenCalledWith({
    where: { id: "destination", workspaceId: "workspace", type: "destination", deleted: false },
    select: { config: true },
  });
  expect(mocks.columns.mock.calls[0].slice(1, 3)).toEqual(["workspace", "model"]);
  expect(JSON.stringify(mocks.suggest.mock.calls)).not.toContain("private-token");
  expect(mocks.suggest.mock.calls[0][3].destination).toEqual({ id: "google-ads", displayName: "Google Ads" });
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(res.listenerCount("close")).toBe(0);
});
it.each(["access", "enabled", "columns"] as const)("does not call Jev when %s fails", async check => {
  mocks[check].mockRejectedValue(new Error("denied"));
  await expect(invoke().result).rejects.toThrow("denied");
  expect(mocks.suggest).not.toHaveBeenCalled();
  if (check === "access") expect(mocks.findFirst).not.toHaveBeenCalled();
});
it("does not inspect a model or call Jev for a missing/foreign destination", async () => {
  mocks.findFirst.mockResolvedValue(null);
  await expect(invoke().result).rejects.toThrow("Destination stream not found in this workspace");
  expect(mocks.columns).not.toHaveBeenCalled();
  expect(mocks.suggest).not.toHaveBeenCalled();
});
it("fails with setup guidance when the server key is absent", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  await expect(invoke().result).rejects.toThrow("TYPESAFE_API_KEY");
  expect(mocks.suggest).not.toHaveBeenCalled();
});
it("cancels column inspection on disconnect and removes the listener", async () => {
  mocks.columns.mockImplementation(async (_db, _workspace, _model, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  const { res, result } = invoke();
  const rejection = expect(result).rejects.toThrow("aborted");
  await vi.waitFor(() => expect(mocks.columns).toHaveBeenCalled());
  res.emit("close");
  await rejection;
  expect(mocks.suggest).not.toHaveBeenCalled();
  expect(res.listenerCount("close")).toBe(0);
});
