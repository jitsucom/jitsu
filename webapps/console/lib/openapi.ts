import { Api } from "./api";
import * as workspace from "../pages/api/workspace/[workspaceIdOrSlug]";

export type OpenapiExport = {
  apis: Api[];
};

const openapiExport: OpenapiExport = {
  apis: [workspace.api],
};

export function generateOpenApiSpec() {
  return {};
}
