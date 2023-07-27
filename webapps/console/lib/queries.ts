import { get, getConfigApi } from "./useApi";
import { DestinationConfig, FunctionConfig, ServiceConfig, StreamConfig } from "./schema";
import { useQuery } from "@tanstack/react-query";

export function linksQuery(workspaceId: string, type: "push" | "sync" = "push", withFunctions: boolean = false) {
  return async () => {
    const promises = [
      type === "sync"
        ? getConfigApi<ServiceConfig>(workspaceId, "service").list()
        : getConfigApi<StreamConfig>(workspaceId, "stream").list(),
      getConfigApi<DestinationConfig>(workspaceId, "destination").list(),
      get(`/api/${workspaceId}/config/link`).then(res =>
        res.links.filter(l => l.type === type || (type === "push" && !l.type))
      ),
    ];
    if (withFunctions) {
      promises.push(getConfigApi<FunctionConfig>(workspaceId, "function").list());
    }
    return await Promise.all(promises);
  };
}

export function useLinksQuery(
  workspaceId: string,
  type: "push" | "sync" = "push",
  options?: {
    withFunctions?: boolean;
    cacheTime?: number;
    retry?: boolean;
  }
) {
  return useQuery<any>(
    ["links", workspaceId, type, options?.withFunctions],
    linksQuery(workspaceId, type, options?.withFunctions),
    options
      ? {
          cacheTime: options.cacheTime,
          retry: options.retry,
        }
      : {}
  );
}
