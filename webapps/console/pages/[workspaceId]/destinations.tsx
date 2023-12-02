import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { Button, Modal, Popover, Skeleton, Table, Tabs, Tooltip } from "antd";
import { ConfigEditor, ConfigEditorProps, FieldDisplay } from "../../components/ConfigObjectEditor/ConfigEditor";
import { DestinationConfig } from "../../lib/schema";
import { confirmOp, feedbackError, serialization } from "../../lib/ui";
import {
  coreDestinations,
  coreDestinationsMap,
  DestinationType,
  getCoreDestinationType,
  PropertyUI,
} from "../../lib/schema/destinations";
import { DestinationCatalog, getDestinationIcon } from "../../components/DestinationsCatalog/DestinationsCatalog";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { assertDefined, getLog, requireDefined, rpc } from "juava";
import React, { PropsWithChildren, useState } from "react";
import TextArea from "antd/lib/input/TextArea";
import { getConfigApi, useApi } from "../../lib/useApi";
import { EmbeddedErrorMessage, ErrorCard } from "../../components/GlobalError/GlobalError";
import { branding } from "../../lib/branding";
import styles from "../../components/ConfigObjectEditor/ConfigEditor.module.css";
import { DeleteOutlined } from "@ant-design/icons";
import { SnippedEditor } from "../../components/CodeEditor/SnippedEditor";
import { MultiSelectWithCustomOptions } from "../../components/MultiSelectWithCustomOptions/MultiSelectWithCustomOptions";
import { LoadingAnimation } from "../../components/GlobalLoader/GlobalLoader";
import { useQuery } from "@tanstack/react-query";
import { Copy, Eye, FileKey, Loader2, Share2, TerminalSquare, XCircle, Zap } from "lucide-react";
import { ClickhouseConnectionCredentials } from "../../lib/schema/clickhouse-connection-credentials";
import { CodeBlock } from "../../components/CodeBlock/CodeBlock";
import { useBilling } from "../../components/Billing/BillingProvider";
import { UpgradeDialog } from "../../components/Billing/UpgradeDialog";
import { ProvisionDatabaseButton } from "../../components/ProvisionDatabaseButton/ProvisionDatabaseButton";
import Link from "next/link";
import { CodeEditor } from "../../components/CodeEditor/CodeEditor";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { CustomWidgetProps } from "../../components/ConfigObjectEditor/Editors";
import { Htmlizer } from "../../components/Htmlizer/Htmlizer";
import omit from "lodash/omit";
import { EditorToolbar } from "../../components/EditorToolbar/EditorToolbar";

const log = getLog("destinations");
const Loader: React.FC<{}> = () => {
  const router = useRouter();
  const workspace = useWorkspace();
  const { data, isLoading, error } = useQuery<string | null>(
    ["destinations", router.query.id],
    async () => {
      if (router.query.destinationType) {
        return requireDefined(
          getCoreDestinationType(router.query.destinationType as string),
          `Unknown destination type ${router.query.destinationType}`
        ).id;
      }
      if (!router.query.id) {
        return null;
      }
      const destination = await getConfigApi<DestinationConfig>(workspace.id, "destination").get(
        (router.query.clone || router.query.id) as string
      );
      return requireDefined(
        getCoreDestinationType(destination.destinationType),
        `Unknown destination type ${destination.destinationType}`
      ).id;
    },
    {
      cacheTime: 0,
      retry: false,
    }
  );
  if (!router.query.id) {
    return <DestinationsList />;
  } else if (isLoading) {
    return <LoadingAnimation />;
  } else if (error) {
    return <ErrorCard error={error} />;
  } else if (data) {
    return <DestinationsList type={data} />;
  }
  return <></>;
};
Loader.displayName = "Destinations.Loader";

const Destinations: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <Loader />
    </WorkspacePageLayout>
  );
};

const customEditors: Record<(typeof coreDestinations)[number]["id"], React.FC> = {
  // tag: props => {
  //   return <SnippetEditor {...props} />;
  // },
};

function getAllDestinationFields(type?: string): Record<string, PropertyUI> {
  const res: Record<string, PropertyUI> = {};
  const fillFields = (destination: DestinationType<any>) => {
    for (const [key, value] of Object.entries(destination.credentials.shape || [])) {
      if (value._def.description) {
        const meta = (value._def.description as string).split("::");
        const ui: PropertyUI = {};
        if (meta.length >= 2) {
          ui.displayName = meta[0];
          ui.documentation = meta[1];
        } else {
          ui.documentation = meta[0];
        }
        res[key] = ui;
      }
    }
    for (const [key, value] of Object.entries(destination.credentialsUi || [])) {
      res[key] = { ...res[key], ...value };
    }
  };
  if (!type) {
    for (const destination of coreDestinations) {
      fillFields(destination);
    }
  } else {
    const destination = coreDestinationsMap[type];
    if (destination) {
      fillFields(destination);
    }
  }

  return res;
}

export const ArrayTextareaEditor: React.FC<CustomWidgetProps<string[]>> = props => {
  const [value, setValue] = useState<string[]>(props.value || []);
  return (
    <TextArea
      rows={4}
      value={value.join("\n")}
      onChange={e => {
        const lines = e.target.value.split("\n").map(line => line.trim());
        props.onChange(lines);
        setValue(lines);
      }}
    />
  );
};

type KeyValueArray = [string, string][];

export const KeyValueArrayEditor: React.FC<CustomWidgetProps<KeyValueArray>> = props => {
  const serialize = (v: KeyValueArray) => v.map(([k, v]) => `${k}=${v}`).join("\n");
  const deserialize = (value: string) =>
    value
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.split("=", 2) as [string, string]);
  const [value, setValue] = useState<string>(props.value ? serialize(props.value) : "");
  return (
    <TextArea
      rows={4}
      value={value}
      onChange={e => {
        const deserialized = deserialize(e.target.value);
        setValue(e.target.value);
        props.onChange(deserialized);
      }}
    />
  );
};

function getEditorComponent(editor: string, editorProps?: any) {
  if (editor === "ArrayTextarea" || editor === "StringArrayEditor") {
    return ArrayTextareaEditor;
  } else if (editor === "CodeEditor") {
    //eslint-disable-next-line react/display-name
    return props => {
      return (
        <div className={"border border-textDisabled"}>
          <CodeEditor {...props} {...editorProps} />
        </div>
      );
    };
  } else if (editor === "SnippedEditor") {
    //eslint-disable-next-line react/display-name
    return props => {
      return <SnippedEditor {...props} {...editorProps} />;
    };
  } else if (editor === "MultiSelectWithCustomOptions") {
    //eslint-disable-next-line react/display-name
    return props => {
      return <MultiSelectWithCustomOptions {...props} {...editorProps} />;
    };
  } else {
    throw new Error(`Unknown editor ${editor}`);
  }
}

export const DestinationTitle: React.FC<{
  destination?: DestinationConfig;
  size?: "small" | "default" | "large";
  title?: (d: DestinationConfig, t: DestinationType) => React.ReactNode;
  link?: boolean;
}> = ({ destination, title = (d, t) => d.name, size = "default", link }) => {
  const w = useWorkspace();
  const destinationType = coreDestinationsMap[destination?.destinationType ?? ""];
  return (
    <ObjectTitle
      icon={getDestinationIcon(destinationType)}
      size={size}
      href={link && destination ? `/${w.slugOrId}/destinations?id=${destination.id}` : undefined}
      title={destination ? title(destination, destinationType) : "Unknown destination"}
    />
  );
};

const Password: React.FC<PropsWithChildren> = ({ children }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center">
      <div>{show ? children : "********"}</div>
      <button onClick={() => setShow(!show)}>
        <Eye className="h-3 w-3" />
      </button>
    </div>
  );
};

export const CredentialValue: React.FC<{ children: string; password?: boolean }> = ({ password, children }) => {
  const [reveal, setReveal] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const displayMask = password && !reveal;

  const onClick = () => {
    if (displayMask) {
      setReveal(true);
    } else {
      navigator.clipboard.writeText(children);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1000);
    }
  };

  return (
    <div className="border rounded text-textLight border-backgroundDark px-3 py-1.5 font-mono w-full relative group">
      {displayMask ? "********" : children}
      <div className="hidden group-hover:block absolute top-0 right-0">
        <div>
          <button
            onClick={onClick}
            className="border shadow-sm rounded h-full bg-backgroundLight mr-1 mt-1 px-2 py-1 flex items-center font-main"
          >
            {displayMask ? <Eye className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <div className="text-xs pl-1">{displayMask ? "Reveal" : justCopied ? "Copied" : "Copy"}</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export const CredentialsDisplay: React.FC<{
  credentials: Record<string, string | { type: "password"; password: string }>;
  children: string;
}> = ({ credentials, children }) => {
  return (
    <div>
      {Object.entries(credentials).map(([key, value]) => {
        return (
          <div className="flex items-center space-x-2 pb-4" key={key}>
            <div className="w-36">{key}</div>
            <div className="w-96">
              <CredentialValue password={typeof value === "object"}>
                {typeof value === "string" ? value : value.password}
              </CredentialValue>
            </div>
          </div>
        );
      })}
      <p className="my-4">
        <b>Example</b>
      </p>
      <CodeBlock>{children}</CodeBlock>
    </div>
  );
};

function CredentialsPopover(props: { credentials: ClickhouseConnectionCredentials }) {
  return (
    <div className={"w-full w-fit"}>
      <Tabs
        items={[
          {
            key: "tcp",
            label: "Native (TCP) Connection",
            children: (
              <CredentialsDisplay
                credentials={{
                  Host: props.credentials.host,
                  Port: props.credentials.tcpPort.toString(),
                  Database: props.credentials.database,
                  Username: props.credentials.username,
                  Password: { type: "password", password: props.credentials.password },
                }}
              >
                {[
                  `clickhouse-client --host ${props.credentials.host} \\`,
                  `\t--database ${props.credentials.database} \\`,
                  `\t--port ${props.credentials.tcpPort} --secure \\`,
                  `\t--user ${props.credentials.username} \\`,
                  `\t--password *****`,
                ].join("\n")}
              </CredentialsDisplay>
            ),
          },
          {
            key: "pg",
            label: "Postgres Wire",
            children: (
              <CredentialsDisplay
                credentials={{
                  Host: props.credentials.host,
                  Port: props.credentials.pgPort.toString(),
                  Database: props.credentials.database,
                  Username: props.credentials.username,
                  Password: { type: "password", password: props.credentials.password },
                }}
              >
                {[
                  `psql -h ${props.credentials.host} \\`,
                  `\t-p ${props.credentials.pgPort} \\`,
                  `\t-U ${props.credentials.username} \\`,
                  `\t${props.credentials.database}`,
                ].join("\n")}
              </CredentialsDisplay>
            ),
          },
          {
            key: "http",
            label: "HTTP",
            children: (
              <CredentialsDisplay
                credentials={{
                  Host: props.credentials.host,
                  Port: props.credentials.httpPort.toString(),
                  Database: props.credentials.database,
                  Username: props.credentials.username,
                  Password: { type: "password", password: props.credentials.password },
                }}
              >
                {[
                  `echo 'SELECT * from events' |\\`,
                  `curl 'https://${props.credentials.username}:***@${props.credentials.host}:${props.credentials.httpPort}/?database=${props.credentials.database}' -d @-`,
                ].join("\n")}
              </CredentialsDisplay>
            ),
          },
        ]}
      ></Tabs>
    </div>
  );
}

function ProvisionedDestinationShowCredentials(props: { destination: DestinationConfig }) {
  const workspace = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [popover, setPopover] = useState(false);
  const [tooltip, setTooltip] = useState(false);
  const [credentials, setCredentials] = useState<any>(null);
  const billing = useBilling();
  const [error, setError] = useState<any>(null);

  if (!billing.enabled) {
    return <></>;
  }
  if (billing.loading) {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }

  return (
    <Tooltip
      placement="top"
      open={tooltip && !popover && !loading && !error && !credentials}
      onOpenChange={(val: boolean) => setTooltip(val)}
      title={"Show credentials"}
    >
      <Popover
        placement="left"
        onOpenChange={val => {
          setPopover(val);
          if (!val) {
            setError(null);
            setCredentials(null);
          }
        }}
        content={
          billing.enabled && billing.settings.canShowProvisionDbCredentials ? (
            error ? (
              <EmbeddedErrorMessage>Failed to obtain credentials. Please try again later.</EmbeddedErrorMessage>
            ) : credentials ? (
              <CredentialsPopover credentials={credentials} />
            ) : null
          ) : (
            <div className="w-96">
              <UpgradeDialog featureDescription={"Clickhouse API Access"} />
            </div>
          )
        }
        mouseEnterDelay={0.5}
        trigger={[]}
        title={
          <div className={"w-full flex justify-between"}>
            <div>{error ? "Error loading credentials" : "Clickhouse Credentials"}</div>
            <button onClick={() => setPopover(false)}>
              <XCircle />
            </button>
          </div>
        }
        open={popover}
      >
        <button
          onClick={async () => {
            setError(null);
            setCredentials(null);
            setLoading(true);
            setTooltip(false);
            setPopover(false);
            try {
              if (billing.enabled && billing.settings.canShowProvisionDbCredentials) {
                setCredentials(
                  await rpc(`/api/${workspace.id}/ee/provision-db/credentials?destinationId=${props.destination.id}`)
                );
              }
            } catch (error) {
              setError(error);
              setTooltip(false);
              log.atError().withCause(error).log("Failed to load credentials");
            } finally {
              setTooltip(false);
              setPopover(true);
              setLoading(false);
            }
          }}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileKey className="h-5 w-5" />}
        </button>
      </Popover>
    </Tooltip>
  );
}

function ProvisionedDestinationDeleteButton(props: {
  destination: DestinationConfig;
  onSuccessfulDelete: () => Promise<void>;
}) {
  const workspace = useWorkspace();
  const [loading, setLoading] = useState(false);
  const onDelete = async () => {
    if (
      await confirmOp(
        <>
          Do you want to delete <b>{props.destination.name}</b> destination?
        </>
      )
    ) {
      setLoading(true);
      try {
        await fetch(`/api/${workspace.id}/config/destination/${props.destination.id}`, { method: "DELETE" });
        await props.onSuccessfulDelete();
      } catch (error) {
        feedbackError("Failed to delete destination", { error });
      } finally {
        setLoading(false);
      }
    }
  };
  return (
    <Button size="large" danger type="link" onClick={onDelete} loading={loading}>
      <DeleteOutlined />
    </Button>
  );
}

const ProvisionedDestinations = (props: any) => {
  const workspace = useWorkspace();
  const refresh = props.refresh;

  const { isLoading, data, error, refetch } = useApi<{ objects: DestinationConfig[] }>(
    `/api/${workspace.id}/config/destination?r=${refresh.getTime()}`
  );
  const loader = (
    <div className="flex flex-col justify-center mt-4" style={{ height: "200px" }}>
      <Skeleton paragraph={{ rows: 4, width: "100%" }} title={false} active />
    </div>
  );
  if (isLoading) {
    return (
      <div>
        <div className="text-3xl">Provisioned Destinations</div>
        {loader}
      </div>
    );
  } else if (error) {
    return <ErrorCard error={error} title="Failed to load provisioned destinations" />;
  }
  const provisionedDestinations = data?.objects.filter(d => d.provisioned) || [];
  if (provisionedDestinations.length === 0) {
    return (
      <div>
        <div className="text-3xl">Provisioned Destinations</div>
        <ProvisionDatabaseButton loader={loader} />
      </div>
    );
  }
  return (
    <div>
      <div className="text-3xl">Provisioned Destinations</div>
      <div className="my-5 text-textLight">
        Provisioned destinations are managed by <b>{branding.productName}</b>
      </div>
      <Table
        rowKey="id"
        className={styles.listTable}
        dataSource={provisionedDestinations}
        columns={[
          { title: "Name", render: (d: DestinationConfig) => <DestinationTitle destination={d} /> },
          {
            title: "",
            render: (d: DestinationConfig) => (
              <div className="flex justify-end items-center">
                <ProvisionedDestinationShowCredentials destination={d} />
                <Tooltip title={"Run SQL query editor"}>
                  <Link className="ml-4" href={`/${workspace.slug || workspace.id}/sql?destinationId=${d.id}`}>
                    <TerminalSquare className="h-5 w-5 text-text" />
                  </Link>
                </Tooltip>

                <ProvisionedDestinationDeleteButton
                  destination={d}
                  onSuccessfulDelete={async () => {
                    await refetch();
                  }}
                />
              </div>
            ),
          },
        ]}
        pagination={false}
      />
    </div>
  );
};

const DestinationsList: React.FC<{ type?: string }> = ({ type }) => {
  const [showCatalog, setShowCatalog] = useQueryStringState<boolean>("showCatalog", {
    defaultValue: false,
    ...serialization.bool,
  });
  const appConfig = useAppConfig();
  const router = useRouter();
  const workspace = useWorkspace();
  const extraFields: Record<string, FieldDisplay> = Object.entries(getAllDestinationFields(type)).reduce(
    (acc, [fieldName, fieldValue]) => {
      acc[fieldName] = {
        ...fieldValue,
        documentation: fieldValue.documentation ? <Htmlizer>{fieldValue.documentation}</Htmlizer> : undefined,
        editor: fieldValue.editor ? getEditorComponent(fieldValue.editor, fieldValue.editorProps) : undefined,
      };
      return acc;
    },
    {}
  );
  const [refresh, setRefresh] = useState(new Date());
  log.atDebug().log("extraFields", extraFields);
  const config: ConfigEditorProps<DestinationConfig> = {
    actions: [
      {
        title: "Run SQL query editor",
        collapsed: true,
        icon: <TerminalSquare className="h-4 w-4" />,
        key: "sql",
        link: (d: DestinationConfig) => `/sql?destinationId=${d.id}`,
        disabled: (d: DestinationConfig) => {
          return d.provisioned || (d.destinationType === "clickhouse" && d.protocol === "https")
            ? false
            : "Jitsu can query either provisioned ClickHouse, or ClickHouse connected via HTTPS protocol";
        },
      },
      {
        title: "Connected Sources",
        collapsed: true,
        icon: <Zap className="h-4 w-4" />,
        key: "sources",
        link: (d: DestinationConfig) => `/connections?destination=${d.id}`,
      },
      {
        title: "Syncs",
        collapsed: true,
        icon: <Share2 className="h-4 w-4" />,
        key: "syncs",
        link: (d: DestinationConfig) => `/syncs?destination=${d.id}`,
      },
    ],
    filter: (obj: DestinationConfig) => !obj.provisioned,
    icon: (d: DestinationConfig) => {
      const destinationType = coreDestinationsMap[d.destinationType];
      return getDestinationIcon(destinationType);
    },
    listColumns: [
      {
        title: "Type",
        render: (d: DestinationConfig) => {
          const destinationType = coreDestinationsMap[d.destinationType];
          return <span className={"font-semibold"}>{destinationType.title}</span>;
        },
      },
    ],
    newObject: () => {
      return { destinationType: router.query["destinationType"] as string };
    },
    testConnectionEnabled: (obj: DestinationConfig) => {
      const destinationType = coreDestinationsMap[obj.destinationType];
      assertDefined(destinationType, `Destination ${obj.destinationType} is not found: ${JSON.stringify(obj)}`);
      return !!destinationType.usesBulker;
    },
    onTest: async obj => {
      try {
        const res = await getConfigApi(workspace.id, obj.type).test(omit(obj, "testConnectionError"));
        return res.ok ? { ok: true } : { ok: false, error: res?.error || res?.message || "unknown error" };
      } catch (error) {
        log
          .atWarn()
          .log(
            `Failed to test destination ${workspace.id} / ${type}. This is not expected since destination tester should return 200 even in credentials are wrong`,
            error
          );
        return { ok: false, error: "Internal error, see logs for details" };
        //feedbackError("Failed to test object", { error });
      }
    },
    objectType: (obj: DestinationConfig) => {
      const destinationType = coreDestinationsMap[obj.destinationType];
      assertDefined(destinationType, `Destination ${obj.destinationType} is not found: ${JSON.stringify(obj)}`);
      return DestinationConfig.merge(destinationType.credentials as any);
    },
    fields: {
      type: { constant: "destination" },
      destinationType: { hidden: true },
      workspaceId: { constant: workspace.id },
      provisioned: { hidden: true },
      testConnectionError: { hidden: true },
      ...extraFields,
    },
    noun: "destination",
    type: "destination",
    explanation: (
      <>
        <strong>Destination</strong> is an external service that you can send your data to. Usually, it is a data
        warehouse or SaaS platform
      </>
    ),
    addAction: () => {
      setShowCatalog(true);
    },
    editorTitle: (obj: DestinationConfig, isNew: boolean) => {
      const verb = isNew ? "Create" : "Edit";
      const destinationType = coreDestinationsMap[obj.destinationType];
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">{destinationType?.icon}</div>
          {verb} {destinationType?.title || ""} destination
        </div>
      );
    },
    subtitle: (obj: DestinationConfig, isNew: boolean) => {
      if (isNew) {
        return undefined;
      }

      return (
        <EditorToolbar
          items={
            [
              obj.provisioned || obj.destinationType === "clickhouse"
                ? {
                    title: "SQL Query Editor",
                    icon: <TerminalSquare className="w-full h-full" />,
                    href: `/${workspace.slugOrId}/sql?destinationId=${obj.id}`,
                  }
                : undefined,
              {
                title: "Connected Sources",
                icon: <Zap className="w-full h-full" />,
                href: `/${workspace.slugOrId}/connections?destination=${obj.id}`,
              },
              {
                title: "Syncs",
                icon: <Share2 className="w-full h-full" />,
                href: `/${workspace.slugOrId}/syncs?destination=${obj.id}`,
              },
            ].filter(Boolean) as any
          }
          className="mb-4"
        />
      );
    },
  };
  return (
    <>
      <Modal
        bodyStyle={{
          overflowY: "auto",
          maxHeight: "calc(100vh - 200px)",
          display: "flex",
          flexDirection: "column",
        }}
        open={showCatalog}
        width="90vw"
        style={{ minWidth: 1000 }}
        destroyOnClose={true}
        onCancel={() => setShowCatalog(false)}
        footer={null}
      >
        <DestinationCatalog
          onClick={async destination => {
            const url = `/${
              workspace.id
            }/destinations?id=new&destinationType=${destination}&backTo=${encodeURIComponent(
              (router.query.backTo ?? "") as string
            )}`;
            setShowCatalog(false).then(() => router.push(url));
          }}
          dismiss={async () => {
            await setShowCatalog(false)
              .then(() => router.push(`/${workspace.slugOrId}${router.query.backTo || "/destinations"}`))
              .then(() => setRefresh(new Date()));
          }}
        />
      </Modal>
      {!router.query.id && appConfig.ee?.available && (
        <div className="my-6">
          <ProvisionedDestinations refresh={refresh} />
        </div>
      )}
      <ConfigEditor
        listTitle="Destinations"
        {...(config as any)}
        editorComponent={props => {
          return customEditors[props.object.destinationType];
        }}
      />
    </>
  );
};

export default Destinations;
