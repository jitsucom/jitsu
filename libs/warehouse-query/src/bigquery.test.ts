import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bigquerySql, createBigQueryReader, decodeBigQueryRow } from "./bigquery";
import { createWarehouseReader, getWarehouseSqlDialect } from "./index";
import { ModelDefinition, supportsWarehouseReader } from "./schema";
const auth = vi.hoisted(() => ({ options: vi.fn(), headers: vi.fn() }));
vi.mock("google-auth-library", () => ({
  JWT: class {
    constructor(options: unknown) {
      auth.options(options);
    }
    getRequestHeaders = auth.headers;
  },
}));
const config = {
  destinationType: "bigquery",
  project: "test-project",
  bqDataset: "dataset",
  keyFile: JSON.stringify({
    type: "service_account",
    client_email: "service@example.test",
    private_key: "test-private-key",
    token_uri: "https://untrusted.invalid",
  }),
};
const fields = [
  { name: "id", type: "INTEGER" },
  { name: "changed", type: "TIMESTAMP" },
];
const model = ModelDefinition.parse({
  warehouseId: "wh",
  query: "SELECT id, changed FROM `test-project.dataset.source`",
  primaryKey: ["id"],
  pageSize: 1,
});
const requests: { url: URL; body: any; signal?: AbortSignal | null }[] = [];
let resultPages: any[];
function stubRequests(
  override?: (url: URL, body: any, signal?: AbortSignal | null) => ReturnType<typeof Response.json> | undefined
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, body, signal: init.signal });
      expect(url.origin).toBe("https://bigquery.googleapis.com");
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-access-token" });
      const response = override?.(url, body, init.signal);
      if (response) return response;
      if (url.pathname.includes("/datasets/")) return Response.json({ location: "EU" });
      if (url.pathname.endsWith("/cancel")) return Response.json({});
      if (body?.configuration?.dryRun) return Response.json({ statistics: { query: { schema: { fields } } } });
      if (body?.configuration?.query)
        return Response.json({ jobReference: body.jobReference, status: { state: "RUNNING" } });
      if (url.pathname.includes("/queries/")) {
        expect(url.searchParams.get("formatOptions.useInt64Timestamp")).toBe("true");
        return Response.json(resultPages.shift() ?? { jobComplete: true, schema: { fields } });
      }
      throw new Error(`Unexpected request ${url}`);
    })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  resultPages = [
    {
      jobComplete: true,
      schema: { fields: [...fields, { name: "__jitsu_retl_key_count", type: "INTEGER" }] },
      rows: [{ f: [{ v: "9007199254740993" }, { v: "1767225600123456" }, { v: "1" }] }],
    },
  ];
  auth.headers.mockResolvedValue(new Headers({ authorization: "Bearer test-access-token" }));
  stubRequests();
});
afterEach(() => vi.unstubAllGlobals());
async function collect<T>(source: AsyncIterable<T>) {
  const rows: T[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}

it("registers BigQuery and uses only the saved service-account key", async () => {
  expect(supportsWarehouseReader({ destinationType: "bigquery" })).toBe(true);
  expect(getWarehouseSqlDialect("bigquery")).toBe(bigquerySql);
  const reader = createWarehouseReader(config);
  expect(auth.options).toHaveBeenCalledWith(
    expect.objectContaining({ email: "service@example.test", key: "test-private-key" })
  );
  expect(auth.options.mock.calls[0][0]).not.toHaveProperty("token_uri");
  expect(await reader.columns(model.query)).toEqual(fields);
  expect(requests.filter(r => r.body?.configuration).every(r => r.body.configuration.dryRun)).toBe(true);
  expect(requests.at(-1)?.body).toMatchObject({
    jobReference: { location: "EU" },
    configuration: {
      query: { useLegacySql: false, defaultDataset: { projectId: config.project, datasetId: config.bqDataset } },
    },
  });
  await reader.close();
});
it.each(["{}", JSON.stringify({ type: "external_account", credential_source: { file: "/etc/passwd" } })])(
  "never falls back to machine credentials: %s",
  keyFile => {
    expect(() => createBigQueryReader({ ...config, keyFile })).toThrow();
    expect(auth.options).not.toHaveBeenCalled();
  }
);
it.each([
  "DELETE FROM source",
  "SELECT 1; SELECT 2",
  "CREATE TABLE x AS SELECT 1",
  "EXPORT DATA OPTIONS(uri='gs://x/*',format='CSV') AS SELECT 1",
])("rejects non-read-only SQL before I/O: %s", query => {
  expect(() => bigquerySql.validateQuery(query)).toThrow();
  expect(requests).toHaveLength(0);
});
it("preserves GoogleSQL names, literals, CTEs and delimiter semantics", () => {
  const query = "WITH src AS (SELECT 'semi;colon' AS id) SELECT id FROM src; -- tail;";
  expect(bigquerySql.validateQuery(query)).toBe(query.replace("src; --", "src --"));
  expect(bigquerySql.validateQuery(model.query)).toBe(model.query);
});
it("binds lossless composite cursors without inserting values in SQL", () => {
  const incremental = { ...model, cursor: { column: "changed", type: "timestamp" as const } };
  const compiled = bigquerySql.compileModel(incremental, fields, {
    value: "2026-01-01T00:00:00.123456Z",
    primaryKeyValues: ["9007199254740993"],
  });
  expect(compiled.query).toContain("CAST(@p0 AS TIMESTAMP)");
  expect(compiled.query).toContain("CAST(@p1 AS INT64)");
  expect(compiled.query).not.toContain("9007199254740993");
  expect(compiled.queryParams).toEqual({ p0: "2026-01-01T00:00:00.123456Z", p1: "9007199254740993" });
  expect(
    bigquerySql.compileModel({ ...incremental, cursor: { ...incremental.cursor, lookbackSeconds: 60 } }, fields, {
      value: "2026-01-01T00:00:00.123456Z",
      primaryKeyValues: ["9007199254740993"],
    }).query
  ).toContain("TIMESTAMP_SUB(TIMESTAMP(CAST(@p0 AS TIMESTAMP)), INTERVAL 60 SECOND)");
});
it("rejects structured keys and incompatible cursor/delete fields", () => {
  for (const type of ["FLOAT", "FLOAT64"])
    expect(() => bigquerySql.validateColumns(model, [{ name: "id", type }, fields[1]])).toThrow(/unsupported/);
  expect(() => bigquerySql.validateColumns(model, [{ name: "id", type: "ARRAY<INTEGER>" }, fields[1]])).toThrow(
    /unsupported/
  );
  expect(() =>
    bigquerySql.validateColumns({ ...model, cursor: { column: "changed", type: "number" } }, fields)
  ).toThrow(/does not match/);
  expect(() => bigquerySql.validateColumns({ ...model, deleteColumn: "changed" }, fields)).toThrow(/Delete column/);
});
it("decodes exact integers, decimals, microsecond timestamps, booleans and nested records", () => {
  expect(
    decodeBigQueryRow(
      [
        ...fields,
        { name: "decimal", type: "NUMERIC" },
        { name: "flag", type: "BOOLEAN" },
        { name: "nested", type: "RECORD", fields: [{ name: "keys", type: "INTEGER", mode: "REPEATED" }] },
      ],
      {
        f: [
          { v: "9007199254740993" },
          { v: "-1" },
          { v: "123456789.123456789" },
          { v: "false" },
          { v: { f: [{ v: [{ v: "9007199254740993" }] }] } },
        ],
      }
    )
  ).toEqual({
    id: "9007199254740993",
    changed: "1969-12-31T23:59:59.999999Z",
    decimal: "123456789.123456789",
    flag: false,
    nested: { keys: ["9007199254740993"] },
  });
});
it("paginates a single saved job rather than reexecuting the model", async () => {
  resultPages[0].pageToken = "page-2";
  resultPages.push({
    jobComplete: true,
    rows: [{ f: [{ v: "9007199254740994" }, { v: "1767225600123457" }, { v: "1" }] }],
  });
  const reader = createBigQueryReader(config);
  const result = await collect(reader.stream(model));
  expect(result.map(r => r.row.id)).toEqual(["9007199254740993", "9007199254740994"]);
  expect(result[0].row.changed).toBe("2026-01-01T00:00:00.123456Z");
  const jobs = requests.filter(r => r.body?.configuration && !r.body.configuration.dryRun);
  expect(jobs).toHaveLength(1);
  const pages = requests.filter(r => r.url.pathname.includes("/queries/"));
  expect(new Set(pages.map(r => r.url.pathname)).size).toBe(1);
  expect(pages[1].url.searchParams.get("pageToken")).toBe("page-2");
  await reader.close();
});
it("sends checkpoint values and query cost limit to BigQuery", async () => {
  const reader = createBigQueryReader({ ...config, location: "US", maximumBytesBilled: "1000000000" });
  await collect(
    reader.stream(
      { ...model, cursor: { column: "changed", type: "timestamp" } },
      { value: "2026-01-01T00:00:00Z", primaryKeyValues: ["7"] }
    )
  );
  expect(requests.some(r => r.url.pathname.includes("/datasets/"))).toBe(false);
  const query = requests.find(r => r.body?.configuration?.query && !r.body.configuration.dryRun)?.body.configuration
    .query;
  expect(query).toMatchObject({
    maximumBytesBilled: "1000000000",
    parameterMode: "NAMED",
    queryParameters: [
      { name: "p0", parameterType: { type: "STRING" }, parameterValue: { value: "2026-01-01T00:00:00Z" } },
      { name: "p1", parameterType: { type: "STRING" }, parameterValue: { value: "7" } },
    ],
  });
  await reader.close();
});
it("fails on duplicate keys", async () => {
  resultPages[0].rows[0].f[2].v = "2";
  const reader = createBigQueryReader(config);
  await expect(collect(reader.stream(model))).rejects.toThrow(/duplicate primary keys/);
  await reader.close();
});
it.each(["NaN", "Infinity", "-Infinity"])("rejects non-finite numeric checkpoints: %s", async value => {
  const floatFields = [fields[0], { name: "changed", type: "FLOAT" }];
  stubRequests((_url, body) =>
    body?.configuration?.dryRun
      ? Response.json({ statistics: { query: { schema: { fields: floatFields } } } })
      : undefined
  );
  resultPages = [
    {
      jobComplete: true,
      schema: { fields: [...floatFields, { name: "__jitsu_retl_key_count", type: "INTEGER" }] },
      rows: [{ f: [{ v: "1" }, { v: value }, { v: "1" }] }],
    },
  ];
  const reader = createBigQueryReader(config);
  await expect(collect(reader.stream({ ...model, cursor: { column: "changed", type: "number" } }))).rejects.toThrow(
    /finite values/
  );
  await reader.close();
});
it("keeps finite floating-point cursors supported", async () => {
  const floatFields = [fields[0], { name: "changed", type: "FLOAT" }];
  stubRequests((_url, body) =>
    body?.configuration?.dryRun
      ? Response.json({ statistics: { query: { schema: { fields: floatFields } } } })
      : undefined
  );
  resultPages = [
    {
      jobComplete: true,
      schema: { fields: [...floatFields, { name: "__jitsu_retl_key_count", type: "INTEGER" }] },
      rows: [{ f: [{ v: "1" }, { v: "1.25" }, { v: "1" }] }],
    },
  ];
  const reader = createBigQueryReader(config);
  const result = await collect(reader.stream({ ...model, cursor: { column: "changed", type: "number" } }));
  expect(result[0].checkpoint).toEqual({ value: "1.25", primaryKeyValues: ["1"] });
  await reader.close();
});
it("returns at most 100 preview rows with a truncation marker", async () => {
  resultPages = [
    {
      jobComplete: true,
      schema: { fields: [fields[0]] },
      rows: Array.from({ length: 101 }, (_, i) => ({ f: [{ v: String(i) }] })),
    },
  ];
  const reader = createBigQueryReader(config);
  const preview = await reader.preview(model.query);
  expect(preview.rows).toHaveLength(100);
  expect(preview.truncated).toBe(true);
  expect(
    requests.find(r => r.body?.configuration && !r.body.configuration.dryRun)?.body.configuration.query.query
  ).toContain("LIMIT 101");
  await reader.close();
});
it("rejects oversized previews", async () => {
  resultPages = [
    {
      jobComplete: true,
      schema: { fields: [{ name: "id", type: "STRING" }] },
      rows: [{ f: [{ v: "x".repeat(2_000_001) }] }],
    },
  ];
  const reader = createBigQueryReader(config);
  await expect(reader.preview(model.query)).rejects.toThrow(/2 MB/);
  await reader.close();
});
it("cancels an unfinished job when the caller aborts", async () => {
  const controller = new AbortController();
  stubRequests(url => {
    if (url.pathname.includes("/queries/")) {
      controller.abort(new Error("test cancellation"));
      return Response.json({ jobComplete: false });
    }
  });
  const reader = createBigQueryReader(config);
  await expect(collect(reader.stream(model, undefined, controller.signal))).rejects.toThrow(/test cancellation/);
  expect(requests.some(r => r.url.pathname.endsWith("/cancel") && !r.signal?.aborted)).toBe(true);
  await reader.close();
});
it("reports provider errors and never reads after close", async () => {
  stubRequests(url =>
    url.pathname.includes("/datasets/")
      ? Response.json({ error: { message: "Access denied to dataset" } }, { status: 403 })
      : undefined
  );
  const reader = createBigQueryReader(config);
  await expect(reader.columns(model.query)).rejects.toThrow("Access denied to dataset");
  await reader.close();
  requests.length = 0;
  await expect(reader.columns(model.query)).rejects.toThrow();
  expect(requests).toHaveLength(0);
});
