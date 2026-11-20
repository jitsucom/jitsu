import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-284: the editor checks credentials that hold a mask as a copy, so the spec's defaults are added on the server,
// after the masks are replaced by the stored values.

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  lines: [] as { level: string; msg: string }[],
}));

vi.mock("../../lib/server/db", () => ({
  db: { prisma: () => ({ source_spec: { findUnique: mocks.findUnique } }) },
}));
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

import { MASKED_SECRET } from "../../lib/schema/destinations";
import { getConfigObjectType } from "../../lib/schema/config-objects";
import { applyServiceSpecDefaults, withServiceSpecDefaults } from "../../lib/schema/service-defaults";

let counter = 0;
const freshPackage = () => `airbyte/source-defaults-${++counter}`;

const spec = {
  type: "object",
  required: ["host", "password", "ssl"],
  properties: {
    host: { type: "string" },
    password: { type: "string", airbyte_secret: true },
    ssl: { type: "boolean", default: false },
    port: { type: "integer", default: 0 },
  },
};
const conditionalSpec = {
  type: "object",
  properties: {
    mode: { enum: ["automatic", "manual"] },
    password: { type: "string", airbyte_secret: true },
  },
  if: { properties: { mode: { const: "manual" } }, required: ["mode"] },
  then: { properties: { timeout: { type: "integer", default: 30 } } },
  else: { properties: { retries: { type: "integer", default: 5 } } },
};

const rowWith = (connectionSpecification: any) => ({ specs: { connectionSpecification } });
const service = (packageName: string, credentials: any) => ({
  id: "svc1",
  type: "service",
  workspaceId: "ws1",
  name: "A service",
  package: packageName,
  version: "1.0.0",
  credentials,
});

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.lines.length = 0;
});

describe("withServiceSpecDefaults", () => {
  it("adds the falsy defaults the editor could not add, and keeps what is there", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const input = service(freshPackage(), { host: "h", password: "real" });
    const result = await withServiceSpecDefaults(input);
    expect(result.credentials).toEqual({ host: "h", password: "real", ssl: false, port: 0 });
    expect(input.credentials).toEqual({ host: "h", password: "real" });
  });

  it("does not overwrite a value that is set", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const result = await withServiceSpecDefaults(
      service(freshPackage(), { host: "h", password: "p", ssl: true, port: 5 })
    );
    expect(result.credentials).toEqual({ host: "h", password: "p", ssl: true, port: 5 });
  });

  it("takes the branch of the stored value: the defaults of the wrong branch are not added", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(conditionalSpec));
    const pkg = freshPackage();
    expect((await withServiceSpecDefaults(service(pkg, { mode: "automatic", password: "p" }))).credentials).toEqual({
      mode: "automatic",
      password: "p",
      retries: 5,
    });
    expect((await withServiceSpecDefaults(service(pkg, { mode: "manual", password: "p" }))).credentials).toEqual({
      mode: "manual",
      password: "p",
      timeout: 30,
    });
  });

  it("returns the service as it is when there is no spec row, an empty one or a malformed one", async () => {
    const pkg = freshPackage();
    const input = service(pkg, { host: "h" });
    for (const row of [null, { specs: null }, { specs: {} }, rowWith({ oneOf: [] }), rowWith({ properties: [] })]) {
      mocks.findUnique.mockResolvedValue(row);
      expect(await withServiceSpecDefaults(input)).toBe(input);
    }
  });

  it("returns the service as it is, and says why without any value, when the spec cannot be compiled", async () => {
    mocks.findUnique.mockResolvedValue(rowWith({ type: "object", properties: { a: { type: "not-a-type" } } }));
    const input = service(freshPackage(), { a: "secret-value-1" });
    expect(await withServiceSpecDefaults(input)).toBe(input);
    expect(mocks.lines).toHaveLength(1);
    expect(mocks.lines[0].level).toBe("atWarn");
    expect(mocks.lines[0].msg).not.toContain("secret-value-1");
  });

  it("returns the service as it is when the lookup fails", async () => {
    mocks.findUnique.mockRejectedValue(new Error("database is down"));
    const input = service(freshPackage(), { host: "h" });
    expect(await withServiceSpecDefaults(input)).toBe(input);
  });

  it("leaves credentials that are not an object, and a service with no package, alone", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const odd = service(freshPackage(), "not-an-object");
    expect(await withServiceSpecDefaults(odd)).toBe(odd);
    const noPackage: any = { ...service("x", { host: "h" }), package: undefined };
    expect(await withServiceSpecDefaults(noPackage)).toBe(noPackage);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("does not reject a value that does not fit the spec: the connector reports it", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const result = await withServiceSpecDefaults(service(freshPackage(), { host: "h", password: "p", port: "abc" }));
    expect(result.credentials).toEqual({ host: "h", password: "p", port: "abc", ssl: false });
  });

  it("follows a spec that was refreshed, instead of a validator compiled for the old one", async () => {
    const pkg = freshPackage();
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    expect((await withServiceSpecDefaults(service(pkg, { host: "h", password: "p" }))).credentials).toMatchObject({
      ssl: false,
    });
    const refreshed = { ...spec, properties: { ...spec.properties, ssl: { type: "boolean", default: true } } };
    mocks.findUnique.mockResolvedValue(rowWith(refreshed));
    expect((await withServiceSpecDefaults(service(pkg, { host: "h", password: "p" }))).credentials).toMatchObject({
      ssl: true,
    });
  });

  it("applyServiceSpecDefaults touches a service only", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const destination: any = { type: "destination", credentials: { host: "h" } };
    expect(await applyServiceSpecDefaults("destination", destination)).toBe(destination);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    const svc = service(freshPackage(), { host: "h", password: "p" });
    expect((await applyServiceSpecDefaults("service", svc)).credentials).toMatchObject({ ssl: false });
  });
});

describe("the service config type adds the defaults after it restores masks (merge)", () => {
  const merge = (original: any, patch: any) => getConfigObjectType("service").merge!(original, patch);

  it("adds a falsy default to credentials whose password the editor sent back masked", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const original = service(freshPackage(), { host: "h", password: "real" });
    const merged = await merge(original, { name: "Renamed", credentials: { host: "h", password: MASKED_SECRET } });
    expect(merged.name).toBe("Renamed");
    expect(merged.credentials).toEqual({ host: "h", password: "real", ssl: false, port: 0 });
  });

  it("takes the conditional branch from the stored mode, not from the mask the editor saw", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(conditionalSpec));
    const original = service(freshPackage(), { mode: "automatic", password: "real" });
    const merged = await merge(original, { credentials: { mode: MASKED_SECRET, password: MASKED_SECRET } });
    expect(merged.credentials).toEqual({ mode: "automatic", password: "real", retries: 5 });
  });

  it("adds nothing when the patch holds no mask: the editor already did", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(spec));
    const original = service(freshPackage(), { host: "h", password: "real" });
    const merged = await merge(original, { name: "Renamed" });
    expect(merged.credentials).toEqual({ host: "h", password: "real" });
  });

  it("is unchanged when there is no usable spec: the fallback masks keep every stored value", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const original = service(freshPackage(), { host: "h", password: "real" });
    const merged = await merge(original, { credentials: { host: MASKED_SECRET, password: MASKED_SECRET } });
    expect(merged.credentials).toEqual({ host: "h", password: "real" });
  });
});
