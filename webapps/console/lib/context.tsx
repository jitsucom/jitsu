import React, { createContext, PropsWithChildren, useContext } from "react";
import { z } from "zod";
import { AppConfig, ContextApiResponse } from "./schema";
import { WorkspaceDbModel } from "../prisma/schema";
import omit from "lodash/omit";
import { Analytics } from "../pages/_app";
import { WorkspacePermissionsType, WorkspaceRoleType } from "./workspace-roles";

export type WorkspaceContext = z.infer<typeof WorkspaceDbModel> & {
  slugOrId: string;
  oidcLoginGroups?: any[];
};

export type UserWorkspaceRole = {
  role: WorkspaceRoleType;
} & Record<WorkspacePermissionsType, boolean>;

const WorkspaceContext0 = createContext<WorkspaceContext | null>(null);
const WorkspaceRoleContext0 = createContext<UserWorkspaceRole | null>(null);

export const WorkspaceContextProvider: React.FC<{
  workspace: WorkspaceContext;
  userRole: UserWorkspaceRole;
  children: React.ReactNode;
}> = ({ children, workspace, userRole }) => {
  const Context = WorkspaceContext0;
  return (
    <Context.Provider value={workspace}>
      <WorkspaceRoleContext0.Provider value={userRole}>{children}</WorkspaceRoleContext0.Provider>
    </Context.Provider>
  );
};

export function useWorkspace(): WorkspaceContext {
  const context = useContext(WorkspaceContext0);
  if (!context) {
    throw new Error("useWorkspace() must be used within a PageContextProvider");
  }
  return context;
}

const AppConfigContext0 = createContext<AppConfig | null>(null);

export const AppConfigContextProvider: React.FC<{ config: AppConfig; children: React.ReactNode }> = ({
  children,
  config,
}) => {
  return <AppConfigContext0.Provider value={config}> {children} </AppConfigContext0.Provider>;
};

export function useAppConfig(): AppConfig {
  const context = useContext(AppConfigContext0);
  if (!context) {
    throw new Error("useAppConfig() must be used within a AppConfigContextProvider");
  }
  return context;
}

export function getDomains(cfg: AppConfig): { appBase: string; dataDomain: (slug: string) => string } {
  return {
    appBase: `${cfg.publicEndpoints.protocol}://${cfg.publicEndpoints.host}${
      cfg.publicEndpoints.port ? `:${cfg.publicEndpoints.port}` : ""
    }`,
    dataDomain: (slug: string) => {
      return `${cfg.publicEndpoints.protocol}://${slug}.${cfg.publicEndpoints.dataHost}${
        cfg.publicEndpoints.port ? `:${cfg.publicEndpoints.port}` : ""
      }`;
    },
  };
}

export type UserContextProperties = {
  user: ContextApiResponse["user"] | null;
  logout: () => Promise<void>;
};

const UserContext0 = createContext<UserContextProperties>(null!);

export const UserContextProvider: React.FC<PropsWithChildren<UserContextProperties>> = ({ children, ...props }) => {
  const Context = UserContext0;
  return (
    <Context.Provider value={props}>
      {props.user && <Analytics user={props.user} />}
      {children}
    </Context.Provider>
  );
};

export function useUser(): ContextApiResponse["user"] {
  const props = useContext(UserContext0);
  if (!props?.user) {
    throw new Error(`No current user`);
  }
  return props.user;
}

export function useWorkspaceRole(): UserWorkspaceRole {
  const context = useContext(WorkspaceRoleContext0);
  if (!context) {
    return {
      role: "analyst",
      createEntities: false,
      editEntities: false,
      deleteEntities: false,
      manageUsers: false,
    };
  }
  return context;
}

export function useUserSafe(): ContextApiResponse["user"] | undefined | null {
  const props = useContext(UserContext0);
  return props?.user;
}

export function useUserSessionControls(): { logout: () => Promise<void> } {
  const props = useContext(UserContext0);
  if (!props) {
    return { logout: async () => {} };
  }
  return omit(props, "user");
}
