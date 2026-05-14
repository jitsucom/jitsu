import { ApiClient } from "./api-client";
import { AuthInfo } from "./auth-file";

// Minimal subset of OpenAPI 3 we use. Avoids a runtime dep on openapi-types.
export type OpenApiSpec = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, any> };
};
export type OpenApiOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: any[];
  requestBody?: any;
  responses?: Record<string, any>;
};

export async function fetchSpec(auth: AuthInfo): Promise<OpenApiSpec> {
  // /api/spec is public — no auth required, but reusing the client keeps host handling consistent.
  const client = new ApiClient(auth);
  return client.request<OpenApiSpec>({ method: "GET", path: "/api/spec" });
}

// Resolves the operation that matches a (templated) path + method, e.g.
//   ("/api/{workspaceId}/config/{type}", "post") → operation node with summary/description.
export function findOperation(spec: OpenApiSpec, path: string, method: string): OpenApiOperation | undefined {
  const item = spec.paths?.[path];
  if (!item) return undefined;
  return item[method.toLowerCase()];
}
