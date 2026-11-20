import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-284: a connector spec can mark a field `airbyte_secret` inside the items of an array (the API key of a stream's
// file format in source-gcs and source-sftp-bulk, the app id and key of every entry of `applications` in source-onesignal;
// found by comparing the walker with every secret of the 1,224 specs in production on 20 Nov 2026). The walker did not
// follow `items`, so those values were returned in clear even with a usable spec.

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("../../lib/server/db", () => ({
  db: { prisma: () => ({ source_spec: { findUnique: mocks.findUnique } }) },
}));
vi.mock("../../lib/server/log", async importOriginal => ({
  ...(await importOriginal<any>()),
  getServerLog: () => new Proxy({}, { get: () => () => ({ withCause: () => ({ log: () => {} }), log: () => {} }) }),
}));

import { MASKED_SECRET } from "../../lib/schema/destinations";
import { getConfigObjectType } from "../../lib/schema/config-objects";
import { getServiceSecretPaths } from "../../lib/schema/secrets";

let counter = 0;
const freshPackage = () => `airbyte/source-items-${++counter}`;
const rowWith = (properties: any) => ({ specs: { connectionSpecification: { type: "object", properties } } });

// as in source-onesignal
const onesignal = {
  user_auth_key: { type: "string", airbyte_secret: true },
  applications: {
    type: "array",
    items: {
      type: "object",
      properties: {
        app_name: { type: "string" },
        app_id: { type: "string", airbyte_secret: true },
        app_api_key: { type: "string", airbyte_secret: true },
      },
    },
  },
};
// as in source-gcs: a choice inside a choice, inside the items of `streams`
const gcs = {
  bucket: { type: "string" },
  streams: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        format: {
          type: "object",
          oneOf: [
            { properties: { filetype: { const: "csv" } } },
            {
              properties: {
                filetype: { const: "unstructured" },
                processing: {
                  type: "object",
                  oneOf: [
                    { properties: { mode: { const: "local" } } },
                    { properties: { mode: { const: "api" }, api_key: { type: "string", airbyte_secret: true } } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  },
};

const service = (pkg: string, credentials: any) => ({
  id: "svc1",
  workspaceId: "ws1",
  type: "service",
  protocol: "airbyte",
  package: pkg,
  version: "1.0.0",
  credentials,
});
const apps = () => [
  { app_name: "web", app_id: "id-1", app_api_key: "key-1" },
  { app_name: "ios", app_id: "id-2", app_api_key: "key-2" },
];

const type = getConfigObjectType("service");
beforeEach(() => mocks.findUnique.mockReset());

describe("secrets inside the items of an array", () => {
  it("lists a secret of every stored entry, by index, next to the plain ones", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const paths = await getServiceSecretPaths(
      freshPackage(),
      "1.0.0",
      service("p", { user_auth_key: "uk", applications: apps() })
    );
    expect(paths).toContain("credentials.user_auth_key");
    const lists = paths.filter(Array.isArray).map(p => p.join("."));
    expect(lists.sort()).toEqual([
      "credentials.applications.0.app_api_key",
      "credentials.applications.0.app_id",
      "credentials.applications.1.app_api_key",
      "credentials.applications.1.app_id",
    ]);
  });

  it("lists nothing for an array that is not there, is empty, or is not a list", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    for (const applications of [undefined, [], "none", null, {}]) {
      const paths = await getServiceSecretPaths(
        freshPackage(),
        "1.0.0",
        service("p", { user_auth_key: "uk", applications })
      );
      expect(paths).toEqual(["credentials.user_auth_key"]);
    }
  });

  it("masks the secrets of every entry on output and leaves the rest of the entry visible", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const out = await type.outputFilter(service(freshPackage(), { user_auth_key: "uk", applications: apps() }) as any);
    expect(out.credentials).toEqual({
      user_auth_key: MASKED_SECRET,
      applications: [
        { app_name: "web", app_id: MASKED_SECRET, app_api_key: MASKED_SECRET },
        { app_name: "ios", app_id: MASKED_SECRET, app_api_key: MASKED_SECRET },
      ],
    });
  });

  it("masks a secret under a choice inside a choice inside the items", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(gcs));
    const credentials = {
      bucket: "b",
      streams: [
        { name: "a", format: { filetype: "csv" } },
        { name: "b", format: { filetype: "unstructured", processing: { mode: "api", api_key: "sk-real" } } },
      ],
    };
    const out = await type.outputFilter(service(freshPackage(), credentials) as any);
    expect(out.credentials.streams[1].format.processing.api_key).toBe(MASKED_SECRET);
    expect(out.credentials.streams[1].format.processing.mode).toBe("api");
    expect(out.credentials.streams[0]).toEqual(credentials.streams[0]);
    expect(JSON.stringify(out)).not.toContain("sk-real");
  });

  it("masks an array whose items are the secrets", async () => {
    mocks.findUnique.mockResolvedValue(
      rowWith({ tokens: { type: "array", items: { type: "string", airbyte_secret: true } } })
    );
    const out = await type.outputFilter(service(freshPackage(), { tokens: ["t1", "t2"] }) as any);
    expect(out.credentials.tokens).toEqual([MASKED_SECRET, MASKED_SECRET]);
  });

  it("does not follow `items` written as a list (a tuple), which no connector spec uses", async () => {
    mocks.findUnique.mockResolvedValue(
      rowWith({ pair: { type: "array", items: [{ type: "string", airbyte_secret: true }] } })
    );
    const out = await type.outputFilter(service(freshPackage(), { pair: ["a"] }) as any);
    expect(out.credentials.pair).toEqual(["a"]);
  });
});

describe("saving a service whose array entries hold secrets", () => {
  const original = () => service(freshPackage(), { user_auth_key: "uk", applications: apps() });
  const shown = async (o: any) => (await type.outputFilter(o)).credentials;

  it("keeps the stored entries when the list comes back masked, and takes the other changes", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const o = original();
    const credentials = await shown(o);
    const before = JSON.parse(JSON.stringify(o.credentials));
    const merged = await type.merge(o as any, { name: "renamed", credentials } as any);
    expect(merged.credentials).toEqual(before);
    expect(merged.name).toBe("renamed");
  });

  it("refuses an entry added to a masked list: the masks no longer say which stored entry they stand for", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const o = original();
    const credentials = await shown(o);
    credentials.applications.push({ app_name: "android", app_id: "id-3", app_api_key: "key-3" });
    await expect(type.merge(o as any, { credentials } as any)).rejects.toThrow(/credentials\.applications/);
  });

  it("refuses an entry deleted from a masked list", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const o = original();
    const credentials = await shown(o);
    credentials.applications.shift();
    await expect(type.merge(o as any, { credentials } as any)).rejects.toThrow(/credentials\.applications/);
  });

  it("refuses an edited visible field of a masked entry rather than silently keeping the old one", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const o = original();
    const credentials = await shown(o);
    credentials.applications[0].app_name = "web-renamed";
    await expect(type.merge(o as any, { credentials } as any)).rejects.toThrow(/credentials\.applications/);
  });

  it("takes a whole list typed again", async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    const o = original();
    const fresh = [{ app_name: "web", app_id: "new-id", app_api_key: "new-key" }];
    const merged = await type.merge(
      o as any,
      { credentials: { user_auth_key: MASKED_SECRET, applications: fresh } } as any
    );
    expect(merged.credentials.applications).toEqual(fresh);
    expect(merged.credentials.user_auth_key).toBe("uk");
  });
});
