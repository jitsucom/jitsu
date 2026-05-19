import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import "../lib/openapi/setup";
import { buildRouteFragment, extractPathParams } from "../lib/openapi/routeSpec";
import { StoredMethodSpec } from "../lib/openapi/types";

describe("extractPathParams", () => {
  it("extracts {name} placeholders", () => {
    expect(extractPathParams("/api/{workspaceId}/config/{type}/{id}")).toEqual(["workspaceId", "type", "id"]);
  });
  it("returns empty for static paths", () => {
    expect(extractPathParams("/api/spec")).toEqual([]);
  });
});

describe("buildRouteFragment", () => {
  it("emits one operation per method when no expand", () => {
    const spec: StoredMethodSpec = {
      auth: true,
      query: z.object({ workspaceId: z.string() }),
      result: z.object({ ok: z.boolean() }),
      summary: "List things",
      tags: ["thing"],
    };
    const fragment = buildRouteFragment("/api/{workspaceId}/things", { GET: spec });
    expect(fragment.routes).toHaveLength(1);
    expect(fragment.routes[0].method).toBe("get");
    expect(fragment.routes[0].path).toBe("/api/{workspaceId}/things");
    expect(fragment.routes[0].summary).toBe("List things");
    expect(fragment.routes[0].security).toEqual([{ bearerAuth: [] }]);
    expect(fragment.routes[0].request?.params).toBeDefined();
    expect(fragment.routes[0].request?.query).toBeUndefined();
  });

  it("emits N operations when expand has N values", () => {
    const types = ["destination", "stream", "function"];
    const spec: StoredMethodSpec = {
      auth: true,
      query: z.object({ workspaceId: z.string(), type: z.string() }),
      summary: "List config",
      expand: {
        param: "type",
        values: types,
        forValue: t => ({
          summary: `List ${t}`,
          tags: [t],
          result: z.object({ objects: z.array(z.object({ id: z.string() })) }),
        }),
      },
    };
    const fragment = buildRouteFragment("/api/{workspaceId}/config/{type}", { GET: spec });
    expect(fragment.routes).toHaveLength(types.length);
    for (let i = 0; i < types.length; i++) {
      const r = fragment.routes[i];
      const t = types[i];
      expect(r.path).toBe(`/api/{workspaceId}/config/${t}`);
      expect(r.summary).toBe(`List ${t}`);
      expect(r.tags).toEqual([t]);
      // {type} should be removed from path params now that it's a literal
      const params: any = r.request?.params;
      expect(params?.shape?.type).toBeUndefined();
      expect(params?.shape?.workspaceId).toBeDefined();
    }
  });

  it("falls back to a default path schema for non-ZodObject queries", () => {
    const spec: StoredMethodSpec = {
      auth: false,
      query: z.union([
        z.object({ workspaceId: z.string(), id: z.string() }),
        z.object({ workspaceId: z.string(), other: z.string() }),
      ]) as any,
      summary: "Union query",
    };
    const fragment = buildRouteFragment("/api/{workspaceId}/x", { DELETE: spec });
    expect(fragment.routes).toHaveLength(1);
    const params: any = fragment.routes[0].request?.params;
    expect(params?.shape?.workspaceId).toBeDefined();
  });

  it("integrates into a full OpenAPI document", () => {
    const registry = new OpenAPIRegistry();
    registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer" });
    const spec: StoredMethodSpec = {
      auth: true,
      query: z.object({ workspaceId: z.string() }),
      body: z.object({ name: z.string() }),
      result: z.object({ id: z.string() }),
      summary: "Create thing",
      tags: ["thing"],
    };
    const fragment = buildRouteFragment("/api/{workspaceId}/things", { POST: spec });
    fragment.routes.forEach(r => registry.registerPath(r));
    const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      security: [{ bearerAuth: [] }],
    });
    expect(doc.paths?.["/api/{workspaceId}/things"]?.post).toBeDefined();
    const op: any = doc.paths!["/api/{workspaceId}/things"].post;
    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(op.requestBody.content["application/json"].schema).toBeDefined();
  });
});
