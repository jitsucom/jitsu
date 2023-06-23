import { get, getConfigApi } from "./useApi";
import { DestinationConfig, ServiceConfig, StreamConfig } from "./schema";
import { useQuery } from "@tanstack/react-query";

export function linksQuery(workspaceId: string, type: "push" | "sync" = "push") {
  return async () => {
    return await Promise.all([
      type === "sync"
        ? getConfigApi<ServiceConfig>(workspaceId, "service").list()
        : getConfigApi<StreamConfig>(workspaceId, "stream").list(),
      getConfigApi<DestinationConfig>(workspaceId, "destination").list(),
      get(`/api/${workspaceId}/config/link`).then(res =>
        res.links.filter(l => l.type === type || (type === "push" && !l.type))
      ),
    ]);
  };
}

export function useLinksQuery(
  workspaceId: string,
  type: "push" | "sync" = "push",
  options?: {
    cacheTime?: number;
    retry?: boolean;
  }
) {
  return useQuery<any>(
    ["links", workspaceId, type],
    linksQuery(workspaceId, type),
    options
      ? {
          cacheTime: options.cacheTime,
          retry: options.retry,
        }
      : {}
  );
}
