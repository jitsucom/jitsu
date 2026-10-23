import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postgresSql } from "./postgres";
import { ModelDefinition } from "./schema";

describe("PostgreSQL AT TIME ZONE validation", () => {
  const expression = "(now() - interval '1 hour') AT TIME ZONE 'UTC'";

  it("accepts the Google conversion fixture and compiles the original SQL", () => {
    const query = readFileSync(new URL("./postgres-conversion.fixture.sql", import.meta.url), "utf8");
    const normalized = query.replace(/;\s*$/, "\n");
    expect(postgresSql.validateQuery(query)).toBe(normalized);
    const compiled = postgresSql.compileModel(
      ModelDefinition.parse({ warehouseId: "test", query, primaryKey: ["id"] }),
      [{ name: "id", type: "25" }]
    );
    expect(compiled.query).toContain(normalized);
    expect(compiled.query).not.toContain("||");
  });

  it.each([
    `SELECT ${expression} AS t`,
    `SELECT to_char(${expression}, 'YYYY') AS t`,
    `SELECT (${expression}) AT TIME ZONE 'Europe/London' AS t`,
    "SELECT '2026-10-22 10:00:00'::timestamp AT TIME ZONE 'UTC' AS t",
    "SELECT CASE WHEN true THEN now() ELSE NULL END AT TIME ZONE 'UTC' AS t",
    "SELECT (SELECT now()) AT TIME ZONE 'UTC' AS t",
    "SELECT (now() - interval '1 hour') aT\nTiMe\r\nZoNe 'UTC' AS t",
    `WITH times AS (SELECT ${expression} AS t) SELECT t FROM times`,
    `SELECT 1 AS id WHERE ${expression} > '2026-01-01'::timestamp`,
    `SELECT ${expression} AS t; -- AT TIME ZONE; comment`,
    `SELECT ${expression} AS t /* nested /* AT TIME ZONE */ comment */`,
  ])("accepts read-only expressions without rewriting them: %s", query => {
    expect(postgresSql.validateQuery(query)).toBe(query.replace("; --", " --"));
  });

  it.each([
    `'AT TIME ZONE; ''quoted'''`,
    `$$AT TIME ZONE; 'quoted'$$`,
    `$tag$AT TIME ZONE; 'quoted'$tag$`,
    `$é$AT TIME ZONE; 'quoted'$é$`,
  ])("preserves quoted text beside timezone expressions: %s", literal => {
    const query = `SELECT ${expression} AS t, ${literal} AS "AT TIME ZONE;";`;
    expect(postgresSql.validateQuery(query)).toBe(query.slice(0, -1));
  });

  it.each([
    `SELECT ${expression}; SELECT 2`,
    `SELECT ${expression}; DROP TABLE t`,
    `SELECT ${expression} INTO copied FROM t`,
    `SELECT ${expression} FROM t FOR UPDATE`,
    `SELECT ${expression} FROM t FOR SHARE`,
    `WITH removed AS (DELETE FROM t RETURNING *) SELECT ${expression} FROM removed`,
    `WITH added AS (INSERT INTO t VALUES (1) RETURNING *) SELECT ${expression} FROM added`,
    `WITH changed AS (UPDATE t SET id = 1 RETURNING *) SELECT ${expression} FROM changed`,
    `SELECT ${expression}, (SELECT id FROM t FOR UPDATE)`,
    `SELECT ${expression} AT TIME ZONE (SELECT id FROM t FOR UPDATE)`,
    `SELECT ${expression}, E'escaped\\\''; DELETE FROM t; --'`,
    `SELECT ${expression}, 'unclosed`,
    `SELECT ${expression}, $$unclosed`,
    `SELECT ${expression}, /* unclosed`,
  ])("still rejects writes, locks, multiple statements and malformed SQL: %s", query => {
    expect(() => postgresSql.validateQuery(query)).toThrow();
  });
});
