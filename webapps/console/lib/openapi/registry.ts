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
];

export function getPublicRoutes(): PublicRouteEntry[] {
  return publicRoutes;
}
