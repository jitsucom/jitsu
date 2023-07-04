import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { EventsLogRecord } from "../../lib/server/events-log";
import { ColumnsType } from "antd/es/table";
import { Alert, Collapse, DatePicker, Select, Space, Spin, Table, Tag, Tooltip } from "antd";
import { TableWithDrawer } from "./TableWithDrawer";
import { JSONView } from "./JSONView";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React, { ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { linksQuery } from "../../lib/queries";
import { WLink } from "../Workspace/WLink";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import ExternalLink from "../Icons/ExternalLink";
import { AnalyticsContext, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { GlobalOutlined, LinkOutlined, NumberOutlined, QuestionCircleOutlined, UserOutlined } from "@ant-design/icons";
import { getConfigApi, useEventsLogApi } from "../../lib/useApi";
import { FunctionTitle } from "../../pages/[workspaceId]/functions";
import { FunctionConfig } from "../../lib/schema";
import { arrayToMap } from "../../lib/shared/arrays";
import { RefreshCw } from "lucide-react";
import { JitsuButton } from "../JitsuButton/JitsuButton";

dayjs.extend(utc);
dayjs.extend(relativeTime);

const formatDate = (date: string | Date) => dayjs(date).utc().format("YYYY-MM-DD HH:mm:ss");

type StreamType = "incoming" | "functions" | "bulker";
type EventType = "all" | "error";
type DatesRange = [string | null, string | null];

type EventsBrowserProps = {
  streamType: StreamType;
  eventType: "all" | "error";
  actorId: string;
  dates: DatesRange;
  patchQueryStringState: (key: string, value: any) => void;
};

type EventsBrowserState = {
  bulkerMode: "stream" | "batch";
  entitiesLoading: boolean;
  entitiesMap?: Record<string, any>;
  eventsLoading: boolean;
  events: EventsLogRecord[];
  beforeId: string;
  refreshTime: Date;
  error?: string;
};

export const UTCHeader: React.FC<{}> = () => {
  return (
    <Tooltip
      mouseEnterDelay={0}
      overlayClassName="min-w-fit"
      title={
        <>
          <span className="whitespace-nowrap">
            Current UTC Date: <b>{formatDate(new Date().toUTCString())}</b>
          </span>
        </>
      }
    >
      Date (UTC)
    </Tooltip>
  );
};

export const UTCDate: React.FC<{ date: string | Date }> = ({ date }) => {
  return (
    <Tooltip overlayClassName="min-w-fit" title={`${dayjs(date).fromNow(true)} ago`}>
      {formatDate(date)}
    </Tooltip>
  );
};

export const RelativeDate: React.FC<{ date: string | Date }> = ({ date }) => {
  return (
    <Tooltip overlayClassName="min-w-fit" title={formatDate(date)}>
      {`${dayjs(date).fromNow(true)} ago`}
    </Tooltip>
  );
};

export const EventsBrowser = ({
  streamType = "incoming",
  eventType = "all",
  actorId = "",
  dates,
  patchQueryStringState,
}: EventsBrowserProps) => {
  const workspace = useWorkspace();
  const entityType = streamType === "incoming" ? "stream" : "link";

  const defaultState: EventsBrowserState = {
    bulkerMode: "stream",
    entitiesLoading: false,
    entitiesMap: undefined,
    eventsLoading: false,
    events: [],
    beforeId: "",
    refreshTime: new Date(),
  };

  function eventStreamReducer(state: EventsBrowserState, action: any) {
    if (action.type === "addEvents") {
      return {
        ...state,
        events: [...state.events, ...action.value],
      };
    }
    return {
      ...state,
      [action.type]: action.value,
    };
  }

  const [{ bulkerMode, entitiesLoading, entitiesMap, eventsLoading, events, beforeId, refreshTime, error }, dispatch] =
    useReducer(eventStreamReducer, defaultState);

  const eventsLogApi = useEventsLogApi();

  const loadEvents = useCallback(
    async (
      streamType: StreamType,
      entitiesMap: any,
      eventType: EventType,
      actorId: string,
      beforeId: string,
      dates: DatesRange
    ) => {
      try {
        if (actorId && entitiesMap && entitiesMap[actorId]) {
          let eventsLogStream = streamType as string;
          if (streamType === "bulker") {
            const entity = entitiesMap[actorId];
            if (entity.mode === "stream") {
              dispatch({ type: "bulkerMode", value: "stream" });
              eventsLogStream = "bulker_stream";
            } else if (entity.mode === "batch") {
              dispatch({ type: "bulkerMode", value: "batch" });
              eventsLogStream = "bulker_batch";
            }
          }
          dispatch({ type: "eventsLoading", value: true });
          const data = await eventsLogApi.get(
            `${eventsLogStream}.${eventType}`,
            actorId,
            {
              beforeId: beforeId,
              start: dates && dates[0] ? dates[0] : undefined,
              end: dates && dates[1] ? dates[1] : undefined,
            },
            100
          );
          if (beforeId) {
            dispatch({ type: "addEvents", value: data });
          } else {
            dispatch({ type: "events", value: data });
          }
          if (data.length > 0) {
            dispatch({ type: "beforeId", value: data[data.length - 1].id });
          }
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
        let query: () => Promise<any[]>;
        if (streamType === "incoming") {
          query = () => getConfigApi(workspace.id, "stream").list();
        } else {
          query = async () => {
            const data = await linksQuery(workspace.id)();
            const streamsMap = arrayToMap(data[0]);
            const dstMap = arrayToMap(data[1]);
            return data[2]
              .map(link => ({
                id: link.id,
                name: `${streamsMap[link.fromId]?.name ?? "DELETED"} → ${dstMap[link.toId]?.name ?? "DELETED"}`,
                mode: link.data?.mode,
                stream: streamsMap[link.fromId],
                destination: dstMap[link.toId],
                usesBulker: typeof link.data?.mode === "string",
                //usesFunctions: Array.isArray(link.data?.functions) && link.data?.functions.length > 0,
              }))
              .filter(link => (streamType === "bulker" && link.usesBulker) || streamType === "functions");
          };
        }

        dispatch({ type: "entitiesLoading", value: true });

        const data = await query();
        if (data.length > 0) {
          const mp = arrayToMap(data);
          dispatch({ type: "entitiesMap", value: mp });
          if (!actorId || !mp[actorId]) {
            patchQueryStringState("actorId", data[0].id);
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
  }, [streamType, entitiesMap, actorId, workspace.id, patchQueryStringState, entitiesLoading]);

  useEffect(() => {
    loadEvents(streamType, entitiesMap, eventType, actorId, "", dates);
  }, [loadEvents, streamType, entitiesMap, eventType, actorId, dates, refreshTime]);

  // //load more events on reaching bottom
  // useEffect(() => {
  //   let force = 0;
  //   const scrolling_function = e => {
  //     const div = document.getElementsByClassName("global-wrapper")[0];
  //     if (div.scrollHeight - div.scrollTop == div.clientHeight) {
  //       if (!eventsLoading && beforeId) {
  //         force += -e.wheelDeltaY;
  //         document.getElementById("lmore")!.style.transform = `scale(${
  //           1 + Math.max(0, Math.min(force / 6000, 0.333))
  //         })`;
  //         if (force > 2000) {
  //           force = 0;
  //           window.removeEventListener("wheel", scrolling_function);
  //           loadEvents(streamType, entitiesMap, eventType, actorId, beforeId, dates);
  //         }
  //         if (force < 0) {
  //           force = 0;
  //         }
  //       }
  //     } else {
  //       document.getElementById("lmore")!.style.transform = "scale(1)";
  //       force = 0;
  //     }
  //   };
  //   window.addEventListener("wheel", scrolling_function);
  //   return () => {
  //     window.removeEventListener("wheel", scrolling_function);
  //   };
  // }, [loadEvents, eventsLoading, streamType, entitiesMap, eventType, actorId, dates, refreshTime, beforeId]);

  const entitiesSelectOptions = useMemo(() => {
    if (entitiesMap) {
      return Object.entries(entitiesMap).map(entity => ({
        value: entity[0],
        label:
          entity[1].type === "stream" ? (
            entity[1].name
          ) : (
            <Space>
              {entity[1].stream.name}
              {"→"}
              <DestinationTitle size={"small"} destination={entity[1].destination} />
            </Space>
          ),
      }));
    } else {
      return [];
    }
  }, [entitiesMap]);

  const TableElement: React.FC<TableProps> = (function () {
    switch (streamType) {
      case "incoming":
        return IncomingEventsTable;
      case "functions":
        return FunctionsLogTable;
      case "bulker":
        if (bulkerMode === "batch") {
          return BatchTable;
        } else {
          return StreamEventsTable;
        }
      default:
        return IncomingEventsTable;
    }
  })();
  return (
    <>
      <div className={"flex flex-row justify-between pb-3.5"}>
        <div key={"left"}>
          <div className={"flex flex-row gap-4"}>
            <div>
              <span>{entityType == "stream" ? "Sites: " : "Connection: "}</span>
              <Select
                notFoundContent={
                  entityType === "stream" ? (
                    <div>Project doesn't have Sites</div>
                  ) : streamType === "functions" ? (
                    <div>Project doesn't have Connections using Functions</div>
                  ) : (
                    <div>Project doesn't have data warehouse Connections</div>
                  )
                }
                style={{ width: 300 }}
                loading={entitiesLoading}
                onChange={e => {
                  dispatch({ type: "events", value: [] });
                  dispatch({ type: "beforeId", value: "" });
                  patchQueryStringState("actorId", e);
                }}
                value={actorId}
                options={entitiesSelectOptions}
              />
            </div>
            <div>
              <span>Statuses: </span>
              <Select
                style={{ width: 120 }}
                value={eventType}
                onChange={e => {
                  dispatch({ type: "events", value: [] });
                  dispatch({ type: "beforeId", value: "" });
                  patchQueryStringState("eventType", e);
                }}
                options={[
                  { value: "all", label: "All" },
                  { value: "error", label: "Errors only" },
                ]}
              />
            </div>
            <div>
              <span>Date range: </span>
              <DatePicker.RangePicker
                value={
                  (dates ?? [null, null]).map(d => (d ? dayjs(d, "YYYY-MM-DD") : null)).slice(0, 2) as [
                    Dayjs | null,
                    Dayjs | null
                  ]
                }
                disabledDate={d => false}
                allowEmpty={[true, true]}
                onChange={d => {
                  if (d) {
                    patchQueryStringState("dates", [
                      d[0] ? d[0].format("YYYY-MM-DD") : null,
                      d[1] ? d[1].format("YYYY-MM-DD") : null,
                    ]);
                  } else {
                    patchQueryStringState("dates", [null, null]);
                  }
                  dispatch({ type: "events", value: [] });
                  dispatch({ type: "beforeId", value: "" });
                }}
                // onOpenChange={onOpenChange}
              />
            </div>
          </div>
        </div>
        <div key={"right"}>
          <JitsuButton
            icon={<RefreshCw className="w-6 h-6" />}
            type="link"
            size="small"
            onClick={e => {
              dispatch({ type: "events", value: [] });
              dispatch({ type: "beforeId", value: "" });
              dispatch({ type: "refreshTime", value: new Date() });
            }}
          >
            Refresh
          </JitsuButton>
        </div>
      </div>
      {!error ? (
        <TableElement
          loading={eventsLoading || entitiesLoading}
          streamType={streamType}
          entityType={entityType}
          actorId={actorId}
          events={events}
          loadEvents={() => loadEvents(streamType, entitiesMap, eventType, actorId, beforeId, dates)}
        />
      ) : (
        <Alert message={error} type="error" showIcon />
      )}
    </>
  );
};

type TableProps = {
  loading: boolean;
  events?: EventsLogRecord[];
  streamType: string;
  entityType: string;
  actorId: string;

  loadEvents: () => void;
};

const FunctionsLogTable = ({ loadEvents, loading, streamType, entityType, actorId, events }: TableProps) => {
  const workspace = useWorkspace();
  const [funcsMap, setFuncsMap] = useState<Record<string, FunctionConfig>>({});

  useEffect(() => {
    (async () => {
      try {
        const funcs = await getConfigApi(workspace.id, "function").list();
        setFuncsMap(arrayToMap(funcs));
      } catch (e) {}
    })();
  }, [workspace.id]);

  const functionLogs = events
    ? events.map(e => {
        e = { ...e };
        if (e.content.body) {
          try {
            e.content.body = JSON.parse(e.content.body);
          } catch (e) {}
        }
        return e;
      })
    : ([] as EventsLogRecord[]);

  const columns: ColumnsType<EventsLogRecord> = [
    {
      title: <UTCHeader />,
      dataIndex: "date",
      width: "13em",
      render: d => <UTCDate date={d} />,
    },
    {
      title: "Type",
      width: "6em",
      dataIndex: ["content"],
      key: "type",
      render: d => {
        switch (d.type) {
          case "log-error":
          case "log-info":
          case "log-debug":
          case "log-warn":
            return "log";
          case "http-request":
            return "http";
          default:
            return streamType;
        }
      },
    },
    {
      title: "Function",
      width: "14em",
      dataIndex: ["content"],
      key: "func",
      className: "whitespace-nowrap",
      render: d => {
        switch (d.functionType) {
          case "udf":
            return (
              <WLink href={`/functions?id=${d.functionId}`}>
                <FunctionTitle size={"small"} f={funcsMap[d.functionId]} />
              </WLink>
            );
          default:
            return <FunctionTitle size={"small"} title={() => d.functionId} />;
        }
      },
    },
    {
      title: "Status",
      width: "8em",
      dataIndex: ["content"],
      key: "status",
      render: d => {
        switch (d.type) {
          case "log-error":
            return <Tag color={"red"}>ERROR</Tag>;
          case "log-info":
            return <Tag color={"cyan"}>INFO</Tag>;
          case "log-debug":
            return <Tag>DEBUG</Tag>;
          case "log-warn":
            return <Tag color={"orange"}>WARN</Tag>;
          case "http-request":
            return <Tag color={d.status >= 200 && d.status < 300 ? "cyan" : "red"}>{d.status ?? "ERROR"}</Tag>;
          default:
            return <Tag color={"cyan"}>{d.status}</Tag>;
        }
      },
    },
    {
      title: "Summary",
      ellipsis: true,
      dataIndex: "content",
      render: d => {
        switch (d.type) {
          case "log-error":
          case "log-info":
          case "log-debug":
          case "log-warn":
            return (
              d.message?.text +
              (Array.isArray(d.message?.args) && d.message.args.length > 0 ? `, ${d.message?.args.join(",")}` : "")
            );
          case "http-request":
            return `${d.method} ${d.url}`;
          default:
            return d.body || d.error;
        }
      },
    },
  ];

  return (
    <TableWithDrawer
      loading={loading}
      loadEvents={loadEvents}
      className="border border-backgroundDark rounded-lg"
      events={functionLogs}
      drawerNode={event => <JSONView data={event} />}
      columns={columns}
    />
  );
};

const StreamEventsTable = ({ loadEvents, loading, streamType, entityType, actorId, events }: TableProps) => {
  const streamEvents = events
    ? events.map(e => {
        e = { ...e };
        if (e.content.original) {
          try {
            e.content.original = JSON.parse(e.content.original);
          } catch (e) {}
        }
        return e;
      })
    : ([] as EventsLogRecord[]);

  const columns: ColumnsType<EventsLogRecord> = [
    {
      title: <UTCHeader />,
      dataIndex: "date",
      width: "13em",
      render: d => <UTCDate date={d} />,
    },
    {
      title: "Type",
      width: "8em",
      dataIndex: ["content", "original", "type"],
    },
    {
      title: "Page Host",
      width: "12em",
      ellipsis: true,
      dataIndex: ["content", "original", "context", "page", "host"],
      key: "host",
    },
    {
      title: "Status",
      width: "8em",
      dataIndex: ["content", "status"],
      key: "status_color",
      render: (d: string) => {
        return <Tag color={d === "SUCCESS" ? "cyan" : "red"}>{d}</Tag>;
      },
    },
    // {
    //   title: "Message ID",
    //   width: "23em",
    //   dataIndex: "content",
    //   key: "mid",
    //   render: d => <div className={"whitespace-nowrap"}>{d.original?.message_id}</div>,
    // },
    {
      title: "Table name",
      width: "12em",
      ellipsis: true,
      dataIndex: ["content", "representation", "name"],
    },
    {
      title: "Summary",
      ellipsis: true,
      dataIndex: "content",
      render: d =>
        d.error ||
        "Schema: " +
          Object.entries(d.representation?.schema || {})
            .map(([k, v]) => k)
            .join(", "),
    },
  ];

  return (
    <TableWithDrawer
      className="border border-backgroundDark rounded-lg"
      loading={loading}
      loadEvents={loadEvents}
      events={streamEvents}
      drawerNode={e => <JSONView data={e.event.content} />}
      columns={columns}
    />
  );
};

const BatchTable = ({ loadEvents, loading, streamType, entityType, actorId, events }: TableProps) => {
  const columns: ColumnsType<EventsLogRecord> = [
    {
      title: <UTCHeader />,
      dataIndex: "date",
      width: "13em",
      render: d => <UTCDate date={d} />,
    },
    {
      title: "Batch size",
      width: "7em",
      dataIndex: ["content", "processedRows"],
      key: "size",
    },
    {
      title: "Status",
      width: "8em",
      dataIndex: ["content", "status"],
      key: "status",
      render: (d: string) => {
        return <Tag color={d === "COMPLETED" ? "cyan" : "red"}>{d}</Tag>;
      },
    },
    {
      title: "Table name",
      width: "20em",
      ellipsis: true,
      dataIndex: ["content", "representation", "name"],
    },
    {
      title: "Summary",
      ellipsis: true,
      dataIndex: "content",
      render: d =>
        d.error ||
        "Schema: " +
          Object.entries(d.representation?.schema || {})
            .map(([k, v]) => k)
            .join(", "),
    },
  ];

  return (
    <TableWithDrawer
      className="border border-backgroundDark rounded-lg"
      loading={loading}
      loadEvents={loadEvents}
      events={events}
      drawerNode={event => <JSONView data={event} />}
      columns={columns}
    />
  );
};

const IncomingEventDrawer = ({ event }: { event: IncomingEvent }) => {
  const workspace = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [destinationsMap, setDestinationsMap] = useState<any[]>([]);

  const hasEvent = typeof event !== "undefined";
  useEffect(() => {
    if (!event) return;
    linksQuery(workspace.id)()
      .then(data => {
        const streamsMap = arrayToMap(data[0]);
        const dstMap = arrayToMap(data[1]);
        return data[2].map(link => ({
          id: link.id,
          name: `${streamsMap[link.fromId]?.name ?? "DELETED"} → ${dstMap[link.toId]?.name ?? "DELETED"}`,
          mode: link.data?.mode,
          stream: streamsMap[link.fromId],
          destination: dstMap[link.toId],
          usesBulker: typeof link.data?.mode === "string",
        }));
      })
      .then(d => {
        console.log("destinations", d);
        setDestinationsMap(arrayToMap(d));
      })
      .finally(() => setLoading(false));
  }, [hasEvent, event, workspace.id]);

  const drawerColumns: ColumnsType<any> = [
    {
      title: "Name",
      dataIndex: "name",
      width: "10em",
      className: "align-top whitespace-nowrap",
    },
    {
      title: "Value",
      dataIndex: "value",
    },
  ];

  const drawerData = useMemo(() => {
    const drawerData: { name: ReactNode; value: ReactNode }[] = [];
    if (event) {
      const DestinationsList = (props: {
        loading: boolean;
        destinationsMap: Record<string, any>;
        destinationIds: string[];
      }) => {
        return props.loading ? (
          <Spin />
        ) : (
          <Space wrap size={"large"}>
            {props.destinationIds
              .map(d => props.destinationsMap[d]?.destination)
              .filter(d => typeof d !== "undefined")
              .map((d, i) => (
                <WLink key={i} href={`/destinations?id=${d.id}`}>
                  <DestinationTitle size={"small"} destination={d} />
                </WLink>
              ))}
          </Space>
        );
      };

      drawerData.push({ name: <UTCHeader />, value: <UTCDate date={event.date} /> });
      drawerData.push({ name: "Message ID", value: event.messageId });
      drawerData.push({ name: "Type", value: event.type });
      drawerData.push({
        name: "Status",
        value: (st => {
          switch (st) {
            case "FAILED":
              return <Tag color={"red"}>{st}</Tag>;
            case "SUCCESS":
              return <Tag color={"cyan"}>{st}</Tag>;
            case "SKIPPED":
              return <Tag color={"orange"}>{st}</Tag>;
            default:
              return <Tag>{st}</Tag>;
          }
        })(event.status),
      });
      if (event.error) {
        drawerData.push({ name: "Error", value: event.error });
      }
      drawerData.push({ name: "User ID", value: event.userId });
      drawerData.push({
        name: "Email",
        value: event.email,
      });
      drawerData.push({ name: "Anonymous ID", value: event.anonymousId });
      drawerData.push({ name: "Page Title", value: event.pageTitle });
      drawerData.push({
        name: "Page URL",
        value: (
          <>
            <a href={event.pageURL} target={"_blank"} rel={"noreferrer nopener"}>
              <ExternalLink className={"w-4 h-4"} />{" "}
            </a>
            {event.pageURL}
          </>
        ),
      });
      drawerData.push({
        name: "Destinations",
        value: (
          <DestinationsList loading={loading} destinationsMap={destinationsMap} destinationIds={event.destinations} />
        ),
      });
      drawerData.push({
        name: "Jitsu Domain",
        value: event.originDomain,
      });
      drawerData.push({ name: "Write Key", value: event.writeKey });
      drawerData.push({
        name: "HTTP Headers",
        value: (
          <Collapse className={"headers-collapse"} size={"small"} ghost={true}>
            <Collapse.Panel header="HTTP headers" key="1" showArrow={true}>
              <Table
                showHeader={false}
                className={"headers-table"}
                rowKey={"name"}
                bordered={true}
                size={"small"}
                pagination={false}
                columns={[
                  { dataIndex: "name", width: "14em", className: "font-mono" },
                  { dataIndex: "value", className: "break-all font-mono" },
                ]}
                dataSource={Object.entries(event.httpHeaders).map((d, i) => {
                  let name = d[0];
                  let value = d[1];
                  if (name.toLowerCase() === "authorization") {
                    value = "*** MASKED ***";
                  }
                  return { name, value };
                })}
              />
            </Collapse.Panel>
          </Collapse>
        ),
      });
      drawerData.push({
        name: "Event Payload",
        value: <JSONView data={event.event} />,
      });
    }
    return drawerData;
  }, [event, destinationsMap, loading]);

  return event ? (
    <Table
      bordered={true}
      size={"middle"}
      showHeader={false}
      rowKey={"name"}
      pagination={false}
      columns={drawerColumns}
      dataSource={drawerData}
    />
  ) : (
    <></>
  );
};

type IncomingEvent = {
  id: string;
  date: string;
  status: string;
  error: string;

  ingestPayload: any;
  unparsedPayload: string;

  messageId: string;
  type?: string;
  originDomain: string;
  writeKey: string;
  httpHeaders: Record<string, string>;

  event?: AnalyticsServerEvent;
  context?: AnalyticsContext;

  host?: string;
  pagePath?: string;
  pageURL?: string;
  pageTitle?: string;
  userId?: string;
  email?: string;
  anonymousId?: string;
  referringDomain?: string;

  destinations: string[];
};

const IncomingEventsTable = ({ loadEvents, loading, streamType, entityType, actorId, events }: TableProps) => {
  const appConfig = useAppConfig();
  const mapEvents = evs =>
    evs
      ? evs.map(ev => {
          let ingestPayload: any = {};
          let unparsedPayload = "";
          if (typeof ev.content.body === "string") {
            unparsedPayload = ev.content.body;
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
            status: ev.content.status,
            error: ev.content.error,

            ingestPayload: ingestPayload,
            unparsedPayload: unparsedPayload,

            messageId: ingestPayload.messageId,
            type: ingestPayload.type,
            originDomain:
              ingestPayload.origin?.domain || `${ingestPayload.origin?.slug}.${appConfig.publicEndpoints.dataHost}`,
            writeKey: ingestPayload.writeKey,
            httpHeaders: ingestPayload.httpHeaders,

            event: event,
            context: context,

            host: context?.page?.host,
            pageURL: context?.page?.url,
            pagePath: context?.page?.path,
            pageTitle: context?.page?.title,
            userId: event?.userId,
            email: context?.traits?.email || event?.traits?.email,
            anonymousId: event?.anonymousId,

            referringDomain: context?.page?.referring_domain,

            destinations: [...(ev.content.asyncDestinations ?? []), ...(ev.content.tags ?? [])],
          } as IncomingEvent;
        })
      : [];
  const columns: ColumnsType<IncomingEvent> = [
    {
      title: "",
      width: "2em",
      dataIndex: "status",
      render: d => {
        switch (d) {
          case "FAILED":
            return <Tag color={"red"}>&nbsp;</Tag>;
          case "SUCCESS":
            return <Tag color={"cyan"}>&nbsp;</Tag>;
          case "SKIPPED":
            return <Tag color={"orange"}>&nbsp;</Tag>;
          default:
            return <Tag>&nbsp;</Tag>;
        }
      },
    },
    {
      title: <UTCHeader />,
      dataIndex: "date",
      render: d => <UTCDate date={d} />,
      width: "12em",
    },
    {
      title: "Type",
      width: "8em",
      dataIndex: "type",
    },
    {
      title: "Page Path",
      width: "20em",
      ellipsis: true,
      key: "pagePath",
      render: (d: IncomingEvent) => (
        <div className={"whitespace-nowrap"}>
          <a href={d.pageURL} target={"_blank"} rel={"noreferrer noopener"}>
            <ExternalLink className={"w-3.5 h-3.5"} />{" "}
          </a>
          {d.pagePath}
        </div>
      ),
    },
    {
      title: "Summary",
      ellipsis: true,
      key: "summary",
      render: (d: IncomingEvent) => {
        return (
          <Space>
            {d.host && (
              <Tooltip title={"Host"}>
                <Tag color={"geekblue"} icon={<GlobalOutlined />} className={"whitespace-nowrap"}>
                  {d.host}
                </Tag>
              </Tooltip>
            )}
            {d.email && (
              <Tooltip title={"Email"}>
                <Tag color={"green"} icon={<UserOutlined />} className={"whitespace-nowrap"}>
                  {d.email}
                </Tag>
              </Tooltip>
            )}
            {d.userId && !d.email && (
              <Tooltip title={"User ID"}>
                <Tag color={"green"} icon={<UserOutlined />} className={"whitespace-nowrap"}>
                  {d.userId}
                </Tag>
              </Tooltip>
            )}
            {d.referringDomain && d.host !== d.referringDomain && (
              <Tooltip title={"Referring Domain"}>
                <Tag color={"purple"} icon={<LinkOutlined />} className={"whitespace-nowrap"}>
                  {d.referringDomain}
                </Tag>
              </Tooltip>
            )}
            {!d.userId && d.anonymousId && (
              <Tooltip title={"Anonymous ID"}>
                <Tag icon={<QuestionCircleOutlined />} className={"whitespace-nowrap"}>
                  {d.anonymousId}
                </Tag>
              </Tooltip>
            )}
            {d.messageId && (
              <Tooltip title={"Message ID"}>
                <Tag icon={<NumberOutlined />} className={"whitespace-nowrap"}>
                  {d.messageId}
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <TableWithDrawer
      className="border border-backgroundDark rounded-lg"
      loading={loading}
      loadEvents={loadEvents}
      events={mapEvents(events)}
      drawerNode={IncomingEventDrawer}
      columns={columns}
    />
  );
};
