import "./setup";
import type { RouteBuilder } from "../api";
import { route as configIndex } from "../../pages/api/[workspaceId]/config/[type]";
import { route as configById } from "../../pages/api/[workspaceId]/config/[type]/[id]";
import { route as configTest } from "../../pages/api/[workspaceId]/config/[type]/test";
import { route as configLink } from "../../pages/api/[workspaceId]/config/link";
import { route as configProfileBuilder } from "../../pages/api/[workspaceId]/config/profile-builder";
import { route as metrics } from "../../pages/api/[workspaceId]/metrics";
import { route as workspace } from "../../pages/api/workspace/[workspaceIdOrSlug]";
import { route as workspaceList } from "../../pages/api/workspace";
import { route as sourcesSpec } from "../../pages/api/[workspaceId]/sources/spec";
import { route as sourcesDiscover } from "../../pages/api/[workspaceId]/sources/discover";
import { route as sourcesRun } from "../../pages/api/[workspaceId]/sources/run";
import { route as sourcesTasks } from "../../pages/api/[workspaceId]/sources/tasks";
import { route as sourcesLogs } from "../../pages/api/[workspaceId]/sources/logs";

export type PublicRouteEntry = {
  path: string;
  route: RouteBuilder;
};

export const publicRoutes: PublicRouteEntry[] = [
  { path: "/api/{workspaceId}/config/{type}", route: configIndex },
  { path: "/api/{workspaceId}/config/{type}/{id}", route: configById },
  { path: "/api/{workspaceId}/config/{type}/test", route: configTest },
  { path: "/api/{workspaceId}/config/link", route: configLink },
  { path: "/api/{workspaceId}/config/profile-builder", route: configProfileBuilder },
  { path: "/api/{workspaceId}/metrics", route: metrics },
  { path: "/api/workspace/{workspaceIdOrSlug}", route: workspace },
  { path: "/api/workspace", route: workspaceList },
  { path: "/api/{workspaceId}/sources/spec", route: sourcesSpec },
  { path: "/api/{workspaceId}/sources/discover", route: sourcesDiscover },
  { path: "/api/{workspaceId}/sources/run", route: sourcesRun },
  { path: "/api/{workspaceId}/sources/tasks", route: sourcesTasks },
  { path: "/api/{workspaceId}/sources/logs", route: sourcesLogs },
];

export function getPublicRoutes(): PublicRouteEntry[] {
  return publicRoutes;
}
