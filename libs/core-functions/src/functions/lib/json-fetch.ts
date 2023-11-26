import { FetchOpts, FetchType } from "@jitsu/protocols/functions";

export type JsonFetchOpts = Omit<FetchOpts, "body"> & {
  body?: any;
};

export type JsonFetcher = (url: string, options?: JsonFetchOpts) => Promise<any>;

const maxResponseLen = 100;

export function jsonFetcher(fetch: FetchType): JsonFetcher {
  return async (url: string, options?: JsonFetchOpts) => {
    const response = await fetch(url, {
      ...(options || {}),
      method: options?.method || (options?.body ? "POST" : "GET"),
      body:
        typeof options?.body === "string" ? options?.body : options?.body ? JSON.stringify(options?.body) : undefined,
    });
    if (!response.ok) {
      let responseText = await response.text();
      if (responseText.length > maxResponseLen) {
        responseText =
          responseText.substring(0, maxResponseLen) + "...(truncated, total length: " + responseText.length + ")";
      }
      throw new Error(
        `Request to ${url} failed with status ${response.status} ${response.statusText}: ${responseText}`
      );
    }
    return await response.json();
  };
}
