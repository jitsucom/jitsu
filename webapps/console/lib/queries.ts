import { get, getConfigApi } from "./useApi";
import { DestinationConfig, StreamConfig } from "./schema";
import { useQuery } from "@tanstack/react-query";

export function streamDestinationLinkQuery(workspaceId: string) {
  return async () => {
    return await Promise.all([
      getConfigApi<StreamConfig>(workspaceId, "stream").list(),
      getConfigApi<DestinationConfig>(workspaceId, "destination").list(),
      get(`/api/${workspaceId}/config/link`).then(res => res.links),
    ]);
  };
}

export function useStreamDestinationLinksQuery(
  workspaceId: string,
  options?: {
    cacheTime?: number;
    retry?: boolean;
  }
) {
  return useQuery<any>(
    ["streamDestinationLinks", workspaceId],
    streamDestinationLinkQuery(workspaceId),
    options
      ? {
          cacheTime: options.cacheTime,
          retry: options.retry,
        }
      : {}
  );
}
