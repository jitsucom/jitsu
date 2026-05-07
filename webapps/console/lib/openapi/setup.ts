import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

let extended = false;

export function ensureZodOpenApiExtended() {
  if (!extended) {
    extendZodWithOpenApi(z);
    extended = true;
  }
}

ensureZodOpenApiExtended();
