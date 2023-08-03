import { PropsWithChildren, ReactNode, useEffect, useState } from "react";
import { branding } from "../../lib/branding";
import { HiSelector } from "react-icons/hi";
import { FaSignOutAlt, FaUserCircle } from "react-icons/fa";
import { FiSettings } from "react-icons/fi";
import { Button, Drawer, Dropdown, Menu } from "antd";
import MenuItem from "antd/lib/menu/MenuItem";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import styles from "./WorkspacePageLayout.module.css";
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
  X,
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
  //const classicProject = useClassicProject();

  return (
    <Dropdown
      dropdownRender={() => <WorkspacesMenu jitsuClassicAvailable={false} />}
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
    <div className="flex pl-1.5 gap-0 xl:gap-5">
      {props.items
        .filter(i => !i.hidden)
        .map(item => {
          const selected = isSelected(item, router);
          return (
            <div
              key={item.path}
              className={`cursor-pointer py-2 px-2 mb-2 ${selected ? "bg-neutral-200 rounded-xl" : ""}`}
            >
              <WLink href={item.path}>
                <span
                  className={`flex flex-nowrap items-center whitespace-nowrap hover:text-neutral-800 ${
                    selected ? "text-neutral-800" : "text-neutral-500"
                  }`}
                >
                  <div className="mr-0.5 xl:mr-1 h-4 w-4">{item.icon}</div>
                  {item.title}
                </span>
              </WLink>
            </div>
          );
        })}
    </div>
  );
};

function Breadcrumbs() {
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const classicProject = useClassicProject();

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
      {classicProject.active && !!classicProject.project && (
        <>
          <div className="pl-2 w-8 h-8 text-textLight">
            <svg fill="none" height="100%" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="100%">
              <path d="M16.88 3.549L7.12 20.451" />
            </svg>
          </div>
          <div>
            <button
              className={"h-8 ml-3.5 mr-1.5 outline-0"}
              onClick={async () => {
                try {
                  const eeClient = getEeClient(requireDefined(appConfig.ee.host, `EE is not available`), workspace.id);
                  const customToken = await eeClient.createCustomToken();
                  window.location.href = `${appConfig.jitsuClassicUrl}/?token=${customToken}`;
                } catch (e) {
                  feedbackError(`Can't navigate to Jitsu.Classic`, { error: e });
                }
              }}
            >
              <img alt={""} src="/logo-classic-gray.svg" className="h-5 w-5 mr-2" /> Switch to Jitsu Classic
            </button>
          </div>
          <div className={""}>
            <a target={"_blank"} rel={"noreferrer noopener"} href="https://jitsu.com/blog/jitsu-next#migration-faq">
              ( <u>Read about migration</u> )
            </a>
          </div>
        </>
      )}
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
  const workspace = useWorkspace();
  const items: TabsMenuItem[] = [
    { title: "Overview", path: "/", aliases: "/overview", icon: <LayoutDashboard className="w-full h-full" /> },
    { title: "Sites", path: "/streams", icon: <Globe className="w-full h-full" /> },
    { title: "Destinations", path: "/destinations", icon: <Server className="w-full h-full" /> },
    { title: "Connections", path: "/connections", icon: <Share2 className="w-full h-full" /> },
    { title: "Functions", path: "/functions", icon: <FunctionSquare className="w-full h-full" /> },
  ];
  if (workspace.featuresEnabled && workspace.featuresEnabled.includes("syncs")) {
    items.push(
      { title: "Services", path: "/services", icon: <ServerCog className="w-full h-full" /> },
      { title: "Syncs", path: "/syncs", icon: <Share2 className="w-full h-full" /> }
    );
  }
  items.push(
    { title: "Live Events", path: "/data", icon: <Activity className="w-full h-full" /> },
    { title: "Query Data", path: "/sql", icon: <BarChart3 className="w-full h-full" />, hidden: !appConfig?.ee },
    {
      title: "Settings",
      path: "/settings",
      icon: <Settings className="w-full h-full" />,
    }
  );
  return (
    <div>
      <div className="w-full">
        <div className="flex justify-between items-center px-4">
          <Breadcrumbs />
          <UserProfileButton />
        </div>
        <TopTabsMenu items={items} />
      </div>
    </div>
  );
}

const WorkspaceSettingsModal: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const appConfig = useAppConfig();
  const domains = getDomains(appConfig);
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
      {appConfig.publicEndpoints.protocol}://<span className="text-textDark">yourslug</span>.
      {appConfig.publicEndpoints.dataHost}
      {appConfig.publicEndpoints.port ? `:${appConfig.publicEndpoints.port}` : ""}
    </>
  );
  return (
    <Overlay closable={false}>
      <div className="flex justify-center" style={{ minWidth: 900 }}>
        <div className="px-6 py-8 max-w-6xl grow relative">
          <h1 className="text-4xl text-center">👋 Let's get started!</h1>
          <div className="text-xl text-textLight py-6">
            Pick a name a slug for your {branding.productName} workspace. Slug will be used in the URLs{" "}
            <code>
              {domains.appBase}/<span className="text-textDark">your-slug</span>
            </code>{" "}
          </div>
          <WorkspaceNameAndSlugEditor onSuccess={onSuccess} offerClassic={true} />
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
  return (
    <div style={{ minWidth: 1024 }} className={classNames("w-full flex lg:justify-center", className)}>
      {children}
    </div>
  );
};

export const WidthControl: React.FC<PropsWithChildren<{ className?: string }>> = ({ children, className }) => {
  return <div className={classNames(className, "flex-grow", styles.widthControl)}>{children}</div>;
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
    <VerticalSection className="header border-b border-neutral-300 bg-neutral-50 z-40" key="header">
      <WidthControl className={"px-4"}>
        <PageHeader />
      </WidthControl>
    </VerticalSection>
  );
  return (
    <div className={`flex flex-col ${className}`}>
      {!doNotBlockIfUsageExceeded && <BillingBlockingDialog />}
      <div className="flex-auto overflow-auto flex flex-col">
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
              bodyStyle={{ padding: 0, minWidth: 1024 }}
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
            <button
              className="absolute right-0 top-0 mt-1 mr-2 hover:bg-neutral-100 p-1.5 rounded-lg flex justify-center items-center z-50"
              onClick={() => (onClose ? onClose() : router.back())}
            >
              <X className="w-8 h-8" />
            </button>
          )}
          <WidthControl className={"px-8"}>{children}</WidthControl>
        </VerticalSection>
      </div>
    </div>
  );
};
