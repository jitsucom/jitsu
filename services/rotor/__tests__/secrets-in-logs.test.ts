import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// JITSU-302: secrets and personal data must not reach the logs. Everything the code hands to its loggers is recorded.

const recorded = vi.hoisted(() => {
  const lines: string[] = [];
  const text = (v: unknown): string => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const makeLog = () => {
    const builder = (level: string) => {
      let cause: unknown;
      const b: any = {
        log: (message: string, ...args: unknown[]) =>
          lines.push([level, message, ...args.map(text), cause === undefined ? "" : text(cause)].join(" | ")),
        withCause: (c: unknown) => {
          cause = c;
          return b;
        },
      };
      return b;
    };
    return {
      atDebug: () => builder("debug"),
      atInfo: () => builder("info"),
      atWarn: () => builder("warn"),
      atError: () => builder("error"),
    };
  };
  return { lines, makeLog };
});
vi.mock("juava", async importOriginal => ({
  ...(await importOriginal<typeof import("juava")>()),
  getLog: () => recorded.makeLog(),
}));

beforeEach(() => {
  recorded.lines.length = 0;
});

describe("the Kafka SASL setup", () => {
  it("does not log the password, only which mechanism and user", async () => {
    const { connectToKafka } = await import("../src/lib/kafka-config");
    connectToKafka({
      defaultAppId: "secrets-test",
      brokers: ["localhost:9"],
      sasl: { mechanism: "plain", username: "kafka-user", password: "KAFKA-PASSWORD-VALUE-1" } as any,
    });
    const line = recorded.lines.find(l => /SASL/.test(l));
    expect(line, "the SASL setup was not logged").toBeDefined();
    expect(recorded.lines.join("\n")).not.toContain("KAFKA-PASSWORD-VALUE-1");
    expect(line).toContain("kafka-user");
    expect(line).toContain("plain");
  });
});

describe("the profile builder's result", () => {
  it("is described by its size, not printed", async () => {
    const { describeProfileResult } = await import("../src/lib/profile-log");
    const profile = {
      traits: { email: "private@person.example", name: "Private Person" },
      anonymousId: "anon-1",
      n: 3,
    };
    const text = describeProfileResult(profile);
    expect(text).not.toContain("private@person.example");
    expect(text).not.toContain("Private Person");
    expect(text).toMatch(/3 top-level field/);
    expect(text).toMatch(/\d+ bytes/);
  });

  it("copes with an empty or non-object result", async () => {
    const { describeProfileResult } = await import("../src/lib/profile-log");
    expect(describeProfileResult({})).toMatch(/0 top-level field/);
    expect(describeProfileResult(null)).toMatch(/0 top-level field/);
    expect(describeProfileResult("text")).toMatch(/0 top-level field/);
  });

  it("is what the builder logs: no log call in builder.ts serializes the result", () => {
    const source = readFileSync(path.join(__dirname, "../src/lib/builder.ts"), "utf8");
    expect(source).toContain("describeProfileResult(");
    expect(source).not.toMatch(/\.log\([^)]*JSON\.stringify\(result\)/);
  });
});

describe("a database query that fails", () => {
  it("is logged without parameter values: the source no longer serializes the parameters", () => {
    const source = readFileSync(path.join(__dirname, "../src/lib/db.ts"), "utf8");
    expect(source).not.toMatch(/JSON\.stringify\(processedParams\)/);
    expect(source).toContain("safeDbErrorFields(e)");
  });
});
