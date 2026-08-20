import { describe, expect, it } from "vitest";
import { deepMerge } from "juava";
import {
  collectJsonSchemaFreeFormPaths,
  getDestinationFreeFormPaths,
  replaceFreeFormMaps,
} from "../../lib/schema/free-form-maps";

// Regression guard for the "can't remove a warehouse `parameters` entry" bug:
// config updates deepMerge the patch into the stored object, which can add and
// overwrite keys but never remove them. Free-form maps have to be replaced.

/** What configObjectType.merge("destination") does, minus the secret masking. */
function mergeDestination(stored: any, patch: any) {
  return replaceFreeFormMaps(deepMerge(stored, patch), patch, getDestinationFreeFormPaths(stored.destinationType));
}

describe("getDestinationFreeFormPaths", () => {
  it("finds `parameters` on the warehouses that declare a catchall", () => {
    for (const type of ["clickhouse", "snowflake", "mysql"]) {
      expect(getDestinationFreeFormPaths(type), type).toContain("parameters");
    }
  });

  it("finds it on mysql, whose `parameters` declares `tls` alongside the catchall", () => {
    // The signal is the catchall, not an empty shape.
    expect(getDestinationFreeFormPaths("mysql")).toEqual(["parameters"]);
  });

  it("returns nothing for destinations with fully declared credentials", () => {
    expect(getDestinationFreeFormPaths("webhook")).toEqual([]);
  });

  it("returns nothing for an unknown destination type", () => {
    expect(getDestinationFreeFormPaths("no-such-destination")).toEqual([]);
  });
});

describe("destination update: credentials.parameters", () => {
  const stored = () => ({
    id: "d1",
    destinationType: "snowflake",
    account: "acct",
    database: "DB",
    password: "secret",
    parameters: { QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true" },
  });

  it("adds a parameter", () => {
    const patch = { parameters: { QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true", TIMEZONE: "UTC" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({
      QUERY_TAG: "jitsu",
      CLIENT_SESSION_KEEP_ALIVE: "true",
      TIMEZONE: "UTC",
    });
  });

  it("changes a parameter", () => {
    const patch = { parameters: { QUERY_TAG: "changed", CLIENT_SESSION_KEEP_ALIVE: "true" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({
      QUERY_TAG: "changed",
      CLIENT_SESSION_KEEP_ALIVE: "true",
    });
  });

  it("removes one parameter", () => {
    const patch = { parameters: { QUERY_TAG: "jitsu" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({ QUERY_TAG: "jitsu" });
  });

  it("removes all parameters", () => {
    const patch = { parameters: {} };
    expect(mergeDestination(stored(), patch).parameters).toEqual({});
  });

  it("leaves other fields merged as before", () => {
    const patch = { parameters: {}, database: "DB2" };
    const result = mergeDestination(stored(), patch);
    expect(result.database).toEqual("DB2");
    expect(result.account).toEqual("acct");
  });

  it("keeps the stored map when the patch doesn't mention it (partial update)", () => {
    // The write-key auto-save / CLI --field / MCP update_resource shape.
    const patch = { database: "DB2" };
    const result = mergeDestination(stored(), patch);
    expect(result.parameters).toEqual({ QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true" });
    expect(result.password).toEqual("secret");
  });
});

describe("collectJsonSchemaFreeFormPaths (service specs)", () => {
  it("finds objects with a schema-valued additionalProperties, nested and in oneOf branches", () => {
    const spec = {
      properties: {
        host: { type: "string" },
        options: { type: "object", additionalProperties: { type: "string" } },
        tunnel: {
          type: "object",
          properties: {
            extra: { type: "object", additionalProperties: { type: "string" } },
            port: { type: "integer" },
          },
        },
        auth: {
          oneOf: [
            { properties: { token: { type: "string" } } },
            { properties: { headers: { type: "object", additionalProperties: { type: "string" } } } },
          ],
        },
      },
    };
    expect(collectJsonSchemaFreeFormPaths(spec).sort()).toEqual([
      "credentials.auth.headers",
      "credentials.options",
      "credentials.tunnel.extra",
    ]);
  });

  // `additionalProperties: true` is a laxness flag in Airbyte specs, not an open key set.
  // Treating it as a free-form map replaces the object wholesale on a partial update, which
  // drops the keys the caller didn't send - including secrets stripped by removeMaskedValues.
  it("ignores a bare `additionalProperties: true` on a declared object", () => {
    // Shape of airbyte/source-youtube-analytics `credentials`, all three fields airbyte_secret.
    const spec = {
      properties: {
        credentials: {
          type: "object",
          additionalProperties: true,
          properties: {
            client_id: { type: "string", airbyte_secret: true },
            client_secret: { type: "string", airbyte_secret: true },
            refresh_token: { type: "string", airbyte_secret: true },
          },
        },
      },
    };
    expect(collectJsonSchemaFreeFormPaths(spec)).toEqual([]);
  });

  // Pins the deliberate choice not to treat a oneOf/anyOf branch as a map itself: only the
  // properties inside a branch are walked. Every branch-level `additionalProperties` in the
  // connector specs we ship is the boolean laxness flag, never a real open key set.
  it("does not treat a oneOf/anyOf branch itself as an open map", () => {
    // Shape of airbyte/source-postgres `ssl_mode` / `replication_method`: every branch
    // declares properties alongside `additionalProperties: true`.
    const spec = {
      properties: {
        ssl_mode: {
          title: "SSL Modes",
          oneOf: [
            { title: "disable", additionalProperties: true, properties: { mode: { type: "string" } } },
            {
              title: "verify-ca",
              additionalProperties: true,
              properties: { mode: { type: "string" }, ca_certificate: { type: "string", airbyte_secret: true } },
            },
          ],
        },
      },
    };
    expect(collectJsonSchemaFreeFormPaths(spec)).toEqual([]);
  });

  it("finds a bare `additionalProperties: true` when nothing is declared beside it", () => {
    // The "arbitrary key/value bag" idiom - an open key set, unlike the laxness-flag case above.
    const spec = { properties: { tags: { type: "object", additionalProperties: true } } };
    expect(collectJsonSchemaFreeFormPaths(spec)).toEqual(["credentials.tags"]);
  });

  it("ignores objects with a closed key set", () => {
    const spec = { properties: { nested: { type: "object", properties: { a: { type: "string" } } } } };
    expect(collectJsonSchemaFreeFormPaths(spec)).toEqual([]);
  });

  it("tolerates a missing or empty spec", () => {
    expect(collectJsonSchemaFreeFormPaths(undefined)).toEqual([]);
    expect(collectJsonSchemaFreeFormPaths({})).toEqual([]);
  });
});

describe("service update: partial patch of a declared object", () => {
  // The bug this guards: `credentials` on airbyte/source-youtube-analytics is a declared
  // object carrying `additionalProperties: true`. Reading that as a free-form map made
  // replaceFreeFormMaps overwrite it with the patch - and the patch has the masked secrets
  // removed by removeMaskedValues, so client_secret / refresh_token were silently lost.
  const spec = {
    properties: {
      credentials: {
        type: "object",
        additionalProperties: true,
        properties: {
          client_id: { type: "string", airbyte_secret: true },
          client_secret: { type: "string", airbyte_secret: true },
          refresh_token: { type: "string", airbyte_secret: true },
        },
      },
    },
  };

  it("keeps the stored secrets the patch didn't carry", () => {
    const stored = {
      credentials: { credentials: { client_id: "CID", client_secret: "REAL_SECRET", refresh_token: "REAL_TOKEN" } },
    };
    // What removeMaskedValues leaves behind when the user edits only client_id.
    const cleanedPatch = { credentials: { credentials: { client_id: "CID2" } } };

    const result = replaceFreeFormMaps(
      deepMerge(stored, cleanedPatch),
      cleanedPatch,
      collectJsonSchemaFreeFormPaths(spec)
    );

    expect(result.credentials.credentials).toEqual({
      client_id: "CID2",
      client_secret: "REAL_SECRET",
      refresh_token: "REAL_TOKEN",
    });
  });
});
