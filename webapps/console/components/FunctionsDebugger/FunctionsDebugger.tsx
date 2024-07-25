import React, { useCallback, useEffect, useReducer, useState } from "react";
import { EditorComponentProps } from "../ConfigObjectEditor/ConfigEditor";
import { Badge, Button, Descriptions, Drawer, Dropdown, Input, MenuProps, Select, Table } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { CodeEditor } from "../CodeEditor/CodeEditor";
import styles from "./FunctionsDebugger.module.css";
import { Check, Pencil, X } from "lucide-react";
import { getConfigApi, useEventsLogApi } from "../../lib/useApi";
import { EventsLogRecord } from "../../lib/server/events-log";
import { useWorkspace } from "../../lib/context";
import { arrayToMap } from "../../lib/shared/arrays";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { ColumnsType } from "antd/es/table";
import { UTCDate, UTCHeader } from "../DataView/EventsBrowser";
import { examplePageEvent, exampleTrackEvents, exampleIdentifyEvent } from "./example_events";
import { rpc } from "juava";
import { logType } from "@jitsu/core-functions";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import Convert from "ansi-to-html";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { defaultFunctionTemplate } from "./code_templates";
import { FunctionConfig } from "../../lib/schema";
import { useRouter } from "next/router";
import { feedbackError } from "../../lib/ui";
import { Htmlizer } from "../Htmlizer/Htmlizer";
import Link from "next/link";
import { CodeBlockLight } from "../CodeBlock/CodeBlockLight";
import { useStoreReload } from "../../lib/store";

const convert = new Convert({ newline: true });
const localDate = (date: string | Date) => dayjs(date).format("YYYY-MM-DD HH:mm:ss");

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
              className="text-2xl"
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
            className="text-2xl my-2 cursor-pointer"
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

const CodeViewer: React.FC<{ code: string }> = ({ code }) => {
  const [showCode, setShowCode] = useState(false);

  return (
    <div>
      <button className="text-primary" onClick={() => setShowCode(!showCode)}>
        {showCode ? "Hide code" : "View compiled code"} »
      </button>
      {showCode && (
        <CodeBlockLight
          className="mt-2 bg-background text-xs py-2 px-3 rounded-lg max-h-60 overflow-y-auto "
          lang="javascript"
        >
          {code}
        </CodeBlockLight>
      )}
    </div>
  );
};

export const FunctionsDebugger: React.FC<FunctionsDebuggerProps> = props => {
  const { push } = useRouter();

  const workspace = useWorkspace();
  const [showLogs, setShowLogs] = useState(false);
  // const [showConfig, setShowConfig] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [event, setEvent] = useState<any>(JSON.stringify(examplePageEvent(), undefined, 2));
  const [obj, setObj] = useState<Partial<FunctionConfig>>({
    ...props.object,
    code: props.isNew ? defaultFunctionTemplate() : props.object.code ?? "",
  });

  const [config, setConfig] = useState<any>("{}");
  const [store, setStore] = useState<any>({});
  const [result, setResult] = useState<any>({});
  const [resultType, setResultType] = useState<"ok" | "drop" | "error">("ok");
  const [logs, setLogs] = useState<logType[]>([]);
  const [unreadErrorLogs, setUnreadErrorLogs] = useState(0);
  const [unreadLogs, setUnreadLogs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const reloadStore = useStoreReload();

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
  }, [props.isNew, obj, workspace.id, push]);

  const runFunction = useCallback(async () => {
    setRunning(true);
    let body = {};
    try {
      body = {
        functionId: obj.id,
        functionName: obj.name,
        code: obj.code,
        event: JSON.parse(event),
        config: JSON.parse(config),
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

      if (!showLogs) {
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
  }, [workspace.id, obj.code, event, config, store, obj.id, obj.name, showLogs]);

  return (
    <div className="flex flex-col h-full">
      <div className="w-full flex-auto  overflow-auto">
        <div className={"w-full h-full flex flex-col overflow-auto relative rounded-lg"}>
          <div className={`shrink ${obj.origin === "jitsu-cli" ? "" : "basis-3/5"} overflow-auto flex flex-col`}>
            <div className="pl-2">
              <EditableTitle
                onUpdate={name => {
                  setObj({ ...obj, name });
                }}
              >
                {obj.name || "New function"}
              </EditableTitle>
            </div>
            <div className={"flex flex-row items-end justify-between mt-2 mb-2"}>
              <div>
                <h2 className="text-lg pl-2">{obj.origin === "jitsu-cli" ? "Info:" : "Code:"}</h2>
              </div>
              <div className={"space-x-4"}>
                <Button type="primary" ghost disabled={saving} onClick={() => push(`/${workspace.id}/functions`)}>
                  Cancel
                </Button>
                {/*<Button*/}
                {/*  type="default"*/}
                {/*  disabled={saving}*/}
                {/*  onClick={() => setShowConfig(!showConfig)}*/}
                {/*  icon={<Settings className={"inline-block anticon"} size={"1em"} />}*/}
                {/*>*/}
                {/*  Config*/}
                {/*</Button>*/}
                <Button
                  type="default"
                  loading={running}
                  disabled={saving}
                  icon={<PlayCircleOutlined />}
                  onClick={runFunction}
                >
                  Run
                </Button>
                <Button type="primary" disabled={saving} onClick={save}>
                  Save
                </Button>
              </div>
            </div>
            <div className={"flex-auto flex flex-row h-full gap-x-4 overflow-auto"}>
              {obj.origin === "jitsu-cli" ? (
                <Descriptions
                  bordered
                  className={`${styles.editor} flex-auto pl-2 bg-backgroundLight`}
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
                  {obj.description && <Descriptions.Item label="Description">{obj.description}</Descriptions.Item>}
                  {
                    <Descriptions.Item label="Code">
                      <div className="text-sm">
                        <div className="mb-6">
                          The function is compiled and deployed with{" "}
                          <Link href="https://docs.jitsu.com/functions/sdk">
                            <code>jitsu-cli</code>
                          </Link>{" "}
                          and can't be edited in the UI. However, you can still run it with different events and see the
                          results below. And you can view the code
                        </div>

                        <CodeViewer code={obj.code as string} />
                      </div>
                    </Descriptions.Item>
                  }
                </Descriptions>
              ) : (
                <div className={`${styles.editor} flex-auto pl-2 bg-backgroundLight`}>
                  <CodeEditor
                    width={"99.9%"}
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
                </div>
              )}
              {/*<div className={`${styles.editor} ${showConfig ? "block" : "hidden"} flex-auto w-1/3 bg-backgroundLight`}>*/}
              {/*  <div className={"jitsu-label-borderless"}>Config</div>*/}
              {/*  <CodeEditor*/}
              {/*    width={"99.9%"}*/}
              {/*    language={"json"}*/}
              {/*    value={config}*/}
              {/*    onChange={setConfig}*/}
              {/*    monacoOptions={{ lineNumbers: "off" }}*/}
              {/*  />*/}
              {/*</div>*/}
            </div>
          </div>
          <div className={`flex-auto ${obj.origin === "jitsu-cli" ? "" : "basis-2/5"} overflow-auto`}>
            <div className={"flex flex-row h-full gap-x-4"}>
              <div className={"flex-auto h-full w-1/2 flex flex-col"}>
                <div className={"flex-auto w-full flex flex-row justify-between mt-2 mb-2 items-end"}>
                  <div>
                    <h2 className="text-lg pl-2">Event:</h2>
                  </div>
                  <div className={"space-x-2"}>
                    <ExamplesDropdown selectEvent={e => setEvent(JSON.stringify(e, undefined, 2))} />
                    <Button type={"primary"} ghost onClick={() => setShowEvents(!showEvents)}>
                      Get Live Event
                    </Button>
                  </div>
                </div>
                <div className={`${styles.editor} flex-auto bg-backgroundLight w-full pl-2`}>
                  <CodeEditor
                    width={"99.9%"}
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
                </div>
              </div>
              <div className={`flex-auto h-full w-1/2 flex flex-col ${showLogs ? "hidden" : "block"}`}>
                <div className={"flex-auto w-full flex flex-row flex-shrink justify-between mt-2 mb-2 items-end"}>
                  <div>
                    <h2 className="text-lg pl-2">Result:</h2>
                  </div>
                  <Badge
                    offset={[-11, 3]}
                    count={unreadErrorLogs ? unreadErrorLogs : unreadLogs}
                    color={unreadErrorLogs ? "#ff0000" : "#4f46e5"}
                  >
                    <Button
                      type={"default"}
                      onClick={() => {
                        setShowLogs(true);
                        setUnreadErrorLogs(0);
                        setUnreadLogs(0);
                      }}
                    >
                      Show Logs
                    </Button>
                  </Badge>
                </div>
                <div className={`${styles.editor} flex-auto h-full bg-backgroundLight w-full pl-2`}>
                  {resultType === "error" && (
                    <div className={"font-mono p-2 text-xs"}>
                      <Htmlizer>
                        {`<span class="text-red-600"><b>${result.name}:</b></span> ` +
                          convert.toHtml(result.message.replaceAll(" ", "&nbsp;"))}
                      </Htmlizer>
                      {result.name === DropRetryErrorName && (
                        <div className={"pt-1"}>
                          If such error will happen on an actual event, it will be <b>SKIPPED</b> and retry will be
                          scheduled in{" "}
                          {result.retryPolicy?.delays?.[0] ? Math.min(result.retryPolicy.delays[0], 1440) : 5} minutes.
                        </div>
                      )}
                      {result.name === RetryErrorName && (
                        <div className={"pt-1"}>
                          If such error will happen on an actual event, this function will be scheduled
                          <br />
                          for retry in{" "}
                          {result.retryPolicy?.delays?.[0] ? Math.min(result.retryPolicy.delays[0], 1440) : 5} minutes,
                          but event will be processed further.
                        </div>
                      )}
                    </div>
                  )}
                  {resultType === "drop" && (
                    <div className={"font-mono p-2 text-xs"}>
                      Further processing will be <b>SKIPPED</b>. Function returned:{" "}
                      <code>{JSON.stringify(result)}</code>.
                    </div>
                  )}
                  {resultType === "ok" && (
                    <CodeEditor
                      width={"99.9%"}
                      language={typeof result !== "string" ? "json" : "text"}
                      value={typeof result !== "string" ? JSON.stringify(result, null, 2) : result}
                      onChange={s => {}}
                      monacoOptions={{
                        renderLineHighlight: "none",
                        lineDecorationsWidth: 8,
                        lineNumbers: "off",
                        readOnly: true,
                        folding: false,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className={`flex-auto h-full w-1/2 flex flex-col ${showLogs ? "block" : "hidden"}`}>
                <div className={"flex-auto w-full flex flex-row justify-between mt-2 mb-2 items-end"}>
                  <div>
                    <h2 className="text-lg pl-2">Logs:</h2>
                  </div>
                  <Button type={"default"} onClick={() => setShowLogs(false)}>
                    Show Results
                  </Button>
                </div>
                <div
                  className={`${styles.logs} flex-auto flex flex-col place-content-start flex-nowrap pb-4 bg-backgroundLight w-full h-full`}
                >
                  {logs.map((log, index) => {
                    const colors = (() => {
                      switch (log.level) {
                        case "error":
                          return { text: "#A4000F", bg: "#FDF3F5", border: "#F8D6DB" };
                        case "debug":
                          return { text: "#646464", bg: "#FBF3F5", border: "#FBF3F5" };
                        case "warn":
                          return { text: "#705100", bg: "#FFFBD6", border: "#F4E89A" };
                        default:
                          return { text: "black", bg: "white", border: "#eaeaea" };
                      }
                    })();
                    return (
                      <div
                        key={index}
                        style={{ borderColor: colors.border, backgroundColor: colors.bg }}
                        className={"font-mono text-xs shrink-0 gap-x-6 w-full flex flex-row border-b py-0.5 px-3"}
                      >
                        {/*<div className={"text-textLight whitespace-nowrap"}>{localDate(log.timestamp)}</div>*/}
                        <div
                          style={{ color: colors.text }}
                          className={"w-10 flex-grow-0 flex-shrink-0 whitespace-nowrap"}
                        >
                          {log.level.toUpperCase()}
                        </div>
                        <div style={{ color: colors.text }} className={"flex-auto whitespace-pre-wrap break-all"}>
                          {log.message}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
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
        </div>
      </div>
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
      <Button type={"primary"} ghost>
        Sample Event
      </Button>
    </Dropdown>
  );
};
