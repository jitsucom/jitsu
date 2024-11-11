import React, { useCallback, useEffect, useReducer, useState } from "react";
import { EditorComponentProps } from "../ConfigObjectEditor/ConfigEditor";
import { Badge, Button, Descriptions, Drawer, Dropdown, Input, MenuProps, Select, Splitter, Table, Tabs } from "antd";
import { CodeEditor } from "../CodeEditor/CodeEditor";
import styles from "./FunctionsDebugger.module.css";
import {
  Braces,
  Bug,
  Check,
  Code2,
  Parentheses,
  Pencil,
  Play,
  RefreshCw,
  Save,
  SearchCode,
  Terminal,
  Undo2,
  X,
} from "lucide-react";
import { getConfigApi, useEventsLogApi } from "../../lib/useApi";
import { EventsLogRecord } from "../../lib/server/events-log";
import { useWorkspace } from "../../lib/context";
import { arrayToMap } from "../../lib/shared/arrays";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { ColumnsType } from "antd/es/table";
import { UTCDate, UTCHeader } from "../DataView/EventsBrowser";
import { examplePageEvent, exampleTrackEvents, exampleIdentifyEvent } from "./example_events";
import { rpc } from "juava";
import { logType } from "@jitsu/core-functions/src/functions/lib/udf_wrapper";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { defaultFunctionTemplate } from "./code_templates";
import { FunctionConfig } from "../../lib/schema";
import { useRouter } from "next/router";
import { feedbackError, PropsWithChildrenClassname } from "../../lib/ui";
import Link from "next/link";
import { useStoreReload } from "../../lib/store";
import { FunctionLogs } from "./FunctionLogs";
import { FunctionResult } from "./FunctionResult";
import { FunctionVariables } from "./FunctionVariables";
import { CodeViewer } from "./CodeViewer";
import classNames from "classnames";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { Dot } from "../ProfileBuilderPage/ProfileBuilderPage";

type FunctionsDebuggerProps = {} & EditorComponentProps;

export const EditableTitle: React.FC<{ children: string; onUpdate: (str: string) => void }> = ({
  children,
  onUpdate,
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(children);
  const [rollbackValue, setRollbackValue] = useState(children);
  return (
    <div className={"h-12"}>
      {editing ? (
        <div className={"flex space-x-2"}>
          <div className="shrink">
            <Input
              value={value}
              className="text-3xl"
              size="large"
              onChange={e => {
                setValue(e.target.value);
                onUpdate(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  setEditing(false);
                  onUpdate(value);
                } else if (e.key == "Escape") {
                  setEditing(false);
                  setValue(rollbackValue);
                  onUpdate(rollbackValue);
                }
              }}
            />
          </div>
          <button
            className="hover:bg-neutral-100 py-1.5 px-2 rounded"
            onClick={() => {
              setEditing(false);
              onUpdate(value);
            }}
          >
            <Check className="w-5 h-5" />
          </button>
          <button
            className="hover:bg-neutral-100 py-1.5 px-2 rounded"
            onClick={() => {
              setEditing(false);
              setValue(rollbackValue);
              onUpdate(rollbackValue);
            }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className={"group flex space-x-2"}>
          <h1
            className="text-3xl cursor-pointer"
            onDoubleClick={() => {
              setRollbackValue(value);
              setEditing(true);
            }}
          >
            {value}
          </h1>
          <button
            className="hover:bg-neutral-100 py-1.5 px-2 rounded invisible group-hover:visible flex-grow-0 cursor-pointer"
            onClick={() => {
              setRollbackValue(value);
              setEditing(true);
            }}
          >
            <Pencil className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

export const FunctionsDebugger: React.FC<FunctionsDebuggerProps> = props => {
  const { push } = useRouter();

  const workspace = useWorkspace();
  const [activePrimaryTab, setActivePrimaryTab] = useState("code");
  const [activeSecondaryTab, setActiveSecondaryTab] = useState("event");
  const [newResult, setNewResult] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [event, setEvent] = useState<any>(JSON.stringify(examplePageEvent(), undefined, 2));
  const [obj, setObj] = useState<Partial<FunctionConfig>>({
    ...props.object,
    code: props.isNew ? defaultFunctionTemplate() : props.object.code ?? "",
  });

  const [config, setConfig] = useState<any>({});
  const [store, setStore] = useState<any>({});
  const [result, setResult] = useState<any>({});
  const [resultType, setResultType] = useState<"ok" | "drop" | "error">("ok");
  const [logs, setLogs] = useState<logType[]>([]);
  const [unreadErrorLogs, setUnreadErrorLogs] = useState(0);
  const [unreadLogs, setUnreadLogs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const reloadStore = useStoreReload();

  function handleTabChange(key: string) {
    setActiveSecondaryTab(key);
    if (key === "logs") {
      setUnreadLogs(0);
      setUnreadErrorLogs(0);
    }
    if (key === "result") {
      setNewResult(false);
    }
  }

  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (props.isNew) {
        await getConfigApi(workspace.id, "function").create(obj);
      } else if (obj.id) {
        await getConfigApi(workspace.id, "function").update(obj.id, obj);
      } else {
        feedbackError(`Can't save function without id`);
      }
      await reloadStore();
      push(`/${workspace.id}/functions`);
    } catch (error) {
      feedbackError(`Can't save function`, { error });
    } finally {
      setSaving(false);
    }
  }, [props.isNew, obj, workspace.id, push, reloadStore]);

  const runFunction = useCallback(async () => {
    setRunning(true);
    let body = {};
    try {
      body = {
        functionId: obj.id,
        functionName: obj.name,
        code: obj.code,
        event: JSON.parse(event),
        variables: config,
        store,
        userAgent: navigator.userAgent,
      };
    } catch (e) {
      feedbackError("Invalid JSON", { error: e });
      setRunning(false);
      return;
    }
    try {
      const res = await rpc(`/api/${workspace.id}/function/run`, {
        method: "POST",
        body,
      });
      if (activeSecondaryTab !== "result") {
        setNewResult(true);
      }
      if (res.error) {
        setResult(res.error);
        setResultType("error");
        setLogs([
          ...res.logs,
          {
            level: "error",
            type: "log",
            message: `${res.error.name}: ${res.error.message}`,
            timestamp: new Date(),
          },
        ]);
      } else {
        setResult(res.result);
        setResultType(res.dropped ? "drop" : "ok");
        if (res.dropped) {
          setLogs([
            ...res.logs,
            {
              level: "info",
              type: "log",
              message: `Further processing will be SKIPPED. Function returned: ${JSON.stringify(res.result)}`,
              timestamp: new Date(),
            },
          ]);
        } else {
          setLogs(res.logs);
        }
      }

      if (activeSecondaryTab !== "logs") {
        setUnreadLogs(res.logs.length);
        setUnreadErrorLogs(res.logs.filter(l => l.level === "error").length);
      }
      setStore(res.store);
    } catch (e: any) {
      const errorText = "Error while calling Function API. Please contact support.";
      setLogs([
        {
          level: "error",
          type: "log",
          message: errorText,
          timestamp: new Date(),
        },
      ]);
      setResult({
        name: "Error",
        message: errorText,
      });
      setResultType("error");
    } finally {
      setRunning(false);
    }
  }, [workspace.id, obj.code, config, event, store, obj.id, obj.name, activeSecondaryTab]);

  return (
    <div className="relative flex flex-col h-full">
      <Drawer
        title="Choose Event from Live Stream"
        placement="right"
        width={"50%"}
        mask={false}
        headerStyle={{ padding: "1em" }}
        bodyStyle={{ padding: "1em" }}
        className={"border rounded-r-lg"}
        style={{ borderColor: "#d9d9d9" }}
        maskClosable={false}
        closable={true}
        onClose={() => setShowEvents(false)}
        open={showEvents}
        getContainer={false}
      >
        <EventsSelector selectEvent={e => setEvent(JSON.stringify(e, undefined, 2))} />
      </Drawer>
      <EditableTitle
        onUpdate={name => {
          setObj({ ...obj, name });
        }}
      >
        {obj.name || "New function"}
      </EditableTitle>
      <Splitter layout="vertical" className={`flex-auto flex-grow overflow-auto gap-1 ${styles.splitterFix}`}>
        <Splitter.Panel className={"flex flex-col"}>
          <Tabs
            className={classNames(styles.tabsHeightFix)}
            key={"code"}
            rootClassName={"flex-auto"}
            onChange={setActivePrimaryTab}
            tabBarExtraContent={
              <div className="flex items-center gap-2">
                <Button type="text" onClick={() => push(`/${workspace.id}/functions`)} disabled={saving}>
                  <ButtonLabel icon={<Undo2 className="w-4 h-4" />}>Cancel</ButtonLabel>
                </Button>
                <Button type="text" onClick={save} disabled={saving}>
                  <ButtonLabel icon={<Save className="w-4 h-4" />}>Save</ButtonLabel>
                </Button>
              </div>
            }
            type={"card"}
            activeKey={activePrimaryTab}
            size={"small"}
            tabBarStyle={{ marginBottom: 0 }}
            items={[
              {
                key: "code",
                style: { height: "100%" },
                label: (
                  <ButtonLabel icon={<Code2 className="w-3.5 h-3.5" />}>
                    <div className={"flex gap-2 items-center"}>
                      <span>{obj.origin === "jitsu-cli" ? "Info" : "Code"}</span>
                      {props.object?.code !== obj.code && <Dot />}
                    </div>
                  </ButtonLabel>
                ),
                children: (
                  <TabContent>
                    {obj.origin === "jitsu-cli" ? (
                      <Descriptions
                        bordered
                        className={`flex-auto`}
                        contentStyle={{ width: "100%" }}
                        column={1}
                        size={"small"}
                      >
                        <Descriptions.Item label="Slug">
                          <code>{obj.slug}</code>
                        </Descriptions.Item>
                        <Descriptions.Item label="Origin">This function was created with Jitsu CLI</Descriptions.Item>
                        <Descriptions.Item label="Package Version" className={"whitespace-nowrap"}>
                          {obj.version}
                        </Descriptions.Item>
                        {obj.description && (
                          <Descriptions.Item label="Description">{obj.description}</Descriptions.Item>
                        )}
                        {
                          <Descriptions.Item label="Code">
                            <div className="text-sm">
                              <div className="mb-6">
                                The function is compiled and deployed with{" "}
                                <Link href="https://docs.jitsu.com/functions/sdk">
                                  <code>jitsu-cli</code>
                                </Link>{" "}
                                and can't be edited in the UI. However, you can still run it with different events and
                                see the results below. And you can view the code
                              </div>

                              <CodeViewer code={obj.code as string} />
                            </div>
                          </Descriptions.Item>
                        }
                      </Descriptions>
                    ) : (
                      <CodeEditor
                        language={"javascript"}
                        value={obj.code ?? ""}
                        ctrlEnterCallback={runFunction}
                        ctrlSCallback={save}
                        extraSuggestions={`
declare class RetryError extends Error {
  constructor(message, options?: { drop: boolean }) {
    super(message);
    this.name = options?.drop ? "${DropRetryErrorName}" : "${RetryErrorName}";
  }
}
                    `}
                        onChange={value => setObj({ ...obj, code: value })}
                        monacoOptions={{ renderLineHighlight: "none" }}
                      />
                    )}
                  </TabContent>
                ),
              },
            ]}
          />
        </Splitter.Panel>
        <Splitter.Panel>
          <Tabs
            className={classNames(styles.tabsHeightFix)}
            onChange={handleTabChange}
            tabBarExtraContent={
              <div className="flex items-center gap-2">
                {activeSecondaryTab === "event" && (
                  <>
                    <ExamplesDropdown selectEvent={e => setEvent(JSON.stringify(e, undefined, 2))} />
                    <Button type="text" onClick={() => setShowEvents(!showEvents)}>
                      <ButtonLabel icon={<SearchCode className="w-4 h-4" />}>Get Live Event</ButtonLabel>
                    </Button>
                  </>
                )}
                <Button onClick={runFunction} type="text" disabled={saving}>
                  <ButtonLabel
                    icon={
                      running ? (
                        <RefreshCw className={"w-3.5 h-3.5 animate-spin"} />
                      ) : (
                        <Play className="w-3.5 h-3.5" fill={"green"} stroke={"green"} />
                      )
                    }
                  >
                    Run
                  </ButtonLabel>
                </Button>
              </div>
            }
            type={"card"}
            defaultActiveKey="1"
            size={"small"}
            tabBarStyle={{ marginBottom: 0 }}
            activeKey={activeSecondaryTab}
            items={[
              {
                style: { height: "100%" },
                key: "event",
                label: <ButtonLabel icon={<Bug className="w-3.5 h-3.5" />}>Event</ButtonLabel>,
                children: (
                  <TabContent>
                    <CodeEditor
                      language={"json"}
                      value={event}
                      onChange={setEvent}
                      monacoOptions={{
                        renderLineHighlight: "none",
                        lineDecorationsWidth: 8,
                        lineNumbers: "off",
                        folding: false,
                      }}
                    />
                  </TabContent>
                ),
              },
              {
                key: "variables",
                style: { height: "100%" },
                label: (
                  <ButtonLabel icon={<Parentheses className="w-3.5 h-3.5" />}>
                    <div className={"flex gap-2 items-center"}>
                      <span>Test Environment Variables</span>
                    </div>
                  </ButtonLabel>
                ),
                children: (
                  <TabContent>
                    <div style={{ minWidth: 500, maxWidth: "60%" }}>
                      <FunctionVariables value={config ?? {}} onChange={setConfig} className={styles.vars} />
                    </div>
                  </TabContent>
                ),
              },
              {
                style: { height: "100%" },
                key: "result",
                label: (
                  <ButtonLabel icon={<Braces className="w-3.5 h-3.5" />}>
                    <div className={"flex gap-2 items-center"}>
                      <span>Last Run Result</span>
                      {newResult && <Dot />}
                    </div>
                  </ButtonLabel>
                ),
                children: (
                  <TabContent>
                    <FunctionResult resultType={resultType} result={result} />
                  </TabContent>
                ),
              },
              {
                style: { height: "100%" },
                key: "logs",
                label: (
                  <Badge
                    offset={[16, 0]}
                    count={unreadErrorLogs ? unreadErrorLogs : unreadLogs}
                    color={unreadErrorLogs ? "#ff0000" : "#4f46e5"}
                  >
                    <ButtonLabel icon={<Terminal className="w-3.5 h-3.5" />}>Logs</ButtonLabel>
                  </Badge>
                ),
                children: (
                  <TabContent className={"px-0"}>
                    <FunctionLogs logs={logs} className={"border-y"} showDate />
                  </TabContent>
                ),
              },
            ]}
          />
        </Splitter.Panel>
      </Splitter>
    </div>
  );
};

type EventsSelectorState = {
  entitiesLoading: boolean;
  entitiesMap: Record<string, any> | undefined;
  eventsLoading: boolean;
  events: EventsLogRecord[];
  actorId: string;
  refreshTime: Date;
  error: any;
};

const defaultState: EventsSelectorState = {
  entitiesLoading: false,
  entitiesMap: undefined,
  eventsLoading: false,
  events: [],
  actorId: "",
  refreshTime: new Date(),
  error: undefined,
};

type EventsSelectorAction = {
  [K in keyof EventsSelectorState]: {
    type: K;
    value: EventsSelectorState[K];
  };
}[keyof EventsSelectorState];

function eventSelectorReducer(state: EventsSelectorState, action: EventsSelectorAction) {
  return {
    ...state,
    [action.type]: action?.value,
  };
}

const EventsSelector = ({ selectEvent }: { selectEvent: (e: any) => void }) => {
  const workspace = useWorkspace();
  const [{ entitiesMap, entitiesLoading, events, eventsLoading, actorId, refreshTime, error }, dispatch] = useReducer(
    eventSelectorReducer,
    defaultState
  );
  const eventsLogApi = useEventsLogApi();

  const loadEvents = useCallback(
    async (entitiesMap: any, actorId: string) => {
      try {
        if (actorId && entitiesMap && entitiesMap[actorId]) {
          dispatch({ type: "eventsLoading", value: true });
          const data = await eventsLogApi.get(`incoming`, "all", actorId, {}, 100);
          dispatch({ type: "events", value: data });
          dispatch({ type: "error", value: "" });
        }
      } catch (e) {
        console.error("Error while loading events", e);
        dispatch({ type: "error", value: "Error while loading events" });
      } finally {
        dispatch({ type: "eventsLoading", value: false });
      }
    },
    [eventsLogApi]
  );
  //load entities
  useEffect(() => {
    (async () => {
      if (typeof entitiesMap !== "undefined" || entitiesLoading) {
        return;
      }
      try {
        let query = () => getConfigApi(workspace.id, "stream").list();
        dispatch({ type: "entitiesLoading", value: true });

        const data = await query();
        if (data.length > 0) {
          const mp = arrayToMap(data);
          dispatch({ type: "entitiesMap", value: mp });
          if (!actorId || !mp[actorId]) {
            dispatch({ type: "actorId", value: data[0].id });
          }
        } else {
          dispatch({ type: "entitiesMap", value: {} });
        }
        dispatch({ type: "error", value: "" });
      } catch (e) {
        console.error("Error while loading entities objects", e);
        dispatch({ type: "error", value: "Error while loading entities objects" });
      } finally {
        dispatch({ type: "entitiesLoading", value: false });
      }
    })();
  }, [entitiesMap, actorId, workspace.id, entitiesLoading]);

  useEffect(() => {
    loadEvents(entitiesMap, actorId);
  }, [loadEvents, entitiesMap, actorId, refreshTime]);

  return (
    <div className={"flex-auto w-full flex flex-col"}>
      <div className={"flex-auto w-full flex flex-row justify-between gap-x-2"}>
        <div className={"flex flex-row flex-auto items-baseline gap-x-2 mb-2"}>
          <span>Select Stream: </span>
          <Select
            notFoundContent={<div>Project doesn't have Sites</div>}
            className={"flex-auto"}
            loading={entitiesLoading}
            onChange={e => {
              dispatch({ type: "events", value: [] });
              dispatch({ type: "actorId", value: e });
            }}
            value={actorId}
            options={Object.entries(entitiesMap || {}).map(entity => ({
              value: entity[0],
              label: entity[1].name,
            }))}
          />
        </div>
        <Button
          type="primary"
          ghost
          onClick={e => {
            dispatch({ type: "events", value: [] });
            dispatch({ type: "refreshTime", value: new Date() });
          }}
        >
          Refresh
        </Button>
      </div>
      <IncomingEventsTable loading={eventsLoading} events={events} selectEvent={selectEvent} />
    </div>
  );
};

const IncomingEventsTable = ({
  loading,
  events,
  selectEvent,
}: {
  events: EventsLogRecord[];
  loading: boolean;
  selectEvent: (e: any) => void;
}) => {
  const mapEvents = events
    ? events.map(ev => {
        let ingestPayload: any = {};
        if (typeof ev.content.body === "string") {
          try {
            ingestPayload = JSON.parse(ev.content.body);
          } catch (e) {
            console.error(ev.content.body, e);
          }
        }
        const event = ingestPayload.httpPayload as AnalyticsServerEvent;
        const context = event?.context;

        return {
          id: ev.id,
          date: ev.date,
          messageId: ingestPayload.messageId,
          type: ingestPayload.type,
          event: event,
          host: context?.page?.host,
          pageURL: context?.page?.url,
          pagePath: context?.page?.path,
        };
      })
    : [];
  const columns: ColumnsType<(typeof mapEvents)[number]> = [
    {
      title: <UTCHeader />,
      dataIndex: "date",
      render: d => <UTCDate date={d} />,
      width: "12em",
    },
    {
      title: "Type",
      width: "6em",
      dataIndex: "type",
    },
    // {
    //   title: "Host",
    //   ellipsis: true,
    //   key: "host",
    //   render: (d: typeof mapEvents[number]) => {
    //     return d.host ? (
    //       <Tooltip title={d.host}>
    //         <Tag color={"geekblue"} icon={<GlobalOutlined />} className={"whitespace-nowrap"}>
    //           {d.host}
    //         </Tag>
    //       </Tooltip>
    //     ) : (
    //       <></>
    //     );
    //   },
    // },
    {
      title: "Page URL",
      ellipsis: true,
      key: "pageURL",
      render: (d: (typeof mapEvents)[number]) => <div className={"whitespace-nowrap"}>{d.pageURL}</div>,
    },
  ];

  return (
    <Table
      loading={loading}
      size={"small"}
      pagination={{ position: [], defaultPageSize: Number.MAX_SAFE_INTEGER }}
      rowKey={"id"}
      rootClassName={"cursor-pointer"}
      columns={columns}
      dataSource={mapEvents}
      onRow={(record, rowIndex) => {
        return {
          onClick: e => {
            selectEvent(record.event);
          }, // click row
        };
      }}
    />
  );
};

const ExamplesDropdown = ({ selectEvent }: { selectEvent: (e: any) => void }) => {
  const items: MenuProps["items"] = [
    {
      key: "identify",
      onClick: () => {
        selectEvent(exampleIdentifyEvent());
      },
      label: "Identify",
    },
    {
      key: "page",
      onClick: () => {
        selectEvent(examplePageEvent());
      },
      label: "Page",
    },
    {
      key: "track",
      onClick: () => {
        selectEvent(exampleTrackEvents());
      },
      label: "Track",
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={["click"]} placement="top" arrow={false}>
      <Button type="text">
        <ButtonLabel icon={<Bug className="w-3.5 h-3.5" />}>Sample Event</ButtonLabel>
      </Button>
    </Dropdown>
  );
};

const TabContent: React.FC<PropsWithChildrenClassname> = ({ children, className }) => {
  return (
    <div
      className={`h-full flex flex-col overflow-auto border-l border-r border-b px-2 py-4 ${className ?? ""}`}
      style={{ minHeight: "100%" }}
    >
      {children}
    </div>
  );
};
