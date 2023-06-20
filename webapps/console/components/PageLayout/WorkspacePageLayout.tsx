import { PropsWithChildren, ReactNode, useEffect, useState } from "react";
import { branding } from "../../lib/branding";
import { HiSelector } from "react-icons/hi";
import { FaSignOutAlt, FaUserCircle } from "react-icons/fa";
import { FiSettings } from "react-icons/fi";
import { Button, Drawer, Dropdown, Menu } from "antd";
import MenuItem from "antd/lib/menu/MenuItem";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  ChevronUp,
  FilePlus,
  Folders,
  FunctionSquare,
  Globe,
  LayoutDashboard,
  Loader2,
  Server,
  ServerCog,
  Settings,
  Share2,
  ShieldAlert,
} from "lucide-react";

import { NextRouter, useRouter } from "next/router";
import Link from "next/link";
import { WLink } from "../Workspace/WLink";
import { getDomains, useAppConfig, useUser, useUserSessionControls, useWorkspace } from "../../lib/context";
import { get, useApi } from "../../lib/useApi";

import { Overlay } from "../Overlay/Overlay";
import { WorkspaceNameAndSlugEditor } from "../WorkspaceNameAndSlugEditor/WorkspaceNameAndSlugEditor";
import { getLog, requireDefined } from "juava";
import classNames from "classnames";
import { getEeClient } from "../../lib/ee-client";
import { BillingBlockingDialog } from "../Billing/BillingBlockingDialog";
import { signOut } from "next-auth/react";
import { firebaseSignOut } from "../../lib/firebase-client";
import { feedbackError } from "../../lib/ui";
import { MenuItemType } from "antd/es/menu/hooks/useItems";
import { useClassicProject } from "./ClassicProjectProvider";
import { useJitsu } from "@jitsu/jitsu-react";
import { useSearchParams } from "next/navigation";
import omit from "lodash/omit";

export type PageLayoutProps = {
  fullscreen?: boolean;
  onClose?: () => void;
  className?: string;
  doNotBlockIfUsageExceeded?: boolean;
};

export type WorkspaceSelectorProps = {
  currentTitle: ReactNode;
};

export const WorkspaceMenu: React.FC<{ closeMenu: () => void; classicProject?: string; classicToken?: string }> = ({
  classicToken,
}) => {
  const appConfig = useAppConfig();
  return (
    <div className="bg-backgroundLight rounded shadow">
      <div className="border-t border-textDisabled px-4 py-2 flex flex-col">
        {classicToken && (
          <Link
            key={"classic"}
            href={`${appConfig.jitsuClassicUrl}/?token=${classicToken}`}
            target={"_blank"}
            rel={"noopener noreferrer"}
            className="cursor-pointer"
          >
            <Button
              type={"dashed"}
              className={"w-full mt-1.5"}
              icon={<span className={"anticon w-4 h-4"}>{branding.classicLogo}</span>}
            >
              Switch to Jitsu Classic
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
};

function AdminMenuItems() {
  const { data, error } = useApi(`/user/properties`);
  if (error) {
    log.atWarn().log("Failed to load user properties", error);
  } else if (data) {
    return (
      <MenuItem icon={<ShieldAlert className="h-4 w-4 mr-2" />}>
        <Link href="/admin/users">Admin Users</Link>
      </MenuItem>
    );
  }
  return <></>;
}

function WorkspacesMenu(props: { jitsuClassicAvailable: boolean }) {
  const router = useRouter();
  const [classicLoading, setClassicLoading] = useState(false);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const { data, error } = useApi(`/api/user/properties`);
  let additionalMenuItems: MenuItemType[] = [];
  if (error) {
    log.atWarn().log("Failed to load user properties", error);
  } else if (data?.admin) {
    additionalMenuItems = [
      {
        key: "admin-users",
        label: "Admin Users",
        icon: <ShieldAlert className="h-4 w-4 mr-2" />,
        onClick: async () => {
          await router.push("/admin/users");
        },
      },
    ];
  }

  return (
    <Menu
      items={[
        {
          key: "all-workspaces",
          label: "View all workspaces",
          icon: workspacesLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Folders className="h-4 w-4 mr-2" />
          ),
          onClick: async () => {
            setWorkspacesLoading(true);
            try {
              await router.push("/workspaces");
            } finally {
              setWorkspacesLoading(false);
            }
          },
        },
        {
          key: "new-workspace",
          label: "Create new workspace",
          icon: adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePlus className="h-4 w-4 mr-2" />,
          onClick: async () => {
            setAdding(true);
            try {
              const { id } = await get("/api/workspace", { method: "POST", body: {} });
              await router.push(`/${id}`);
            } catch (e) {
              feedbackError(`Can't create new workspace`, { error: e });
            } finally {
              setAdding(false);
            }
          },
        },
        ...(props.jitsuClassicAvailable
          ? [
              {
                key: "switch",
                label: "Switch to Jitsu Classic",
                icon: classicLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                ),
                onClick: async () => {
                  setClassicLoading(true);
                  try {
                    const eeClient = getEeClient(
                      requireDefined(appConfig.ee.host, `EE is not available`),
                      workspace.id
                    );
                    const customToken = await eeClient.createCustomToken();
                    window.location.href = `${appConfig.jitsuClassicUrl}/?token=${customToken}`;
                  } catch (e) {
                    feedbackError(`Can't navigate to Jitsu.Classic`, { error: e });
                  } finally {
                    //setClassicLoading(false);
                  }
                },
              },
            ]
          : []),
        ...additionalMenuItems,
      ]}
    />
  );
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = props => {
  const [open, setOpen] = useState(false);
  const classicProject = useClassicProject();

  return (
    <Dropdown
      dropdownRender={() => (
        <WorkspacesMenu jitsuClassicAvailable={classicProject.active && !!classicProject.project} />
      )}
      trigger={["click"]}
      open={open}
      onOpenChange={open => setOpen(open)}
    >
      <div className="flex items-center cursor-pointer hover:bg-backgroundDark px-2.5 py-1.5 rounded">
        <div>{props.currentTitle}</div>
        <HiSelector />
      </div>
    </Dropdown>
  );
};

type TabsMenuItem = {
  title: ReactNode;
  icon: ReactNode;
  path: string;
  aliases?: string[] | string;
  hidden?: boolean;
};
export type TopTabsMenuProps = {
  items: TabsMenuItem[];
};

function isSelected(item: { title: React.ReactNode; path: string; aliases?: string[] | string }, router: NextRouter) {
  let workspacePath = router.pathname.replace("/[workspaceId]", "");
  if (workspacePath === "") {
    workspacePath = "/";
  }

  return item.path === workspacePath || item.aliases === workspacePath || item.aliases?.includes(workspacePath);
}

export const TopTabsMenu: React.FC<TopTabsMenuProps> = props => {
  const router = useRouter();

  return (
    <div className="flex justify-between">
      <div className="flex">
        {props.items
          .filter(i => !i.hidden)
          .map(item => {
            const selected = isSelected(item, router);
            return (
              <div key={item.path} className="pr-0 cursor-pointer ">
                <div
                  className={`py-1.5 px-3 lg:py-2 lg:px-4 mb-2 ${
                    selected ? "bg-neutral-200 rounded-lg lg:rounded-xl" : ""
                  }`}
                >
                  <WLink href={item.path}>
                    <span
                      className={`flex flex-nowrap items-center hover:text-neutral-800 ${
                        selected ? "text-neutral-800" : "text-neutral-500"
                      }`}
                    >
                      <div className="mr-1 h-4 w-4">{item.icon}</div>
                      {item.title}
                    </span>
                  </WLink>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

function Breadcrumbs() {
  const workspace = useWorkspace();
  return (
    <div className="flex py-4 items-center">
      <div className="w-8 h-8">{branding.logo}</div>
      <div className="pl-2 w-8 h-8 text-textLight">
        <svg fill="none" height="100%" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="100%">
          <path d="M16.88 3.549L7.12 20.451" />
        </svg>
      </div>
      <div>
        <WorkspaceSelector currentTitle={workspace.name} />
      </div>
    </div>
  );
}

function UserProfileMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const sessionControl = useUserSessionControls();
  return (
    <div>
      <Menu>
        <div className="px-8 py-2 text-center">
          <div className="font-bold whitespace-nowrap">{user.name}</div>
          <div>{user.email}</div>
        </div>
        <Menu.Divider />
        <MenuItem onClick={() => router.push("/user")}>
          <ButtonLabel icon={<FiSettings />}>Settings</ButtonLabel>
        </MenuItem>
        <MenuItem
          onClick={async () => {
            await sessionControl.logout();
            router.push("/", undefined, { shallow: true });
          }}
        >
          <ButtonLabel icon={<FaSignOutAlt />}>Logout</ButtonLabel>
        </MenuItem>
      </Menu>
    </div>
  );
}

const UserProfileButton: React.FC<{}> = () => {
  const user = useUser();
  return (
    <Dropdown
      dropdownRender={() => (
        <UserProfileMenu
          user={{
            email: user.email,
            name: user.name,
          }}
        />
      )}
      placement="bottomLeft"
      arrow
      trigger={["click"]}
    >
      <div className="h-8 w-8 cursor-pointer">
        {user.image && user.image.indexOf("googleusercontent.com/") < 0 ? (
          <img className="rounded-full w-8 h-8" src={user.image} about="userpic" alt="" width="100" height="100" />
        ) : (
          <FaUserCircle className="text-primary w-full h-full" />
        )}
      </div>
    </Dropdown>
  );
};

function PageHeader() {
  const appConfig = useAppConfig();
  const items: TabsMenuItem[] = [
    { title: "Overview", path: "/", aliases: "/overview", icon: <LayoutDashboard className="w-full h-full" /> },
    { title: "Sites", path: "/streams", icon: <Globe className="w-full h-full" /> },
    { title: "Destinations", path: "/destinations", icon: <Server className="w-full h-full" /> },
    { title: "Connections", path: "/connections", icon: <Share2 className="w-full h-full" /> },
    { title: "Functions", path: "/functions", icon: <FunctionSquare className="w-full h-full" /> },
    { title: "Services", path: "/services", icon: <ServerCog className="w-full h-full" /> },
    { title: "Live Events", path: "/data", icon: <Activity className="w-full h-full" /> },
    { title: "Query Data", path: "/sql", icon: <BarChart3 className="w-full h-full" />, hidden: !appConfig?.ee },
    {
      title: "Settings",
      path: "/settings",
      icon: <Settings className="w-full h-full" />,
    },
  ];
  return (
    <div>
      <div className="w-full">
        <div className="flex justify-between items-center pl-3">
          <Breadcrumbs />
          <UserProfileButton />
        </div>
        <TopTabsMenu items={items} />
      </div>
    </div>
  );
}

const WorkspaceSettingsModal: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const cfg = useAppConfig();
  const domains = getDomains(cfg);
  const { analytics } = useJitsu();
  const { push, query } = useRouter();
  const searchParams = useSearchParams();
  const welcome = searchParams.get("welcome");

  useEffect(() => {
    if (welcome) {
      analytics.track("sign_up");
      push({ query: { ...omit(query, "welcome") } });
    }
  }, [welcome, analytics, push, query]);

  const dataIngestion = (
    <>
      {cfg.publicEndpoints.protocol}://<span className="text-textDark">yourslug</span>.{cfg.publicEndpoints.dataHost}
      {cfg.publicEndpoints.port ? `:${cfg.publicEndpoints.port}` : ""}
    </>
  );
  return (
    <Overlay closable={false}>
      <div className="flex justify-center">
        <div className="px-6 py-8 max-w-6xl grow">
          <h1 className="text-4xl text-center">👋 Let's get started!</h1>
          <div className="text-xl text-textLight py-6">
            Pick a name a slug for your {branding.productName} workspace. Slug will be used in the URLs{" "}
            <code>
              {domains.appBase}/<span className="text-textDark">your-slug</span>
            </code>{" "}
          </div>
          <WorkspaceNameAndSlugEditor onSuccess={onSuccess} />
          <div className="text-center my-4">
            Got here by mistake?{" "}
            <a
              className="cursor-pointer text-primary underline"
              onClick={async () => {
                //we can't use current session here, since the error can be originated
                //from auth layer. Try to logout using all methods
                signOut().catch(err => {
                  log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
                });
                firebaseSignOut().catch(err => {
                  log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
                });
              }}
            >
              Sign out
            </a>{" "}
            or{" "}
            <Link className="cursor-pointer text-primary underline" href={`/workspaces`}>
              select other workspace
            </Link>
          </div>
        </div>
      </div>
    </Overlay>
  );
};

const log = getLog("WorkspacePageLayout");

export const VerticalSection: React.FC<PropsWithChildren<{ className?: string }>> = ({ children, className }) => {
  return <div className={classNames("w-full flex justify-center", className)}>{children}</div>;
};

export const WidthControl: React.FC<PropsWithChildren<{ className?: string }>> = ({ children, className }) => {
  return (
    <div className={classNames("px-8", className)} style={{ maxWidth: "1500px", minWidth: "900px", flexGrow: 1 }}>
      {children}
    </div>
  );
};

export const WorkspacePageLayout: React.FC<PropsWithChildren<PageLayoutProps>> = ({
  className,
  fullscreen,
  onClose,
  children,
  doNotBlockIfUsageExceeded,
}) => {
  const [showDrawer, setShowDrawer] = useState(false);
  const workspace = useWorkspace();
  const router = useRouter();

  if (!router.query.workspaceId) {
    throw new Error(`${router.asPath} is not a workspace page`);
  }

  useEffect(() => {
    setShowDrawer(false);
  }, [fullscreen]);

  const pHeader = (
    <VerticalSection className="header border-b border-neutral-300 bg-neutral-50" key="header">
      <WidthControl>
        <div className="-ml-4 ">
          <PageHeader />
        </div>
      </WidthControl>
    </VerticalSection>
  );
  return (
    <div className={`flex flex-col  ${className}`}>
      {!doNotBlockIfUsageExceeded && <BillingBlockingDialog />}
      <div className="flex-auto overflow-auto flex flex-col" style={{ minWidth: "1024px" }}>
        {!workspace.slug && (
          <WorkspaceSettingsModal
            onSuccess={() => {
              router.reload();
            }}
          />
        )}
        {fullscreen ? (
          <>
            <div className="flex justify-center fixed w-screen z-50 pointer-events-none">
              <div className={"z-50 cursor-pointer pointer-events-auto px-2"}>
                <button
                  className="border-l border-b border-r rounded-b-md px-8 py-0 shadow"
                  onClick={() => setShowDrawer(!showDrawer)}
                >
                  <ChevronUp className={"w-6 h-6 block rotate-180"} />
                </button>
              </div>
            </div>
            <Drawer
              height={"auto"}
              bodyStyle={{ padding: 0 }}
              open={showDrawer}
              placement={"top"}
              closable={false}
              onClose={() => setShowDrawer(false)}
            >
              {pHeader}
            </Drawer>
          </>
        ) : (
          pHeader
        )}
        <VerticalSection className={`flex-auto overflow-auto ${fullscreen ? "py-2" : "py-12"}`}>
          {fullscreen && (
            <button className="absolute right-0 top-0 pr-4 pt-0" onClick={() => (onClose ? onClose() : router.back())}>
              <div className="font-light text-6xl rotate-45 z-50">+</div>
            </button>
          )}
          <WidthControl>{children}</WidthControl>
        </VerticalSection>
      </div>
    </div>
  );
};
