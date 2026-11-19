import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-284: a service whose connector spec is missing or unusable must not have its credentials read unmasked,
// stored as a mask, or sent to another target while the stored secrets are kept.

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  lines: [] as { level: string; msg: string }[],
}));

vi.mock("../../lib/server/db", () => ({
  db: { prisma: () => ({ source_spec: { findUnique: mocks.findUnique } }) },
}));
// Every logger call is recorded as { level, msg }, so a test can say what was logged and what was not
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
import { getServiceSecretPaths, unmaskSecretsFromOriginal } from "../../lib/schema/secrets";

let counter = 0;
/** A package name nobody used before in this file: the fallback warning is deduplicated per package@version */
const freshPackage = () => `airbyte/source-no-spec-${++counter}`;

/** Spec paths are dotted strings, fallback paths are lists of keys: compare both as lists, sorted */
const segments = (paths: (string | string[])[]) =>
  paths
    .map(p => (Array.isArray(p) ? p : p.split(".")))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

const specWith = (properties: any) => ({ specs: { connectionSpecification: { properties } } });
const USABLE_WITH_SECRET = specWith({
  host: { type: "string" },
  password: { type: "string", airbyte_secret: true },
});
const USABLE_NO_SECRET = specWith({ host: { type: "string" }, start_date: { type: "string" } });

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.lines.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getServiceSecretPaths", () => {
  const source = { credentials: { host: "db.customer.com", password: "s3cr3t-value" } };
  const LEAVES = [
    ["credentials", "host"],
    ["credentials", "password"],
  ];

  const unusable: [string, () => void][] = [
    ["no spec row", () => mocks.findUnique.mockResolvedValue(null)],
    ["null specs", () => mocks.findUnique.mockResolvedValue({ specs: null })],
    ["specs that is a string", () => mocks.findUnique.mockResolvedValue({ specs: "pending" })],
    ["specs without connectionSpecification", () => mocks.findUnique.mockResolvedValue({ specs: {} })],
    [
      "connectionSpecification without properties",
      () => mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: {} } }),
    ],
    [
      "properties that is not an object",
      () => mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: { properties: "x" } } }),
    ],
    ["a failing lookup", () => mocks.findUnique.mockRejectedValue(new Error("db down"))],
  ];

  it.each(unusable)("treats every credential value as secret: %s", async (_name, arrange) => {
    arrange();
    expect(segments(await getServiceSecretPaths(freshPackage(), "1.0.0", source))).toEqual(LEAVES);
  });

  it("keeps the spec's own paths when the spec is usable", async () => {
    mocks.findUnique.mockResolvedValue(USABLE_WITH_SECRET);
    expect(await getServiceSecretPaths(freshPackage(), "1.0.0", source)).toEqual(["credentials.password"]);
  });

  it("returns [] for a usable spec that lists no secret field, and does not warn", async () => {
    mocks.findUnique.mockResolvedValue(USABLE_NO_SECRET);
    expect(await getServiceSecretPaths(freshPackage(), "1.0.0", source)).toEqual([]);
    expect(mocks.lines).toEqual([]);
  });

  describe("fallback paths", () => {
    beforeEach(() => mocks.findUnique.mockResolvedValue(null));
    const paths = async (...sources: any[]) =>
      segments(await getServiceSecretPaths(freshPackage(), "1.0.0", ...sources));

    it("goes down to the leaf of nested objects and of arrays, by key and by index", async () => {
      expect(
        await paths({
          credentials: { token: "t", auth: { user: "u", password: "p" }, list: [{ k: "v" }, "plain"] },
        })
      ).toEqual([
        ["credentials", "auth", "password"],
        ["credentials", "auth", "user"],
        ["credentials", "list", "0", "k"],
        ["credentials", "list", "1"],
        ["credentials", "token"],
      ]);
    });

    it("counts a null leaf, because masking skips only a value that is not there", async () => {
      expect(await paths({ credentials: { token: null } })).toEqual([["credentials", "token"]]);
    });

    it("names a key with a dot or a bracket as one key, never as several", async () => {
      expect(await paths({ credentials: { "a.b": "x", "c[0]": "y", "d]": "z" } })).toEqual([
        ["credentials", "a.b"],
        ["credentials", "c[0]"],
        ["credentials", "d]"],
      ]);
      expect(await paths({ credentials: { nested: { "a.b": "x" } } })).toEqual([["credentials", "nested", "a.b"]]);
    });

    it("names keys that point at the prototype like any other key", async () => {
      const credentials = JSON.parse('{"__proto__": {"x": 1}, "constructor": "c", "ok": "v"}');
      expect(await paths({ credentials })).toEqual([
        ["credentials", "__proto__", "x"],
        ["credentials", "constructor"],
        ["credentials", "ok"],
      ]);
    });

    it("masks credentials as a whole when it is not an object", async () => {
      expect(await paths({ credentials: "a-string" })).toEqual([["credentials"]]);
    });

    it("has nothing to mask when credentials are absent, null or empty", async () => {
      expect(await paths({})).toEqual([]);
      expect(await paths({ credentials: null })).toEqual([]);
      expect(await paths({ credentials: {} })).toEqual([]);
      expect(await paths({ credentials: { empty: {} } })).toEqual([]);
      expect(await paths(undefined, null)).toEqual([]);
    });

    it("covers a field that is only in the second source, once", async () => {
      expect(
        await paths({ credentials: { host: "h", password: "p" } }, { credentials: { password: "q", extra: "e" } })
      ).toEqual([
        ["credentials", "extra"],
        ["credentials", "host"],
        ["credentials", "password"],
      ]);
    });
  });

  describe("warning", () => {
    const FALLBACK = /no usable connector spec.*masking every credential/i;
    const warnings = () => mocks.lines.filter(l => l.level === "atWarn" && FALLBACK.test(l.msg));

    it.each([
      ["missing", () => mocks.findUnique.mockResolvedValue(null)],
      ["empty", () => mocks.findUnique.mockResolvedValue({ specs: null })],
      ["malformed", () => mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: {} } })],
      ["error", () => mocks.findUnique.mockRejectedValue(new Error("db down"))],
    ])("names the package, the version and the reason (%s), and never a credential value", async (reason, arrange) => {
      arrange();
      const pkg = freshPackage();
      await getServiceSecretPaths(pkg, "2.3.4", source);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].msg).toContain(`${pkg}@2.3.4`);
      expect(warnings()[0].msg).toContain(reason);
      expect(JSON.stringify(mocks.lines)).not.toContain("s3cr3t-value");
      expect(JSON.stringify(mocks.lines)).not.toContain("db.customer.com");
    });

    it("warns once per package@version in five minutes, then again", async () => {
      mocks.findUnique.mockResolvedValue(null);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
      const pkg = freshPackage();
      await getServiceSecretPaths(pkg, "1.0.0", source);
      await getServiceSecretPaths(pkg, "1.0.0", source);
      expect(warnings()).toHaveLength(1);
      await getServiceSecretPaths(pkg, "1.0.1", source);
      expect(warnings()).toHaveLength(2);
      vi.setSystemTime(new Date("2026-11-19T10:05:01Z"));
      await getServiceSecretPaths(pkg, "1.0.0", source);
      expect(warnings()).toHaveLength(3);
    });
  });
});

describe("the service config type, no spec", () => {
  const type = getConfigObjectType("service");
  const stored = (pkg: string) => ({
    id: "svc1",
    workspaceId: "ws1",
    type: "service",
    protocol: "airbyte",
    package: pkg,
    version: "1.0.0",
    credentials: { host: "db.customer.com", password: "real-password", auth: { token: "real-token" } },
  });
  beforeEach(() => mocks.findUnique.mockResolvedValue(null));

  describe("outputFilter", () => {
    it("masks every credential value and leaves everything else alone", async () => {
      const pkg = freshPackage();
      const out = await type.outputFilter(stored(pkg) as any);
      expect(out.credentials).toEqual({
        host: MASKED_SECRET,
        password: MASKED_SECRET,
        auth: { token: MASKED_SECRET },
      });
      expect(out.package).toBe(pkg);
      expect(out.version).toBe("1.0.0");
      expect(out.id).toBe("svc1");
    });

    it("masks a key with brackets or a dot in place: credentials stays an object", async () => {
      const original = {
        ...stored(freshPackage()),
        credentials: { "a[0]": "real-1", "b.c": "real-2", ok: "v", nested: { "d]": "real-3" } },
      };
      const out = await type.outputFilter(original as any);
      expect(out.credentials).toEqual({
        "a[0]": MASKED_SECRET,
        "b.c": MASKED_SECRET,
        ok: MASKED_SECRET,
        nested: { "d]": MASKED_SECRET },
      });
      expect(JSON.stringify(out)).not.toContain("real-");
    });

    it("masks a list entry by entry, so the shape the editor expects is kept", async () => {
      const original = {
        ...stored(freshPackage()),
        credentials: { hosts: ["a", "b"], rows: [{ k: "v1", n: 1 }, { k: "v2" }] },
      };
      const out = await type.outputFilter(original as any);
      expect(out.credentials).toEqual({
        hosts: [MASKED_SECRET, MASKED_SECRET],
        rows: [{ k: MASKED_SECRET, n: MASKED_SECRET }, { k: MASKED_SECRET }],
      });
    });

    it("is unchanged with a usable spec: only the listed secret is masked", async () => {
      mocks.findUnique.mockResolvedValue(USABLE_WITH_SECRET);
      const out = await type.outputFilter(stored(freshPackage()) as any);
      expect(out.credentials.host).toBe("db.customer.com");
      expect(out.credentials.password).toBe(MASKED_SECRET);
      expect(out.credentials.auth.token).toBe("real-token");
    });
  });

  describe("inputFilter", () => {
    it("does not store a mask that came back from the UI", async () => {
      const input = { ...stored(freshPackage()), credentials: { host: "db2.customer.com", password: MASKED_SECRET } };
      const out = await type.inputFilter(input as any, {} as any, {} as any);
      expect(out.credentials).toEqual({ host: "db2.customer.com" });
    });

    it("drops masked list entries instead of storing null for them", async () => {
      const input = {
        ...stored(freshPackage()),
        credentials: { hosts: [MASKED_SECRET, "typed"], rows: [{ k: MASKED_SECRET }] },
      };
      const out = await type.inputFilter(input as any, {} as any, {} as any);
      expect(out.credentials).toEqual({ hosts: ["typed"], rows: [{}] });
    });
  });

  describe("merge", () => {
    it("refuses a changed host while the stored password would be kept", async () => {
      const original = stored(freshPackage());
      await expect(
        type.merge(original as any, { credentials: { host: "attacker.example", password: MASKED_SECRET } } as any)
      ).rejects.toThrow(/Cannot keep the saved secrets/);
    });

    it("refuses a changed host even when the patch adds a key with a dot next to it", async () => {
      const original = stored(freshPackage());
      await expect(
        type.merge(original as any, { credentials: { host: "attacker.example", "a.b": "x" } } as any)
      ).rejects.toThrow(/Cannot keep the saved secrets/);
    });

    it("refuses a changed package when the patch gives only some of the credentials and a stored key has a dot", async () => {
      const original = { ...stored(freshPackage()), credentials: { "a.b": "real", host: "h" } };
      await expect(
        type.merge(original as any, { package: "attacker/x", credentials: { host: "h2" } } as any)
      ).rejects.toThrow(/Cannot keep the saved secrets \(credentials\.a\.b\)/);
    });

    it("accepts that change when every stored key, the dotted one included, is given again", async () => {
      const original = { ...stored(freshPackage()), credentials: { "a.b": "real", host: "h" } };
      const merged = await type.merge(
        original as any,
        {
          package: "other/x",
          credentials: { "a.b": "new", host: "h2" },
        } as any
      );
      expect(merged.credentials).toEqual({ "a.b": "new", host: "h2" });
    });

    it("keeps a stored list when the UI sends its masked form back", async () => {
      const original = {
        ...stored(freshPackage()),
        credentials: { hosts: ["a", "b"], rows: [{ k: "v1", n: 1 }, { k: "v2" }], token: "t" },
      };
      const shown = await type.outputFilter(original as any);
      const merged = await type.merge(original as any, { credentials: shown.credentials, name: "renamed" } as any);
      expect(merged.credentials).toEqual(original.credentials);
      expect(merged.name).toBe("renamed");
    });

    it("refuses a list that mixes masks with new values: the masks no longer say which stored entry they stand for", async () => {
      const original = { ...stored(freshPackage()), credentials: { rows: [{ k: "v1", s: "x" }, { k: "v2" }] } };
      await expect(
        type.merge(
          original as any,
          {
            credentials: { rows: [{ k: "new", s: MASKED_SECRET }, { k: MASKED_SECRET }] },
          } as any
        )
      ).rejects.toThrow(/credentials\.rows.*Enter the values of the whole list again/);
    });

    describe("rows with a constant field, as the editor sends them once the spec is back", () => {
      const rowsOf = () => ({
        rows: [
          { type: "oauth", token: "t1" },
          { type: "oauth", token: "t2" },
        ],
      });

      it("keeps the stored rows when only the secrets are still masked", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        const merged = await type.merge(
          original as any,
          {
            name: "renamed",
            credentials: {
              rows: [
                { type: "oauth", token: MASKED_SECRET },
                { type: "oauth", token: MASKED_SECRET },
              ],
            },
          } as any
        );
        expect(merged.credentials).toEqual(rowsOf());
        expect(merged.name).toBe("renamed");
      });

      it("refuses rows where a visible value was edited", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        await expect(
          type.merge(
            original as any,
            {
              credentials: {
                rows: [
                  { type: "basic", token: MASKED_SECRET },
                  { type: "oauth", token: MASKED_SECRET },
                ],
              },
            } as any
          )
        ).rejects.toThrow(/credentials\.rows/);
      });

      it("refuses rows after one was deleted, although the rest looks unchanged", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        await expect(
          type.merge(
            original as any,
            {
              credentials: { rows: [{ type: "oauth", token: MASKED_SECRET }] },
            } as any
          )
        ).rejects.toThrow(/credentials\.rows/);
      });

      it("refuses rows where a deleted row was replaced by a typed one", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        await expect(
          type.merge(
            original as any,
            {
              credentials: {
                rows: [
                  { type: "oauth", token: MASKED_SECRET },
                  { type: "oauth", token: "typed" },
                ],
              },
            } as any
          )
        ).rejects.toThrow(/credentials\.rows/);
      });

      it("refuses rows where a stored key was removed", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        await expect(
          type.merge(
            original as any,
            {
              credentials: { rows: [{ type: "oauth" }, { type: "oauth", token: MASKED_SECRET }] },
            } as any
          )
        ).rejects.toThrow(/credentials\.rows/);
      });

      it("refuses rows that have an extra key compared with the stored ones", async () => {
        const original = { ...stored(freshPackage()), credentials: rowsOf() };
        await expect(
          type.merge(
            original as any,
            {
              credentials: {
                rows: [
                  { type: "oauth", token: MASKED_SECRET, extra: "x" },
                  { type: "oauth", token: MASKED_SECRET },
                ],
              },
            } as any
          )
        ).rejects.toThrow(/credentials\.rows/);
      });
    });

    it("refuses a list after a row was deleted in the editor, instead of keeping the wrong stored row", async () => {
      const original = {
        ...stored(freshPackage()),
        credentials: {
          rows: [
            { k: "first", s: "x1" },
            { k: "second", s: "x2" },
          ],
        },
      };
      // the editor removed the first row: one masked row is left, which stood for the second
      await expect(
        type.merge(original as any, { credentials: { rows: [{ k: MASKED_SECRET, s: MASKED_SECRET }] } } as any)
      ).rejects.toThrow(/credentials\.rows/);
    });

    it("takes a list that was entered again in full", async () => {
      const original = { ...stored(freshPackage()), credentials: { hosts: ["a", "b"] } };
      const merged = await type.merge(original as any, { credentials: { hosts: ["c"] } } as any);
      expect(merged.credentials.hosts).toEqual(["c"]);
    });

    it("keeps a credential stored under a nested key named __proto__ out of reach of a package change", async () => {
      const credentials = JSON.parse('{"nested": {"__proto__": {"token": "real-token"}}}');
      const original = { ...stored(freshPackage()), credentials };
      await expect(type.merge(original as any, { package: "attacker/x" } as any)).rejects.toThrow(
        /Cannot keep the saved secrets/
      );
    });

    it("refuses a changed host while a stored list entry would be kept", async () => {
      const original = { ...stored(freshPackage()), credentials: { host: "h", hosts: ["a", "b"] } };
      await expect(
        type.merge(
          original as any,
          {
            credentials: { host: "attacker.example", hosts: [MASKED_SECRET, "b"] },
          } as any
        )
      ).rejects.toThrow(/Cannot keep the saved secrets \(credentials\.hosts\.0\)/);
    });

    it("refuses a changed package when the spec marks a whole credential object secret and only a mask is sent for it", async () => {
      mocks.findUnique.mockResolvedValue(
        specWith({ host: { type: "string" }, auth: { type: "object", airbyte_secret: true } })
      );
      const original = { ...stored(freshPackage()), credentials: { host: "h", auth: { token: "t", user: "u" } } };
      await expect(
        type.merge(
          original as any,
          {
            package: "attacker/x",
            credentials: { host: "h", auth: { token: MASKED_SECRET } },
          } as any
        )
      ).rejects.toThrow(/Cannot keep the saved secrets \(credentials\.auth\)/);
    });

    it("does not store a mask that was read while the spec was missing, once the spec is back", async () => {
      const original = stored(freshPackage());
      mocks.findUnique.mockResolvedValue(USABLE_WITH_SECRET);
      const merged = await type.merge(
        original as any,
        {
          credentials: {
            host: MASKED_SECRET,
            password: MASKED_SECRET,
            auth: { token: MASKED_SECRET },
            start_date: "2026",
          },
        } as any
      );
      expect(merged.credentials).toEqual({ ...original.credentials, start_date: "2026" });
      const created = await type.inputFilter(
        { ...original, credentials: { host: MASKED_SECRET, password: "typed" } } as any,
        {} as any,
        {} as any
      );
      expect(created.credentials).toEqual({ password: "typed" });
    });

    it("refuses a changed package while the stored credentials would be kept", async () => {
      const original = stored(freshPackage());
      await expect(type.merge(original as any, { package: "attacker/connector" } as any)).rejects.toThrow(
        /package changed/
      );
    });

    it("accepts a changed host when every credential value is supplied again", async () => {
      const original = stored(freshPackage());
      const merged = await type.merge(
        original as any,
        {
          credentials: { host: "new.customer.com", password: "new-password", auth: { token: "new-token" } },
        } as any
      );
      expect(merged.credentials).toEqual({
        host: "new.customer.com",
        password: "new-password",
        auth: { token: "new-token" },
      });
    });

    it("keeps the stored values when the UI sends the masks back with an edit that changes no target", async () => {
      const original = stored(freshPackage());
      const merged = await type.merge(
        original as any,
        {
          credentials: {
            host: MASKED_SECRET,
            password: MASKED_SECRET,
            auth: { token: MASKED_SECRET },
            start_date: "2026",
          },
        } as any
      );
      expect(merged.credentials).toEqual({
        host: "db.customer.com",
        password: "real-password",
        auth: { token: "real-token" },
        start_date: "2026",
      });
    });

    it("does not treat a new version of the same package as a target (upgrades keep the credentials)", async () => {
      const original = stored(freshPackage());
      const merged = await type.merge(original as any, { version: "9.9.9" } as any);
      expect(merged.version).toBe("9.9.9");
      expect(merged.credentials.password).toBe("real-password");
    });

    it("looks the spec up by the stored package and version, not the patch's", async () => {
      const original = stored(freshPackage());
      await type.merge(original as any, { version: "9.9.9" } as any);
      expect(mocks.findUnique).toHaveBeenCalledWith({
        where: { package_version: { package: original.package, version: "1.0.0" } },
      });
    });
  });
});

describe("test connection and clone with a masked list (unmaskSecretsFromOriginal)", () => {
  const storedService = {
    package: "airbyte/source-x",
    version: "1.0.0",
    credentials: { hosts: ["a.example:1", "b.example:1"], password: "pw" },
  };

  it("restores a list whose every entry is still masked, and does not call it a changed target", () => {
    const submitted = {
      ...storedService,
      credentials: { hosts: [MASKED_SECRET, MASKED_SECRET], password: MASKED_SECRET },
    };
    expect(unmaskSecretsFromOriginal(submitted, storedService).credentials).toEqual(storedService.credentials);
  });

  it("restores rows whose constant field is back and whose secrets are still masked", () => {
    const withRows = {
      ...storedService,
      credentials: {
        rows: [
          { type: "oauth", token: "t1" },
          { type: "oauth", token: "t2" },
        ],
      },
    };
    const submitted = {
      ...withRows,
      credentials: {
        rows: [
          { type: "oauth", token: MASKED_SECRET },
          { type: "oauth", token: MASKED_SECRET },
        ],
      },
    };
    expect(unmaskSecretsFromOriginal(submitted, withRows).credentials).toEqual(withRows.credentials);
    const edited = { ...withRows, credentials: { rows: [{ type: "oauth", token: MASKED_SECRET }] } };
    expect(() => unmaskSecretsFromOriginal(edited, withRows)).toThrow(/credentials\.rows/);
  });

  it("refuses a masked list that lost an entry: the mask no longer says which one is left", () => {
    const submitted = { ...storedService, credentials: { hosts: [MASKED_SECRET], password: MASKED_SECRET } };
    expect(() => unmaskSecretsFromOriginal(submitted, storedService)).toThrow(/hosts/);
  });

  it("refuses a masked list that is not a target as well, when an entry is missing", () => {
    const withTokens = { ...storedService, credentials: { tokens: ["t1", "t2"], password: "pw" } };
    const submitted = { ...withTokens, credentials: { tokens: [MASKED_SECRET], password: MASKED_SECRET } };
    expect(() => unmaskSecretsFromOriginal(submitted, withTokens)).toThrow(/credentials\.tokens/);
    const untouched = {
      ...withTokens,
      credentials: { tokens: [MASKED_SECRET, MASKED_SECRET], password: MASKED_SECRET },
    };
    expect(unmaskSecretsFromOriginal(untouched, withTokens).credentials).toEqual(withTokens.credentials);
  });

  it("still refuses a typed host that differs from the stored ones", () => {
    const submitted = {
      ...storedService,
      credentials: { hosts: ["attacker.example:1", "b.example:1"], password: MASKED_SECRET },
    };
    expect(() => unmaskSecretsFromOriginal(submitted, storedService)).toThrow(/hosts changed/);
  });
});
