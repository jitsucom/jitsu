import { z, ZodObject, ZodTypeAny } from "zod";
import { RouteConfig } from "@asteasolutions/zod-to-openapi";
import type { HttpMethodType } from "../api";
import { RouteOpenApiFragment, StoredMethodSpec } from "./types";

const httpMethodToOpenApi: Record<HttpMethodType, RouteConfig["method"]> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  DELETE: "delete",
  PATCH: "patch",
  OPTIONS: "options",
};

export function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    params.push(m[1]);
  }
  return params;
}

function isZodObject(schema: ZodTypeAny | undefined): schema is ZodObject<any> {
  return !!schema && (schema as any)._def?.typeName === "ZodObject";
}

function pickFromObject(schema: ZodObject<any>, keys: string[]): ZodObject<any> | undefined {
  const shape = schema.shape;
  const picked: Record<string, ZodTypeAny> = {};
  let any = false;
  for (const k of keys) {
    if (shape[k]) {
      picked[k] = shape[k];
      any = true;
    }
  }
  if (!any) return undefined;
  return z.object(picked);
}

function omitFromObject(schema: ZodObject<any>, keys: string[]): ZodObject<any> | undefined {
  const shape = schema.shape;
  const remaining: Record<string, ZodTypeAny> = {};
  let any = false;
  for (const k of Object.keys(shape)) {
    if (!keys.includes(k)) {
      remaining[k] = shape[k];
      any = true;
    }
  }
  if (!any) return undefined;
  return z.object(remaining);
}

function ensureStringPathParams(schema: ZodObject<any>): ZodObject<any> {
  // OpenAPI path params must be present and required. Force-string the schema
  // so coercion in handler doesn't leak through to the spec.
  const shape = schema.shape;
  const out: Record<string, ZodTypeAny> = {};
  for (const k of Object.keys(shape)) {
    out[k] = z.string();
  }
  return z.object(out);
}

function buildSingleOperation(opts: {
  method: HttpMethodType;
  path: string;
  spec: StoredMethodSpec;
  excludePathParam?: string;
}): RouteConfig {
  const { method, path, spec, excludePathParam } = opts;
  const pathParamNames = extractPathParams(path);

  let pathSchema: ZodObject<any> | undefined;
  let querySchema: ZodObject<any> | undefined;

  if (isZodObject(spec.query)) {
    const queryAsObj = spec.query as ZodObject<any>;
    const pickedPath = pickFromObject(queryAsObj, pathParamNames);
    pathSchema = pickedPath ? ensureStringPathParams(pickedPath) : undefined;
    const omitKeys = [...pathParamNames];
    if (excludePathParam) omitKeys.push(excludePathParam);
    querySchema = omitFromObject(queryAsObj, omitKeys);
  }

  // Always emit path params even if the query isn't a ZodObject (e.g. ZodUnion).
  if (!pathSchema && pathParamNames.length > 0) {
    const visibleParams = pathParamNames.filter(p => p !== excludePathParam);
    if (visibleParams.length > 0) {
      const shape: Record<string, ZodTypeAny> = {};
      for (const k of visibleParams) shape[k] = z.string();
      pathSchema = z.object(shape);
    }
  }

  const responses: RouteConfig["responses"] = {};
  if (spec.streaming) {
    responses["200"] = { description: "Streaming response" };
  } else if (spec.result) {
    const content: any = {
      "application/json": {
        schema: spec.result,
        ...(spec.resultExample !== undefined ? { example: spec.resultExample } : {}),
      },
    };
    responses["200"] = { description: "OK", content };
  } else {
    responses["200"] = {
      description: "OK",
      content: { "application/json": { schema: z.any() } },
    };
  }
  if (spec.auth) {
    responses["401"] = { description: "Authorization required" };
  }
  responses["400"] = { description: "Bad request" };
  responses["500"] = { description: "Internal server error" };

  const requestBody = spec.body
    ? {
        required: true,
        content: {
          "application/json": {
            schema: spec.body,
            ...(spec.bodyExample !== undefined ? { example: spec.bodyExample } : {}),
          },
        },
      }
    : undefined;

  const config: RouteConfig = {
    method: httpMethodToOpenApi[method],
    path,
    summary: spec.summary,
    description: spec.description,
    tags: spec.tags,
    request: {
      params: pathSchema,
      query: querySchema,
      body: requestBody,
    },
    responses,
    ...(spec.auth ? { security: [{ bearerAuth: [] }] } : {}),
  };

  return config;
}

function applyExpansion(spec: StoredMethodSpec, value: string): StoredMethodSpec {
  if (!spec.expand) return spec;
  const overrides = spec.expand.forValue(value) || {};
  return {
    ...spec,
    summary: overrides.summary ?? spec.summary,
    description: overrides.description ?? spec.description,
    tags: overrides.tags ?? spec.tags,
    body: overrides.body ?? spec.body,
    result: overrides.result ?? spec.result,
    bodyExample: overrides.bodyExample ?? spec.bodyExample,
    resultExample: overrides.resultExample ?? spec.resultExample,
  };
}

export function buildRouteFragment(
  basePath: string,
  specByMethod: Partial<Record<HttpMethodType, StoredMethodSpec>>
): RouteOpenApiFragment {
  const routes: RouteConfig[] = [];

  for (const [methodKey, methodSpec] of Object.entries(specByMethod)) {
    if (!methodSpec) continue;
    const method = methodKey as HttpMethodType;
    if (methodSpec.expand) {
      const exp = methodSpec.expand;
      for (const value of exp.values) {
        const expandedPath = basePath.replace(`{${exp.param}}`, value);
        const expandedSpec = applyExpansion(methodSpec, value);
        routes.push(
          buildSingleOperation({
            method,
            path: expandedPath,
            spec: expandedSpec,
            excludePathParam: exp.param,
          })
        );
      }
    } else {
      routes.push(buildSingleOperation({ method, path: basePath, spec: methodSpec }));
    }
  }

  return { routes };
}
