import { ZodType, ZodObject, ZodTypeAny } from "zod";
import { RouteConfig } from "@asteasolutions/zod-to-openapi";

export type OpenApiMethodMeta = {
  summary?: string;
  description?: string;
  tags?: string[];
  bodyExample?: any;
  resultExample?: any;
};

export type ExpandSpec<TQuery extends ZodObject<any> = ZodObject<any>> = {
  param: string;
  values: string[];
  forValue: (value: string) => Partial<{
    summary: string;
    description: string;
    tags: string[];
    body: ZodType<any>;
    result: ZodType<any>;
    bodyExample: any;
    resultExample: any;
  }>;
};

export type StoredMethodSpec = {
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  result?: ZodTypeAny;
  auth?: boolean;
  streaming?: boolean;
  summary?: string;
  description?: string;
  tags?: string[];
  bodyExample?: any;
  resultExample?: any;
  expand?: ExpandSpec;
};

export type RouteOpenApiFragment = {
  routes: RouteConfig[];
};
