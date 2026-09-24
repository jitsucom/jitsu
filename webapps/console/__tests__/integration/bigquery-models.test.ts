import { generateKeyPairSync } from "node:crypto";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { createWarehouseReader, SourceRecord } from "@jitsu/warehouse-query";
import { ModelDefinition } from "@jitsu/warehouse-query/src/schema";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { modelColumns, previewModel } from "../../lib/server/reverse-etl-models";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";

it("uses a saved BigQuery connection for preview, model save, admission and runner extraction", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const fields = [
    { name: "id", type: "INTEGER" },
    { name: "changed", type: "TIMESTAMP" },
  ];
  const jobs = new Map<string, boolean>();
  let authorizations = 0;
  server.use(
    http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      const claims = JSON.parse(Buffer.from(form.get("assertion")!.split(".")[1], "base64url").toString());
      expect(claims.iss).toBe("retl-test@example.test");
      expect(claims.scope).toBe("https://www.googleapis.com/auth/bigquery");
      authorizations++;
      return HttpResponse.json({ access_token: "test-token", expires_in: 3600, token_type: "Bearer" });
    }),
    http.get("https://bigquery.googleapis.com/bigquery/v2/projects/bq-test/datasets/retl", () =>
      HttpResponse.json({ location: "EU" })
    ),
    http.post("https://bigquery.googleapis.com/bigquery/v2/projects/bq-test/jobs", async ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      const body = (await request.json()) as any;
      expect(body.configuration.query.useLegacySql).toBe(false);
      expect(body.jobReference.location).toBe("EU");
      if (body.configuration.dryRun) return HttpResponse.json({ statistics: { query: { schema: { fields } } } });
      jobs.set(body.jobReference.jobId, body.configuration.query.query.includes("__jitsu_retl_key_count"));
      return HttpResponse.json({ jobReference: body.jobReference, status: { state: "RUNNING" } });
    }),
    http.get("https://bigquery.googleapis.com/bigquery/v2/projects/bq-test/queries/:id", ({ params, request }) => {
      expect(new URL(request.url).searchParams.get("formatOptions.useInt64Timestamp")).toBe("true");
      const checked = jobs.get(String(params.id));
      return HttpResponse.json({
        jobComplete: true,
        schema: { fields: checked ? [...fields, { name: "__jitsu_retl_key_count", type: "INTEGER" }] : fields },
        rows: [{ f: [{ v: "9007199254740993" }, { v: "1767225600123456" }, ...(checked ? [{ v: "1" }] : [])] }],
      });
    })
  );
  const { user, workspace } = await seedWorkspace();
  const prisma = deps().prisma;
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const config = {
    destinationType: "bigquery",
    project: "bq-test",
    bqDataset: "retl",
    keyFile: JSON.stringify({
      type: "service_account",
      client_email: "retl-test@example.test",
      private_key: privateKey,
    }),
  };
  const warehouse = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config },
  });
  const model = {
    name: "BQ audience",
    warehouseId: warehouse.id,
    query: "SELECT id, changed FROM source",
    primaryKey: ["id"],
    cursor: { column: "changed", type: "timestamp" },
  };
  const service = new ConfigObjectsService({ prisma });
  const saved = await service.create(user, workspace.id, "model", model, { generateId: true });
  expect((await modelColumns(prisma, workspace.id, saved.id)).columns).toEqual(fields);
  expect((await previewModel(prisma, workspace.id, warehouse.id, model.query)).rows).toEqual([
    { id: "9007199254740993", changed: "2026-01-01T00:00:00.123456Z" },
  ]);
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: { destinationType: "google-ads" } },
  });
  const link = await prisma.configurationObjectLink.create({
    data: {
      workspaceId: workspace.id,
      fromId: saved.id,
      toId: destination.id,
      type: "reverse-sync",
      data: { version: 2, stream: "audience", mode: "upsert", mapping: { email: "id" } },
    },
  });
  const run = await readReverseSync(prisma, link.id, workspace.id);
  expect(run?.warehouse).toEqual(config);
  const reader = createWarehouseReader(run!.warehouse);
  try {
    const rows: SourceRecord[] = [];
    for await (const row of reader.stream(ModelDefinition.parse(run!.model))) rows.push(row);
    expect(rows[0].checkpoint).toEqual({
      value: "2026-01-01T00:00:00.123456Z",
      primaryKeyValues: ["9007199254740993"],
    });
  } finally {
    await reader.close();
  }
  const foreign = await seedWorkspace();
  await prisma.workspace.update({ where: { id: foreign.workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  await expect(previewModel(prisma, foreign.workspace.id, warehouse.id, model.query)).rejects.toMatchObject({
    status: 404,
  });
  expect(authorizations).toBeGreaterThan(0);
});
