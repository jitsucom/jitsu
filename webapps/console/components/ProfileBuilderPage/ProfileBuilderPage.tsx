import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import React, { useEffect, useRef, useState } from "react";
import { Button, Input, Tabs, Tag, Tooltip } from "antd";
import {
  Bug,
  Code2,
  OctagonAlert,
  Play,
  Save,
  Settings,
  Terminal,
  Lock,
  Hammer,
  ThumbsUp,
  LoaderCircle,
  Braces,
  Parentheses,
} from "lucide-react";
import { CodeEditor } from "../CodeEditor/CodeEditor";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { PropsWithChildrenClassname } from "../../lib/ui";
import classNames from "classnames";
import styles from "./ProfileBuilderPage.module.css";
import FieldListEditorLayout from "../FieldListEditorLayout/FieldListEditorLayout";
import Link from "next/link";
import { useBilling } from "../Billing/BillingProvider";
import { useWorkspace } from "../../lib/context";
import { ErrorCard } from "../GlobalError/GlobalError";
import type { PresetColorType, PresetStatusColorType } from "antd/es/_util/colors";
import { get } from "../../lib/useApi";

const statuses: Record<
  ProfileBuilderStatus | "loading",
  {
    title: React.ReactNode;
    documentation: React.ReactNode;
    icon: React.ReactNode;
    color: PresetColorType | PresetStatusColorType;
  }
> = {
  incomplete: {
    color: "lime",
    title: "INCOMPLETE",
    documentation: <>Profile builder is not fully configured. Go to settings section to finish configuration</>,
    icon: <OctagonAlert className="full" />,
  },
  locked: {
    color: "blue",
    title: "Locked",
    documentation: (
      <>
        Profile builder is not enabled for your account. You still can define profiles with JavaScript function, and run
        test. To enable profile builder, please for your account please <Link href={"/support"}>contact support</Link>
      </>
    ),
    icon: <Lock className="full" />,
  },
  building: {
    color: "yellow",
    title: "BUILDING",
    documentation: (
      <>
        Profile builder is building initial profiles. In can happen after the first configuration, or after a change has
        been made in the code. You can monitor the progress in the progress section
      </>
    ),
    icon: <Hammer className="full" />,
  },
  ready: {
    color: "green",
    title: "READY",
    documentation: <>Profile builder is ready to use. You can query profiles, from a configured destination</>,
    icon: <ThumbsUp className="full" />,
  },
  loading: {
    color: "processing",
    title: "LOADING",
    documentation: <>Settings are being loaded, please wait</>,
    icon: <LoaderCircle className="full animate-spin" />,
  },
};

const Header: React.FC<{ status: ProfileBuilderStatus | "loading" }> = ({ status }) => {
  const statusDetails = statuses[status];

  return (
    <div className="flex items-center gap-2 mb-4">
      <h3 className="text-3xl">Profile Builder</h3>
      <Tag className="h-6 text-2xl" color={"blue"} rootClassName="cursor-pointer">
        <Tooltip title={statusDetails.documentation}>
          <div className="flex justify-between gap-2 items-center">
            <div className="w-4 h-4">{statusDetails.icon}</div>
            <div className="text-lg">{statusDetails.title}</div>
          </div>
        </Tooltip>
      </Tag>
    </div>
  );
};

const SettingsTab = () => {
  return (
    <div className={styles.settingsTable}>
      <FieldListEditorLayout
        noBorder={true}
        items={[
          {
            key: "storage",
            name: "Storage",
            documentation: (
              <>
                The host name of the profile storage. To make changes, please{" "}
                <Link href={"/support"}>contact support</Link>
              </>
            ),
            component: <Input disabled={true} />,
          },
          {
            key: "destination",
            name: "Destination",
            documentation: <>Select the destination database where the profiles will be stored</>,
            component: <Input disabled={true} />,
          },
          {
            key: "table-name",
            name: "Table Name",
            documentation: <>The name of the table where the profiles will be stored</>,
            component: <Input disabled={true} value={"profiles"} />,
          },
        ]}
      />
      <div className="flex justify-end pr-2">
        <Button type="primary" className="mt-2" size={"large"}>
          Save
        </Button>
      </div>
    </div>
  );
};

const Code = () => {
  const [code, setCode] = useState(
    ["//Define profiles with JavaScript function here", "//Read more on https://docs.jitsu.com/profile-builder"].join(
      "\n"
    )
  );
  return <CodeEditor value={code} height="100%" language="JavaScript" onChange={setCode} />;
};

const TabContent = ({ children }) => {
  return (
    <div className="border-l border-r border-b px-2 py-4" style={{ minHeight: "100%" }}>
      {children}
    </div>
  );
};

const verticalPaddingPx = 30;

const VerticalSpacer: React.FC<PropsWithChildrenClassname> = ({ children, className }) => {
  const divRef = useRef<HTMLDivElement>(null); // Ref to access the div element
  const [height, setHeight] = useState("auto");

  useEffect(() => {
    const updateHeight = () => {
      if (divRef.current) {
        const top = divRef.current.getBoundingClientRect().top;
        const availableHeight = window.innerHeight - top - verticalPaddingPx;
        setHeight(`${availableHeight}px`);
      }
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  return (
    <div ref={divRef} className={className} style={{ height }}>
      {children}
    </div>
  );
};

type ProfileBuilderStatus = "incomplete" | "locked" | "building" | "ready";
type ProfileBuilderData = {
  status: ProfileBuilderStatus;
  id?: string;
  name: string;
  code: string;
  settings?: {
    storage: string;
    destinationId: string;
    connectionOptions?: {
      tableName?: string;
    };
  };
};

function useProfileBuilderData():
  | { isLoading: true; error?: never; data?: never }
  | { isLoading: false; error: Error; data?: never }
  | { isLoading: false; error?: never; data: ProfileBuilderData } {
  const workspace = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const [data, setData] = useState<ProfileBuilderData | undefined>();
  const billing = useBilling();
  useEffect(() => {
    (async () => {
      get(`/api/${workspace.id}/config/profile-builder?init=true`)
        .then(res => res.profileBuilders)
        .then(profileBuilders => {
          let status: ProfileBuilderStatus = "locked";
          if (billing.enabled && billing.loading) {
            setLoading(true);
            return;
          } else if (billing.enabled) {
            if (billing.settings?.profileBuilderEnabled) {
              status = "ready";
            }
          }
          if (profileBuilders?.length) {
            const pb = profileBuilders[0];
            setLoading(false);
            setData({
              status: status,
              id: pb.id,
              name: pb.name,
              code: "//TODO - get code from server or inject example code",
              settings: {
                storage: pb.intermediateStorageCredentials,
                destinationId: pb.destinationId,
                connectionOptions: pb.connectionOptions,
              },
            });
            return;
          } else {
            setLoading(false);
            setData({
              status: "incomplete",
              id: "default",
              name: "Default",
              code: "//TODO - get code from server or inject example code",
            });
          }
        });

      //setLoading(true);
    })();
  }, [billing.enabled, billing.loading, workspace, billing.settings]);
  return { isLoading: loading, error, data } as any;
}

const Overlay: React.FC<{ children?: React.ReactNode; visible: boolean; className?: string }> = ({
  children,
  visible,
  className,
}) => {
  if (!visible) {
    return <></>;
  }
  return <div className={classNames("absolute top-0 left- w-full h-full z-10", className)}>{children || ""}</div>;
};

export function ProfileBuilderPage() {
  const { data: initialData, error: globalError, isLoading } = useProfileBuilderData();
  const [code, setCode] = useState(initialData?.code || "");
  const [testData, setTestData] = useState("");
  const [activePrimaryTab, setActivePrimaryTab] = useState("code");
  const [activeSecondaryTab, setActiveSecondaryTab] = useState("test");
  return (
    <WorkspacePageLayout noPadding={true}>
      <div className="mx-12 relative" style={{ paddingTop: `${verticalPaddingPx}px` }}>
        <Overlay
          visible={isLoading}
          className="bg-white bg-opacity-40 backdrop-blur-xs flex flex-col gap-4  items-center justify-center text-lg text-text"
        >
          <LoaderCircle className="animate-spin w-12 h-12" />
          <div className="text-center">Configuration loading, please wait...</div>
        </Overlay>
        <Overlay
          visible={!!globalError}
          className="bg-white pt-12 flex flex-col gap-4 items-center justify-start text-lg text-text"
        >
          <ErrorCard error={new Error("BALALAL")} />
        </Overlay>
        <Header status={isLoading ? "loading" : initialData!.status} />
        <VerticalSpacer className="flex flex-col">
          <div style={{ height: "400px" }}>
            <Tabs
              className={classNames(styles.tabsHeightFix)}
              key={"code"}
              onChange={setActivePrimaryTab}
              tabBarExtraContent={
                activePrimaryTab === "code" ? (
                  <div className="flex items-center gap-2">
                    <Button type="text" disabled={isLoading || !!globalError}>
                      <ButtonLabel
                        icon={
                          <Play
                            className="w-3.4 h-3.5"
                            fill={isLoading || !!globalError ? "gray" : "green"}
                            stroke={isLoading || !!globalError ? "gray" : "green"}
                          />
                        }
                      >
                        Run
                      </ButtonLabel>
                    </Button>
                    <Button type="text" disabled={isLoading || !!globalError || initialData?.status === "locked"}>
                      <ButtonLabel icon={<Save className="w-3.4 h-3.5" />}>Publish</ButtonLabel>
                    </Button>
                  </div>
                ) : (
                  <></>
                )
              }
              type={"card"}
              activeKey={activePrimaryTab}
              size={"small"}
              tabBarStyle={{ marginBottom: 0 }}
              items={[
                {
                  disabled: isLoading || !!globalError,
                  key: "code",
                  style: { height: "100%" },
                  label: <ButtonLabel icon={<Code2 className="w-3.5 h-3.5" />}>Code</ButtonLabel>,
                  children: (
                    <TabContent>
                      <CodeEditor value={code} height="100%" language="JavaScript" onChange={setCode} />
                    </TabContent>
                  ),
                },
                {
                  disabled: isLoading || !!globalError,
                  style: { height: "100%" },
                  key: "settings",
                  label: <ButtonLabel icon={<Settings className="w-3.5 h-3.5" />}>Settings</ButtonLabel>,
                  children: (
                    <TabContent>
                      <SettingsTab />
                    </TabContent>
                  ),
                },
                {
                  disabled: isLoading || !!globalError || initialData?.status !== "locked",
                  style: { height: "100%" },
                  key: "build",
                  label: <ButtonLabel icon={<Hammer className="w-3.5 h-3.5" />}>Build Progress</ButtonLabel>,
                  children: <TabContent> </TabContent>,
                },
              ]}
            />
          </div>

          <div className={`grow mt-2 ${activePrimaryTab !== "code" ? "border-b" : ""}`}>
            <Tabs
              className={classNames(styles.tabsHeightFix)}
              onChange={setActiveSecondaryTab}
              type={"card"}
              defaultActiveKey="1"
              size={"small"}
              tabBarStyle={{ marginBottom: 0 }}
              activeKey={activePrimaryTab !== "code" ? "non-existent" : activeSecondaryTab}
              items={[
                {
                  style: { height: "100%" },
                  disabled: activePrimaryTab !== "code" || isLoading || !!globalError,
                  key: "test",
                  label: <ButtonLabel icon={<Bug className="w-3.5 h-3.5" />}>Test Data</ButtonLabel>,
                  children: (
                    <TabContent>
                      <Code />
                    </TabContent>
                  ),
                },
                {
                  disabled: isLoading || !!globalError,
                  key: "env",
                  style: { height: "100%" },
                  label: <ButtonLabel icon={<Parentheses className="w-3.5 h-3.5" />}>Variables</ButtonLabel>,
                  children: <TabContent>Variables</TabContent>,
                },
                {
                  style: { height: "100%" },
                  key: "result",
                  disabled: activePrimaryTab !== "code" || isLoading || !!globalError,
                  label: <ButtonLabel icon={<Braces className="w-3.5 h-3.5" />}>Last Run Result</ButtonLabel>,
                  children: <TabContent> </TabContent>,
                },
                {
                  style: { height: "100%" },
                  key: "logs",
                  disabled: activePrimaryTab !== "code" || isLoading || !!globalError,
                  label: <ButtonLabel icon={<Terminal className="w-3.5 h-3.5" />}>Logs</ButtonLabel>,
                  children: <TabContent> </TabContent>,
                },
              ]}
            />
          </div>
        </VerticalSpacer>
      </div>
    </WorkspacePageLayout>
  );
}
