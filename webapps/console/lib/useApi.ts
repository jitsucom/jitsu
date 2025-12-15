import { ZodType } from "zod";
import { useQuery } from "@tanstack/react-query";
import { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { ApiResponseError, getCached, rpc, RpcFunc, tryJson } from "juava";
import { useWorkspace } from "./context";
import { safeParseWithDate } from "./zod";
import { EventsLogFilter, EventsLogRecord } from "./server/events-log";
import { DeadLetterFilter, DeadLetterRecord } from "./server/dead-letter";

export type ConfigApiDeleteOptions = {
  strict?: boolean;
  cascade?: boolean;
};

export type ConfigApi<T = any> = {
  get(id: string): Promise<T>;
  create(obj: T): Promise<T>;
  update(id: string, obj: Partial<T>): Promise<T>;
  test(obj: Partial<T>): Promise<any>;
  del(id: string, options?: ConfigApiDeleteOptions): Promise<T>;
  list(): Promise<T[]>;
};

export type EventsLogApi = {
  get(
    eventType: string,
    levels: ("warn" | "info" | "error" | "debug")[] | "all",
    actorId: string,
    filter: EventsLogFilter,
    limit: number,
    search?: string
  ): Promise<EventsLogRecord[]>;
};

export function useEventsLogApi(): EventsLogApi {
  const workspace = useWorkspace();
  return getCached("events-log-api", w => getEventsLogApi(w), workspace.id);
}

export function getEventsLogApi(workspaceId: string): EventsLogApi {
  return {
    get(
      eventType: string,
      levels: ("warn" | "info" | "error" | "debug")[] | "all",
      actorId: string,
      filter: EventsLogFilter,
      limit: number,
      search?: string
    ): Promise<EventsLogRecord[]> {
      return rpc(
        `/api/${workspaceId}/log/${eventType}/${actorId}?limit=${limit}${
          filter.start ? "&start=" + filter.start.toISOString() : ""
        }${filter.end ? "&end=" + filter.end.toISOString() : ""}${
          levels !== "all" ? `&levels=${levels.join(",")}` : ""
        }${search ? `&search=${encodeURIComponent(search)}` : ""}`
      );
    },
  };
}

export type DeadLetterApi = {
  get(
    actorId: string | "all",
    filter: DeadLetterFilter,
    limit: number,
    type?: string,
    search?: string
  ): Promise<DeadLetterRecord[]>;
};

export function useDeadLetterApi(): DeadLetterApi {
  const workspace = useWorkspace();
  return getCached("dead-letter-api", w => getDeadLetterApi(w), workspace.id);
}

export function getDeadLetterApi(workspaceId: string): DeadLetterApi {
  return {
    get(
      actorId: string | "all",
      filter: DeadLetterFilter,
      limit: number,
      type?: string,
      search?: string
    ): Promise<DeadLetterRecord[]> {
      return rpc(
        `/api/${workspaceId}/dead-letter/${actorId}?limit=${limit}${
          filter.start ? "&start=" + filter.start.toISOString() : ""
        }${filter.end ? "&end=" + filter.end.toISOString() : ""}${type ? `&type=${encodeURIComponent(type)}` : ""}${
          search ? `&search=${encodeURIComponent(search)}` : ""
        }`
      );
    },
  };
}

/**
 * For backward compatibility
 */
export const get: RpcFunc = rpc;

export function useConfigApi<T = any>(type: string): ConfigApi<T> {
  const workspace = useWorkspace();
  return getCached("config-api", (w, type) => getConfigApi(w, type), workspace.id, type);
}

export function getConfigApi<T = any>(workspaceId: string, type: string): ConfigApi<T> {
  return {
    get(id: string): Promise<T> {
      return rpc(`/api/${workspaceId}/config/${type}/${id}`);
    },
    list(): Promise<T[]> {
      return rpc(`/api/${workspaceId}/config/${type}`).then(res => res.objects);
    },
    create: async obj => {
      return rpc(`/api/${workspaceId}/config/${type}`, {
        method: "POST",
        body: obj,
      });
    },
    update: async (id, obj) => {
      return rpc(`/api/${workspaceId}/config/${type}/${id}`, {
        method: "PUT",
        body: obj,
      });
    },
    test: async obj => {
      return rpc(`/api/${workspaceId}/config/${type}/test`, {
        method: "POST",
        body: obj,
      });
    },
    del: async (id, options) => {
      const queryParams: string[] = [];
      if (options?.strict) {
        queryParams.push("strict=true");
      }
      if (options?.cascade) {
        queryParams.push("cascade=true");
      }
      const queryString = queryParams.length > 0 ? "?" + queryParams.join("&") : "";
      return rpc(`/api/${workspaceId}/config/${type}/${id}${queryString}`, {
        method: "DELETE",
      });
    },
  };
}

type UseApiOpts<Req, Res, Query> = {
  body?: Req;
  bodyType?: ZodType<Req>;
  outputType?: ZodType<Res>;
  query?: Query;
  queryType?: ZodType<Query>;
  method?: string;
  mockResponse?: Res;
};

export function useApi<Res = any, Req = any, Query extends Record<string, any> = Record<string, any>>(
  url: string,
  opts?: UseApiOpts<Req, Res, Query>
): UseQueryResult<Res, Error> & { reload: () => void } {
  const method = opts?.method || (opts?.body ? "POST" : "GET");
  const [version, setVersion] = useState(0);
  const queryResult: UseQueryResult<Res, Error> = useQuery(
    [method, url, opts?.query || {}, opts?.body || {}, version],
    async () => {
      if (opts?.mockResponse) {
        return opts?.mockResponse;
      }
      const request = {
        method,
        queryParams: opts?.query || {},
        body: opts?.body || undefined,
      };
      const rawResult = await get(url, request);
      if (!opts?.outputType) {
        return rawResult;
      }
      const zodParsed = safeParseWithDate(opts?.outputType, rawResult);
      if (!zodParsed.success) {
        throw new ApiResponseError(
          `Error parsing response from ${method} ${url}`,
          { responseObject: rawResult, zodError: zodParsed.error },
          { url, ...request, body: opts?.body ? tryJson(opts?.body) : undefined }
        );
      }
      return zodParsed.data;
    },
    { retry: false, cacheTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnMount: false }
  );
  return { ...queryResult, reload: () => setVersion(version + 1) };
}

function queryString(query?: Record<string, any>) {
  if (!query || Object.keys(query).length === 0) {
    return "";
  } else {
    return (
      "?" +
      Object.entries(query)
        .map(([name, val]) => `${name}=${encodeURIComponent(val)}`)
        .join("&")
    );
  }
}
