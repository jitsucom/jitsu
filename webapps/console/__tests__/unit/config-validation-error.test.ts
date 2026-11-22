import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/shared/errors";
import { parseObject } from "../../lib/schema/config-objects";

// JITSU-280: a config that fails validation must not be echoed back. On an update the object is the stored config merged
// with the patch, so it carries the stored secrets, and the API handler both sends it and logs it.

const SECRET = "stored-password-7f3a";
const HOST = "db.customer-only.example";

const stored = {
  id: "dst1",
  workspaceId: "ws1",
  type: "destination",
  name: "pg",
  destinationType: "postgres",
  database: "events",
  username: "jitsu",
  password: SECRET,
  host: HOST,
};

function thrown(type: string, obj: any): ApiError {
  try {
    parseObject(type, obj);
  } catch (e: any) {
    return e;
  }
  throw new Error("parseObject did not throw");
}

/** Everything the API handler sends or logs about an error: the message and the response object */
const exposed = (e: ApiError) => JSON.stringify({ message: e.message, ...e.responseObject });

// the first two fail the destination's own schema, which is checked second; the third fails the generic schema, checked first
const invalid: [string, any][] = [
  ["a text value in a number field", { ...stored, port: "x" }],
  ["a missing required field of the destination", { ...stored, database: undefined }],
  ["a missing required field of every config", { ...stored, name: undefined }],
];

describe("a config that fails validation", () => {
  it.each(invalid)("is refused with a 400, not a server error: %s", (_name, obj) => {
    expect(thrown("destination", obj).status).toBe(400);
  });

  it.each(invalid)("sends and logs no value of the config: %s", (_name, obj) => {
    const e = thrown("destination", obj);
    expect(exposed(e)).not.toContain(SECRET);
    expect(exposed(e)).not.toContain(HOST);
    expect(exposed(e)).not.toContain("jitsu");
    expect(e.responseObject).not.toHaveProperty("object");
  });

  it("still says what is wrong: the validation issues, with their paths", () => {
    const e = thrown("destination", { ...stored, port: "x" });
    const issues = (e.responseObject as any).error.issues;
    expect(issues.map((i: any) => i.path.join("."))).toContain("port");
  });

  it("does so for any config type, not only destinations", () => {
    const e = thrown("service", {
      id: "s1",
      workspaceId: "ws1",
      type: "service",
      protocol: "airbyte",
      package: 5,
      version: "1.0.0",
      credentials: { password: SECRET },
    });
    expect(e.status).toBe(400);
  });

  it("sends and logs no value of a service's credentials either", () => {
    const e = thrown("service", {
      id: "s1",
      workspaceId: "ws1",
      type: "service",
      protocol: "airbyte",
      package: 5,
      version: "1.0.0",
      credentials: { password: SECRET },
    });
    expect(exposed(e)).not.toContain(SECRET);
  });
});
