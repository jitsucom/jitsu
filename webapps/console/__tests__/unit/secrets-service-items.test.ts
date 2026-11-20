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
import { changedConnectionTargets, getServiceSecretPaths, unmaskSecretsFromOriginal } from "../../lib/schema/secrets";
import { serviceUnmaskOptions } from "../../lib/schema/service-defaults";

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

describe("test connection and clone of a service whose array entries hold secrets", () => {
  const stored = () => service("airbyte/source-items-unmask", { user_auth_key: "uk", applications: apps() });
  const shown = async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    return (await type.outputFilter(stored() as any)).credentials;
  };
  const submit = (credentials: any) => ({ ...stored(), credentials });
  const usable = async () => {
    mocks.findUnique.mockResolvedValue(rowWith(onesignal));
    return serviceUnmaskOptions("service", stored());
  };

  it("restores an unchanged list when the spec is usable: the plain values of an entry are public", async () => {
    const credentials = await shown();
    const out = unmaskSecretsFromOriginal(submit(credentials), stored(), stored(), await usable());
    expect(out.credentials).toEqual(stored().credentials);
  });

  it("still refuses such a list when the plain values may be secrets (no option: no usable spec)", async () => {
    const credentials = await shown();
    expect(() => unmaskSecretsFromOriginal(submit(credentials), stored(), stored())).toThrow(
      /credentials\.applications/
    );
  });

  it("refuses an edited visible value, a deleted entry and an added one, option or not", async () => {
    const options = await usable();
    for (const edit of [
      (c: any) => (c.applications[0].app_name = "renamed"),
      (c: any) => c.applications.shift(),
      (c: any) => c.applications.push({ app_name: "new", app_id: MASKED_SECRET, app_api_key: MASKED_SECRET }),
    ]) {
      const credentials = await shown();
      edit(credentials);
      expect(() => unmaskSecretsFromOriginal(submit(credentials), stored(), stored(), options)).toThrow(
        /credentials\.applications/
      );
    }
  });

  it("does not take an unchanged half-masked list of targets for a change when the spec is usable", () => {
    // the spec marks the password a secret and nothing else: the second host is public
    const publicHosts = { isSecretAt: (keys: string[]) => keys.join(".") === "credentials.password" };
    const hosts = { ...stored(), credentials: { hosts: ["a.example:1", "b.example:1"], password: "pw" } };
    const submitted = { ...hosts, credentials: { hosts: [MASKED_SECRET, "b.example:1"], password: MASKED_SECRET } };
    expect(changedConnectionTargets(submitted, hosts, publicHosts)).toEqual([]);
    expect(changedConnectionTargets(submitted, hosts)).toEqual(["credentials.hosts"]);
    const typed = { ...hosts, credentials: { hosts: [MASKED_SECRET, "c.example:1"], password: MASKED_SECRET } };
    expect(changedConnectionTargets(typed, hosts, publicHosts)).toEqual(["credentials.hosts"]);
  });

  it("does not compare a plain value at a position the spec marks secret, so a guess cannot be confirmed", async () => {
    const options = await usable();
    const outcome = (field: "app_id" | "app_api_key", guess: string) => {
      const credentials = JSON.parse(JSON.stringify(stored().credentials));
      for (const app of credentials.applications) {
        app.app_id = MASKED_SECRET;
        app.app_api_key = MASKED_SECRET;
      }
      credentials.user_auth_key = MASKED_SECRET;
      credentials.applications[0][field] = guess;
      try {
        return unmaskSecretsFromOriginal(submit(credentials), stored(), stored(), options);
      } catch (e: any) {
        return e.message;
      }
    };
    for (const [field, right, wrong] of [
      ["app_id", "id-1", "nope"],
      ["app_api_key", "key-1", "nope"],
    ] as const) {
      const hit = outcome(field, right);
      expect(typeof hit).toBe("string");
      expect(hit).toMatch(/credentials\.applications/);
      expect(hit).toEqual(outcome(field, wrong));
    }
  });

  it("does not compare values inside a field the spec marks secret as a whole (an object or a list)", async () => {
    // the secret is the whole `key_file` object: a response masks it as one value, and what is inside is as secret
    const withObject = {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            key_file: { type: "object", airbyte_secret: true, properties: { private_key: { type: "string" } } },
            tags: { type: "array", airbyte_secret: true, items: { type: "string" } },
          },
        },
      },
    };
    mocks.findUnique.mockResolvedValue(rowWith(withObject));
    const original = service("airbyte/source-items-container", {
      rows: [{ name: "a", key_file: { private_key: "real-key" }, tags: ["t1", "t2"] }],
    });
    const options = await serviceUnmaskOptions("service", original);
    const outcome = (field: "key_file" | "tags", guess: any) => {
      const credentials = JSON.parse(JSON.stringify(original.credentials));
      credentials.rows[0].key_file = MASKED_SECRET;
      credentials.rows[0].tags = MASKED_SECRET;
      credentials.rows[0][field] = guess;
      try {
        return unmaskSecretsFromOriginal({ ...original, credentials }, original, original, options);
      } catch (e: any) {
        return e.message;
      }
    };
    for (const [field, right, wrong] of [
      ["key_file", { private_key: "real-key" }, { private_key: "nope" }],
      ["tags", ["t1", "t2"], ["x", "y"]],
    ] as const) {
      const hit = outcome(field, right);
      expect(typeof hit).toBe("string");
      expect(hit).toMatch(/credentials\.rows/);
      expect(hit).toEqual(outcome(field, wrong));
    }
  });

  it("restores a list of masks for a field the spec marks secret as a whole, as a missing spec had masked it", async () => {
    // read during an outage: every entry is a mask. The spec is back and marks the whole `tags` list secret.
    mocks.findUnique.mockResolvedValue(
      rowWith({ name: { type: "string" }, tags: { type: "array", airbyte_secret: true, items: { type: "string" } } })
    );
    const original = service("airbyte/source-items-whole-secret", { name: "n", tags: ["t1", "t2"] });
    const options = await serviceUnmaskOptions("service", original);
    const submit = (tags: any) => ({ ...original, credentials: { name: "n", tags } });
    expect(
      unmaskSecretsFromOriginal(submit([MASKED_SECRET, MASKED_SECRET]), original, original, options).credentials.tags
    ).toEqual(["t1", "t2"]);
    // a plain value in it is never compared
    expect(() => unmaskSecretsFromOriginal(submit([MASKED_SECRET, "t2"]), original, original, options)).toThrow(
      /credentials\.tags/
    );
    // an empty list has no mask to restore: it is what the user typed
    expect(unmaskSecretsFromOriginal(submit([]), original, original, options).credentials.tags).toEqual([]);
  });

  it("does not tell the structure of a secret container: a list of masks of any length restores the whole value", async () => {
    mocks.findUnique.mockResolvedValue(
      rowWith({ name: { type: "string" }, tags: { type: "array", airbyte_secret: true, items: { type: "string" } } })
    );
    const original = service("airbyte/source-items-structure", { name: "n", tags: ["t1", "t2"] });
    const options = await serviceUnmaskOptions("service", original);
    const outcome = (tags: any) =>
      unmaskSecretsFromOriginal({ ...original, credentials: { name: "n", tags } }, original, original, options)
        .credentials;
    const same = [
      outcome(MASKED_SECRET),
      outcome([MASKED_SECRET]),
      outcome([MASKED_SECRET, MASKED_SECRET]),
      outcome(Array(5).fill(MASKED_SECRET)),
    ];
    for (const credentials of same) {
      expect(credentials).toEqual({ name: "n", tags: ["t1", "t2"] });
    }
  });

  it("does not compare it in a list of targets either", () => {
    const secretHosts = { isSecretAt: (keys: string[]) => keys[1] === "hosts" || keys[1] === "password" };
    const hosts = { ...stored(), credentials: { hosts: ["a.example:1", "b.example:1"], password: "pw" } };
    const outcome = (second: string) =>
      changedConnectionTargets(
        { ...hosts, credentials: { hosts: [MASKED_SECRET, second], password: MASKED_SECRET } },
        hosts,
        secretHosts
      );
    expect(outcome("b.example:1")).toEqual(["credentials.hosts"]);
    expect(outcome("b.example:1")).toEqual(outcome("c.example:1"));
  });

  describe("serviceUnmaskOptions", () => {
    it("says which positions of a stored service its usable spec marks secret", async () => {
      mocks.findUnique.mockResolvedValue(rowWith(onesignal));
      const { isSecretAt } = await serviceUnmaskOptions("service", stored());
      expect(isSecretAt).toBeTypeOf("function");
      expect(isSecretAt!(["credentials", "user_auth_key"])).toBe(true);
      expect(isSecretAt!(["credentials", "applications", "1", "app_api_key"])).toBe(true);
      expect(isSecretAt!(["credentials", "applications", "1", "app_id"])).toBe(true);
      expect(isSecretAt!(["credentials", "applications", "1", "app_name"])).toBe(false);
      expect(isSecretAt!(["credentials", "applications", "5", "app_api_key"])).toBe(false);
    });

    it("is off with no spec, an unusable one or a failing lookup, and for any other type", async () => {
      for (const arrange of [
        () => mocks.findUnique.mockResolvedValue(null),
        () => mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: {} } }),
        () => mocks.findUnique.mockRejectedValue(new Error("db down")),
      ]) {
        arrange();
        expect((await serviceUnmaskOptions("service", stored())).isSecretAt).toBeUndefined();
      }
      mocks.findUnique.mockResolvedValue(rowWith(onesignal));
      expect(await serviceUnmaskOptions("destination", stored())).toEqual({});
      expect(await serviceUnmaskOptions("service", { credentials: {} })).toEqual({});
    });
  });
});
