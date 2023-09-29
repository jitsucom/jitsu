import { getErrorMessage } from "./error";

export function tryJson(res: any) {
  if (typeof res === "string") {
    try {
      return JSON.parse(res);
    } catch (e) {
      return res;
    }
  }
  return res;
}

async function parseJsonResponse(result: Response, method: string, url: string) {
  const text = await result.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const message = `Error parsing JSON (len=${text.length}) from ${method} ${url}: ${getErrorMessage(e)}`;
    console.log(`${message}. Full response:`, text);
    throw new Error(`${message}. See console for full response.`);
  }
}

export function urlWithQueryString(url: string, query: Record<string, any>, opts: { filterUndefined?: boolean } = {}) {
  return `${url}?${Object.entries(query)
    .filter(([, v]) => (opts.filterUndefined ? v !== undefined : true))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;
}

function notEmpty(param): boolean {
  return param !== undefined && param !== null && Object.keys(param).length > 0;
}

export class ApiResponseError extends Error {
  public response: object;
  public request: object;

  constructor(message: string, response: object, request: object) {
    super(message + ": " + JSON.stringify(response));
    this.response = response;
    this.request = request;
  }
}

export type RpcParams<Query = Record<string, any>, Payload = any> = Omit<RequestInit, "method" | "body"> & {
  method?: string;
  body?: Payload;
  query?: Query;
};

type FetchType = typeof fetch;

export interface RpcFunc<Result = any, Query = Record<string, any>, Payload = any> {
  (url: string, params?: RpcParams<Query, Payload>): Promise<Result>;

  useFetch(fetchImpl: FetchType);
}

export const rpc: RpcFunc = async (url, { body, ...rest } = {}) => {
  const urlWithQuery = notEmpty(rest?.query) ? urlWithQueryString(url, rest?.query || {}) : url;

  const method = rest.method || (body ? "POST" : "GET");
  let result: Response;
  const requestParams = {
    method: method,
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  };
  const fetchImpl = getFetch();
  try {
    result = await fetchImpl(urlWithQuery, requestParams);
  } catch (e) {
    throw new Error(`Error calling ${method} ${url}: ${getErrorMessage(e)}`);
  }

  const getErrorText = async (result: Response) => {
    try {
      return await result.text();
    } catch (e) {
      return "Unknown error";
    }
  };

  if (!result.ok) {
    let errorText = await getErrorText(result);
    const errorJson = tryJson(errorText);
    const message = `Error ${result.status} on ${method} ${url}`;
    console.error(message, errorJson);
    throw typeof errorJson === "string"
      ? new Error(`${message}: ${errorJson}`)
      : new ApiResponseError(message, errorJson, {
          url: urlWithQuery,
          ...requestParams,
          body: body || undefined,
        });
  }
  if ((result.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return await parseJsonResponse(result, method, url);
  } else {
    return await result.text();
  }
};
let rpcFetchImpl: FetchType | undefined;

rpc.useFetch = impl => {
  rpcFetchImpl = impl;
};

function getFetch() {
  if (rpcFetchImpl) {
    return rpcFetchImpl;
  } else if (global.fetch) {
    return global.fetch;
  } else {
    throw new Error("No fetch implementation found. Use rpc.useFetch() to set one.");
  }
}
