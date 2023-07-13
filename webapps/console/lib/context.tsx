import { createContext, PropsWithChildren, useContext } from "react";
import { z } from "zod";
import { AppConfig, ContextApiResponse } from "./schema";
import { WorkspaceDbModel } from "../prisma/schema";
import omit from "lodash/omit";

export type WorkspaceContext = z.infer<typeof WorkspaceDbModel> & {
  slugOrId: string;
};

const WorkspaceContext0 = createContext<WorkspaceContext | null>(null);

export const WorkspaceContextProvider: React.FC<{ workspace: WorkspaceContext; children: React.ReactNode }> = ({
  children,
  workspace,
}) => {
  const Context = WorkspaceContext0;
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
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
  return <Context.Provider value={props}>{children}</Context.Provider>;
};

export function useUser(): ContextApiResponse["user"] {
  const props = useContext(UserContext0);
  if (!props?.user) {
    throw new Error(`No current user`);
  }
  return props.user;
}

export function useUserSessionControls(): { logout: () => Promise<void> } {
  const props = useContext(UserContext0);
  if (!props) {
    throw new Error(`useUserSessionControls() should be called inside <UserContextProvider /> `);
  }
  return omit(props, "user");
}
