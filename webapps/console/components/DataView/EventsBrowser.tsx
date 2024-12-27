import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { EventsLogRecord } from "../../lib/server/events-log";
import { ColumnsType } from "antd/es/table";
import { Alert, Collapse, DatePicker, Input, Select, Table, Tag, Tooltip } from "antd";
import { TableWithDrawer } from "./TableWithDrawer";
import { JSONView } from "./JSONView";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React, { ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { WLink } from "../Workspace/WLink";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import ExternalLink from "../Icons/ExternalLink";
import { AnalyticsContext, AnalyticsServerEvent, Geo as aGeo } from "@jitsu/protocols/analytics";
import Icon, {
  GlobalOutlined,
  LinkOutlined,
  QuestionCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { get, getConfigApi, useEventsLogApi } from "../../lib/useApi";
import { FunctionTitle } from "../../pages/[workspaceId]/functions";
import { FunctionConfig } from "../../lib/schema";
import { arrayToMap } from "../../lib/shared/arrays";
import { Bug, Globe, RefreshCw, Server } from "lucide-react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { ConnectionTitle, ProfileBuilderTitle } from "../../pages/[workspaceId]/connections";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { trimMiddle } from "../../lib/shared/strings";
import { countries } from "../../lib/shared/countries";
import type { RefSelectProps } from "antd/es/select";

import zlib from "zlib";
import {
  useConfigObjectLinkMutation,
  UseConfigObjectLinkResult,
  useConfigObjectLinks,
  useConfigObjectList,
  useProfileBuilders,
} from "../../lib/store";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import debounce from "lodash/debounce";

dayjs.extend(utc);
dayjs.extend(relativeTime);

const formatDate = (date: string | Date | Dayjs) => dayjs(date).utc().format("YYYY-MM-DD HH:mm:ss");

type StreamType = "incoming" | "function" | "bulker";
type Level = "all" | "error" | "info" | "debug" | "warn";
type DatesRange = [string | null, string | null];

type EventsBrowserProps = {
  streamType: StreamType;
  level: Level;
  actorId: string;
  dates: DatesRange;
  search?: string;
  patchQueryStringState: (key: string, value: any) => void;
};

type EventsBrowserState = {
  bulkerMode?: "stream" | "batch";
  eventsLoading: boolean;
  events?: EventsLogRecord[];
  initDate: Date;
  refreshTime: Date;
  previousRefreshTime?: Date;
  beforeDate?: Date;
  error?: string;
};

const defaultState: EventsBrowserState = {
  bulkerMode: undefined,
  eventsLoading: false,
  events: undefined,
  beforeDate: undefined,
  refreshTime: new Date(),
  initDate: new Date(),
};

function eventStreamReducer(state: EventsBrowserState, action: any) {
  if (action.type === "patch") {
    let ev = state.events;
    if (action.value.addEvents) {
      ev = [...(state.events ?? []), ...action.value.addEvents];
      delete action.value.addEvents;
    } else if (action.value.events) {
      ev = action.value.events;
    }
    return {
      ...state,
      ...action.value,
      events: ev,
    };
  } else if (action.type === "resetAndPatch") {
    return {
      ...state,
      error: undefined,
      events: undefined,
      beforeDate: undefined,
      refreshTime: state.initDate,
      ...action.value,
    };
  }
  return {
    ...state,
    [action.type]: action.value,
  };
}

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

export const RelativeDate: React.FC<{ date: string | Date; fromNow?: boolean }> = ({ date, fromNow = true }) => {
  return (
    <Tooltip overlayClassName="min-w-fit" title={formatDate(date)}>
      {fromNow ? `${dayjs(date).fromNow(true)} ago` : `${dayjs(date).toNow(true)}`}
    </Tooltip>
  );
};

const useMap = (initialValue: any[]) => {
  return useMemo(() => arrayToMap(initialValue), [initialValue]);
};

const DebouncedInput = ({ value, onChange, debounceMs, ...props }: any) => {
  const [state, setState] = useState(value);
  useEffect(() => {
    setState(value);
  }, [value]);
  const debouncedChange = useMemo(() => debounce(onChange, debounceMs || 500), [debounceMs, onChange]);
  return (
    <Input
      {...props}
      value={state}
      onChange={e => {
        setState(e.target.value);
        debouncedChange(e.target.value);
      }}
    />
  );
};

const EventsBrowser0 = ({
  streamType = "incoming",
  level = "all",
  actorId = "",
  dates,
  search,
  patchQueryStringState,
}: EventsBrowserProps) => {
  const workspace = useWorkspace();
  const entityType = streamType === "incoming" ? "stream" : "link";
  const connections = useConfigObjectLinks();
  const streams = useConfigObjectList("stream");
  const streamsMap = useMap(streams);
  const services = useConfigObjectList("service");
  const servicesMap = useMap(services);
  const destinations = useConfigObjectList("destination");
  const destinationsMap = useMap(destinations);
  const profileBuilders = useProfileBuilders();
  const mappedConnections = useMemo(
    () =>
      connections
        .filter(c => streamType === "bulker" || c.type === "push")
        .map(link => {
          const dst = destinationsMap[link.toId];
          const destinationType = coreDestinationsMap[dst?.destinationType];
          return {
            id: link.id,
            name: `${streamsMap[link.fromId]?.name ?? "DELETED"} → ${destinationsMap[link.toId]?.name ?? "DELETED"}`,
            mode: link.type === "sync" ? "batch" : link.data?.mode,
            stream: streamsMap[link.fromId],
            service: servicesMap[link.fromId],
            destination: dst,
            usesBulker: destinationType?.usesBulker || false,
            hybrid: destinationType?.hybrid || false,
            //usesFunctions: Array.isArray(link.data?.functions) && link.data?.functions.length > 0,
          };
        }),
    [connections, destinationsMap, servicesMap, streamType, streamsMap]
  );
  const mappedConnectionsMap = useMap(mappedConnections);
  const entities = useMemo(() => {
    return streamType == "incoming"
      ? streams
      : [
          ...mappedConnections.filter(
            link => (streamType === "bulker" && (link.usesBulker || link.hybrid)) || streamType === "function"
          ),
          ...profileBuilders.map(p => {
            const dst = destinationsMap[p.destinationId!];
            const destinationType = coreDestinationsMap[dst?.destinationType];
            return {
              ...p,
              mode: p.connectionOptions?.["mode"] || "batch",
              destination: dst,
              usesBulker: destinationType?.usesBulker || false,
              type: "profile-builder",
            };
          }),
        ];
  }, [destinationsMap, mappedConnections, profileBuilders, streamType, streams]);

  const entitiesMap = useMemo(() => {
    return streamType == "incoming" ? streamsMap : arrayToMap(entities as { id: any }[]);
  }, [streamType, streamsMap, entities]);

  const entitiesSelectOptions = useMemo(() => {
    if (entitiesMap) {
      return Object.entries(entitiesMap).map(entity => ({
        value: entity[0],
        label:
          entity[1].type === "stream" ? (
            <StreamTitle stream={entity[1]} size={"small"} />
          ) : entity[1].type === "profile-builder" ? (
            <ProfileBuilderTitle profileBuilder={entity[1]} destination={entity[1].destination} />
          ) : (
            <ConnectionTitle
              connectionId={entity[0]}
              stream={entity[1].stream}
              service={entity[1].service}
              destination={entity[1].destination}
            />
          ),
        search: (entity[1].type === "stream"
          ? [entity[1].name]
          : entity[1].type === "profile-builder"
          ? [entity[1].name, entity[1].destination?.name]
          : [entity[1].stream?.name, entity[1].service?.name, entity[1].destination?.name]
        )
          .filter(s => s !== undefined)
          .map(s => s.toLowerCase()),
      }));
    } else {
      return [];
    }
  }, [entitiesMap]);

  const [connection, setConnection] = useState<UseConfigObjectLinkResult | undefined>(undefined);
  const [
    { bulkerMode, eventsLoading, events, beforeDate, initDate, refreshTime, previousRefreshTime, error },
    dispatch,
  ] = useReducer(eventStreamReducer, defaultState, d => {
    const initDate = new Date();
    return { ...d, refreshTime: initDate, initDate };
  });

  const [shownEvents, setShownEvents] = useState<any[]>([]);

  const searchFunc = useCallback(
    value => {
      dispatch({
        type: "resetAndPatch",
        value: {},
      });
      patchQueryStringState("search", value);
    },
    [patchQueryStringState]
  );

  const [debugEnabled, setDebugEnabled] = useState(false);

  const onSaveMutation = useConfigObjectLinkMutation(async (obj: any) => {
    await get(`/api/${workspace.id}/config/link`, {
      body: obj,
    });
  });

  const eventsLogApi = useEventsLogApi();

  const entitySelectRef = React.createRef<RefSelectProps>();

  useEffect(() => {
    if (!actorId || !entitiesMap[actorId]) {
      if (entities.length > 0) {
        patchQueryStringState("actorId", entities[0].id);
      }
    }
  }, [actorId, entities, patchQueryStringState, entitiesMap]);

  useEffect(() => {
    if (events) {
      setShownEvents(events);
    }
  }, [events]);

  useEffect(() => {
    if (streamType === "function" && actorId) {
      (async () => {
        const connection = connections.find(c => c.id === actorId);
        if (connection) {
          setConnection(connection);
          setDebugEnabled(new Date(connection.data.debugTill) > new Date());
        } else {
          setConnection(undefined);
        }
      })();
    }
  }, [actorId, connections, streamType, workspace.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (connection) {
        setDebugEnabled(new Date(connection.data.debugTill) > new Date());
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [connection]);

  useEffect(() => {
    if (actorId && entitiesMap && entitiesMap[actorId]) {
      // beforeDate set to undefined along with any query changes or "Refresh" button click
      // refreshTime !== previousRefreshTime - on "Load previous events button" click
      if (!beforeDate || refreshTime !== previousRefreshTime) {
        let cancelled = false;

        dispatch({ type: "eventsLoading", value: true });
        (async () => {
          let error = "";
          let newBeforeDate: Date | undefined = undefined;
          let events: EventsLogRecord[] | undefined = undefined;
          let addEvents: EventsLogRecord[] | undefined = undefined;
          try {
            let eventsLogStream = streamType as string;
            if (streamType === "bulker") {
              if (!bulkerMode) {
                const entity = entitiesMap[actorId];
                dispatch({ type: "bulkerMode", value: entity.mode });
                return;
              }
              eventsLogStream = "bulker_" + bulkerMode;
            }
            const data = await eventsLogApi.get(
              `${eventsLogStream}`,
              level === "all" ? "all" : [level],
              actorId,
              {
                start: dates && dates[0] ? new Date(dates[0]) : undefined,
                end: beforeDate || (dates && dates[1] ? new Date(dates[1]) : undefined),
              },
              100,
              search
            );
            if (beforeDate) {
              addEvents = data;
            } else {
              events = data;
            }
            if (data.length > 0) {
              const d = dayjs(data[data.length - 1].date);
              newBeforeDate = d.toDate();
            }
          } catch (e) {
            console.error("Error while loading events", e);
            error = "Error while loading events";
          } finally {
            if (!cancelled) {
              const patch = {
                previousRefreshTime: refreshTime || new Date(),
                eventsLoading: false,
              } as any;
              if (error) {
                patch.error = error;
              } else {
                patch.error = undefined;
                if (addEvents) {
                  patch.addEvents = addEvents;
                } else if (events) {
                  patch.events = events;
                }
              }
              if (newBeforeDate) {
                patch.beforeDate = newBeforeDate;
              }
              dispatch({ type: "patch", value: patch });
            }
          }
        })();
        return () => {
          cancelled = true;
        };
      }
    }
  }, [
    eventsLogApi,
    streamType,
    entitiesMap,
    level,
    actorId,
    dates,
    bulkerMode,
    previousRefreshTime,
    refreshTime,
    beforeDate,
    search,
  ]);

  // //load more events on reaching bottom
  // useEffect(() => {
  //   let force = 0;
  //   const scrolling_function = e => {
  //     const div = document.getElementsByClassName("global-wrapper")[0];
  //     if (div.scrollHeight - div.scrollTop == div.clientHeight) {
  //       if (!eventsLoading && beforeDate) {
  //         force += -e.wheelDeltaY;
  //         document.getElementById("lmore")!.style.transform = `scale(${
  //           1 + Math.max(0, Math.min(force / 6000, 0.333))
  //         })`;
  //         if (force > 2000) {
  //           force = 0;
  //           window.removeEventListener("wheel", scrolling_function);
  //           loadEvents(streamType, entitiesMap, eventType, actorId, beforeDate, dates);
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
  // }, [loadEvents, eventsLoading, streamType, entitiesMap, eventType, actorId, dates, refreshTime, beforeDate]);

  const TableElement: React.FC<TableProps> = (function () {
    switch (streamType) {
      case "incoming":
        return IncomingEventsTable;
      case "function":
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
      <div className={"flex flex-row justify-between items-center pb-3.5"}>
        <div key={"left"}>
          <div className={"flex flex-row gap-3 mr-2"}>
            <div>
              <span>{entityType == "stream" ? "Site: " : "Connection: "}</span>
              <Select
                ref={entitySelectRef}
                popupMatchSelectWidth={false}
                notFoundContent={
                  entityType === "stream" ? (
                    <div>Project doesn't have Sites</div>
                  ) : streamType === "function" ? (
                    <div>Project doesn't have Connections using Functions</div>
                  ) : (
                    <div>Project doesn't have data warehouse Connections</div>
                  )
                }
                style={{ width: 280 }}
                onChange={e => {
                  let bulkerMode: string | undefined = undefined;
                  if (streamType === "bulker") {
                    const entity = entitiesMap[e];
                    bulkerMode = entity.mode;
                  }
                  dispatch({
                    type: "resetAndPatch",
                    value: {
                      events: [],
                      bulkerMode,
                    },
                  });
                  patchQueryStringState("actorId", e);
                }}
                value={actorId}
                options={entitiesSelectOptions}
                showSearch={true}
                filterOption={(input, option) => option?.search.some(s => s.includes(input.toLowerCase())) || false}
                onDropdownVisibleChange={o => !o && entitySelectRef.current?.blur()}
              />
            </div>
            <div>
              <span>{streamType == "function" ? "Level: " : "Status: "}</span>
              <Select
                style={{ width: 90 }}
                value={level}
                onChange={e => {
                  dispatch({
                    type: "resetAndPatch",
                    value: {},
                  });
                  patchQueryStringState("level", e);
                }}
                options={
                  streamType == "function"
                    ? [
                        { value: "all", label: "All" },
                        { value: "error", label: "ERROR" },
                        { value: "warn", label: "WARN" },
                        { value: "info", label: "INFO" },
                        { value: "debug", label: "DEBUG" },
                      ]
                    : [
                        { value: "all", label: "All" },
                        { value: "error", label: "Errors" },
                      ]
                }
              />
            </div>
            {streamType === "bulker" && (
              <div>
                <span>Mode: </span>
                <Select
                  style={{ width: 90 }}
                  value={bulkerMode}
                  onChange={e => {
                    setShownEvents([]);
                    dispatch({
                      type: "resetAndPatch",
                      value: {
                        bulkerMode: e,
                      },
                    });
                  }}
                  options={[
                    { value: "batch", label: "Batch" },
                    { value: "stream", label: "Stream" },
                  ]}
                />
              </div>
            )}
            <div className={"flex flex-row items-baseline flex-wrap"}>
              <span className={"whitespace-nowrap"}>Date range:&nbsp;</span>
              <div style={{ width: 270 }}>
                <DatePicker.RangePicker
                  value={
                    (dates ?? [null, null]).map(d => (d ? dayjs(d).utc() : null)).slice(0, 2) as [
                      Dayjs | null,
                      Dayjs | null
                    ]
                  }
                  disabledDate={d => false}
                  allowEmpty={[true, true]}
                  showTime={{
                    format: "HH:mm",
                    defaultValue: [dayjs("00:00:00.000", "HH:mm:ss.SSS"), dayjs("23:59.59.999", "HH:mm:ss.SSS")],
                  }}
                  format={date => date.format("MMM DD, HH:mm")}
                  onChange={d => {
                    if (d) {
                      patchQueryStringState("dates", [
                        d[0] ? d[0].utc(true).set("millisecond", 0).toISOString() : null,
                        d[1] ? d[1].utc(true).set("millisecond", 999).toISOString() : null,
                      ]);
                    } else {
                      patchQueryStringState("dates", [null, null]);
                    }
                    dispatch({
                      type: "resetAndPatch",
                      value: {},
                    });
                  }}
                  // onOpenChange={onOpenChange}
                />
              </div>
            </div>
            <div>
              <span>Search: </span>
              <DebouncedInput
                style={{ width: 180 }}
                value={search}
                allowClear
                onChange={e => {
                  searchFunc(e);
                }}
              />
            </div>
          </div>
        </div>
        <div key={"right"} className={"flex flex-row"}>
          {streamType === "function" && connection && (
            <Tooltip
              title={
                "Enables 'debug' level for functions logs and fetch requests verbose logging for a period of 15 minutes."
              }
            >
              <JitsuButton
                icon={<Bug className={`w-6 h-6`} />}
                type="link"
                size="small"
                onClick={e => {
                  const checked = !debugEnabled;
                  const debugTill = checked ? dayjs().add(15, "minute").toISOString() : undefined;
                  const newConnection = { ...connection, data: { ...connection.data, debugTill } };
                  setConnection(newConnection);
                  setDebugEnabled(checked);
                  onSaveMutation.mutateAsync(newConnection);
                }}
              >
                {!debugEnabled ? "Enable debug" : "Disable debug"}
              </JitsuButton>
            </Tooltip>
          )}
          <JitsuButton
            icon={<RefreshCw className={`w-6 h-6 ${eventsLoading && refreshTime !== initDate && "animate-spin"}`} />}
            type="link"
            size="small"
            onClick={e => {
              dispatch({
                type: "resetAndPatch",
                value: {
                  eventsLoading: true,
                  refreshTime: new Date(),
                },
              });
            }}
          >
            Refresh
          </JitsuButton>
        </div>
      </div>
      {debugEnabled && (
        <div className={"w-full rounded-lg border mb-3.5 p-2 bg-amber-100"}>
          Debug logging is enabled on the selected connection for{" "}
          <RelativeDate date={connection?.data.debugTill} fromNow={false} />.
        </div>
      )}
      {!error ? (
        <TableElement
          loading={eventsLoading}
          streamType={streamType}
          entityType={entityType}
          actorId={actorId}
          mappedConnections={mappedConnectionsMap}
          events={shownEvents}
          loadEvents={() =>
            dispatch({
              type: "patch",
              value: {
                eventsLoading: true,
                refreshTime: new Date(),
              },
            })
          }
        />
      ) : (
        <Alert message={error} type="error" showIcon />
      )}
    </>
  );
};

export const EventsBrowser = React.memo(EventsBrowser0);

type TableProps = {
  loading: boolean;
  events?: EventsLogRecord[];
  streamType: string;
  entityType: string;
  actorId: string;
  mappedConnections: Record<string, any>;
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

  const functionLogs = (events || ([] as EventsLogRecord[])).map((e, i) => ({
    ...e,
    id: e.date + "_" + i,
  }));

  const mapHttpBody = (r: { event: EventsLogRecord }): { event: EventsLogRecord } => {
    const e = r.event;
    if (e.content.body) {
      let string;
      if (e.content.body.type === "Buffer" && e.content.body.data) {
        if (e.content.headers?.["Content-Encoding"] === "gzip") {
          string = zlib.gunzipSync(Buffer.from(e.content.body.data)).toString();
        } else {
          string = Buffer.from(e.content.body.data).toString();
        }
      } else {
        string = e.content.body;
      }
      try {
        e.content.body = JSON.parse(string);
      } catch (er) {
        e.content.body = string;
      }
    }
    return r;
  };

  const columns: ColumnsType<EventsLogRecord> = [
    {
      title: <UTCHeader />,
      dataIndex: "date",
      width: "13em",
      render: d => <UTCDate date={d} />,
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
          case "profile":
            return (
              <WLink href={`/profile-builder`}>
                <ProfileBuilderTitle profileBuilder={{ name: "Profile Builder" }} />
              </WLink>
            );
          default:
            if (d.functionId === "profile-builder") {
              return (
                <WLink href={`/profile-builder`}>
                  <ProfileBuilderTitle profileBuilder={{ name: "Profile Builder" }} />
                </WLink>
              );
            }
            return <FunctionTitle size={"small"} title={() => d.functionId} />;
        }
      },
    },
    {
      title: "Level",
      width: "8em",
      dataIndex: ["level"],
      render: d => {
        switch (d) {
          case "error":
            return <Tag color={"red"}>ERROR</Tag>;
          case "info":
            return <Tag color={"cyan"}>INFO</Tag>;
          case "debug":
            return <Tag>DEBUG</Tag>;
          case "warn":
            return <Tag color={"orange"}>WARN</Tag>;
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
              (Array.isArray(d.message?.args) && d.message.args.length > 0
                ? `, ${d.message?.args
                    .filter(a => typeof a !== "undefined" && a !== "undefined")
                    .map(a => JSON.stringify(a).replace(/^"(.+)"$/, "$1"))
                    .join(", ")}`
                : "")
            );
          case "http-request":
            return (
              <>
                <Tag color={d.status >= 200 && d.status < 300 ? "cyan" : "orange"}>{d.status ?? "ERROR"}</Tag>
                <span>{`HTTP ${d.method} `}</span>
                <span>{d.url}</span>
              </>
            );
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
      drawerNode={event => <JSONView data={mapHttpBody(event)} />}
      columns={columns}
    />
  );
};

const StreamEventsTable = ({ loadEvents, loading, streamType, entityType, actorId, events }: TableProps) => {
  const streamEvents = events
    ? events.map((e, i) => {
        e = {
          ...e,
          id: e.date + "_" + i,
        };
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
      width: "11em",
      ellipsis: true,
      key: "type",
      className: "whitespace-nowrap",
      dataIndex: ["content", "original"],
      render: (o: any) => {
        return o?.type || o?.event;
      },
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
  const batchEvents = (events || ([] as EventsLogRecord[])).map((e, i) => ({
    ...e,
    id: e.date + "_" + i,
  }));

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
        (d.representation?.schema
          ? "Schema: " +
            Object.entries(d.representation?.schema || {})
              .map(([k, v]) => k)
              .join(", ")
          : d.representation?.response ?? ""),
    },
  ];

  return (
    <TableWithDrawer
      className="border border-backgroundDark rounded-lg"
      loading={loading}
      loadEvents={loadEvents}
      events={batchEvents}
      drawerNode={event => <JSONView data={event.event.content} />}
      columns={columns}
    />
  );
};

const IncomingEventDrawer = ({
  event,
  mappedConnections,
}: {
  event: IncomingEvent;
  mappedConnections?: Record<string, any>;
}) => {
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
      const DestinationsList = (props: { mappedConnections: Record<string, any>; destinationIds: string[] }) => {
        return (
          <div className={"flex flex-row flex-wrap gap-4"}>
            {props.destinationIds
              .map(d => props.mappedConnections[d]?.destination)
              .filter(d => typeof d !== "undefined")
              .map((d, i) => (
                <WLink key={i} href={`/destinations?id=${d.id}`}>
                  <DestinationTitle size={"small"} destination={d} />
                </WLink>
              ))}
          </div>
        );
      };

      drawerData.push({ name: <UTCHeader />, value: <UTCDate date={event.date} /> });
      drawerData.push({ name: "Source", value: event.ingestType });
      drawerData.push({ name: "Message ID", value: event.messageId });
      drawerData.push({ name: "Type", value: event.type });
      if (event.event?.event) {
        drawerData.push({ name: "Track Event Name", value: event.event.event });
      }
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
          <div className={"break-all"}>
            <a href={event.pageURL} target={"_blank"} rel={"noreferrer nopener"}>
              <ExternalLink className={"w-4 h-4"} />{" "}
            </a>
            {event.pageURL}
          </div>
        ),
      });
      drawerData.push({
        name: "Destinations",
        value: <DestinationsList mappedConnections={mappedConnections!} destinationIds={event.destinations} />,
      });
      drawerData.push({
        name: "Jitsu Domain",
        value: event.originDomain,
      });
      drawerData.push({ name: "Write Key", value: <span className={"break-all"}>{event.writeKey}</span> });
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
                dataSource={
                  event.httpHeaders
                    ? Object.entries(event.httpHeaders).map((d, i) => {
                        let name = d[0];
                        let value = d[1];
                        if (name.toLowerCase() === "authorization") {
                          value = "*** MASKED ***";
                        }
                        return { name, value };
                      })
                    : undefined
                }
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
  }, [event, mappedConnections]);

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

const Flag: React.FC<{ emoji?: string }> = ({ emoji }) => {
  return (
    <span className={`px-2 ${emoji ? "border-transparent" : "border-textDisabled"}`}>
      <span className={`${emoji ? "visible" : "invisible"}`}>{emoji || "🇺🇸"}</span>
    </span>
  );
};

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

//we should make sure that Geo object is typed in a common module.
//it is typed, but in functions lib only.
export const Geo: React.FC<{ geo?: aGeo }> = ({ geo }) => {
  if (geo?.country?.code) {
    const flag = countries[geo.country.code]?.flag;
    if (!flag) {
      return <></>;
    }
    return (
      <Tooltip
        key={"geo"}
        title={
          <div className="whitespace-pre">
            {[
              `Country: ${countries[geo.country.code]?.name || geo.country.code}`,
              geo.region?.code ? `Region: ${geo.region?.code}` : undefined,
              geo.city?.name ? `City: ${geo.city.name}` : undefined,
            ]
              .filter(s => !!s)
              .join("\n")}
            {"\n\n"}
            {geo.location && geo.location.latitude && geo.location.latitude ? (
              <>
                Location:{" "}
                <a target="_blank" href={googleMapsLink(geo.location.latitude, geo.location.longitude)}>
                  {geo.location.latitude}, {geo.location.longitude}
                </a>
              </>
            ) : undefined}
          </div>
        }
      >
        {/* Without the space after the tag below, tooltip doesn't work. Don't delete it! */}
        <Flag emoji={flag} />{" "}
      </Tooltip>
    );
  }
  return <></>;
};

type IncomingEvent = {
  id: string;
  date: string;
  ingestType: string;
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

const IncomingEventsTable = ({
  loadEvents,
  loading,
  streamType,
  entityType,
  actorId,
  events,
  mappedConnections,
}: TableProps) => {
  const appConfig = useAppConfig();
  const mapEvents = evs =>
    evs
      ? evs.map((ev, i) => {
          let ingestPayload: any = {};
          let unparsedPayload = "";
          if (typeof ev.content.body === "string" && ev.content.body.length > 0) {
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
            id: ev.date + "_" + i,
            date: ev.date,
            ingestType: ingestPayload.ingestType,

            status: ev.content.status,
            error: ev.content.error,

            ingestPayload: ingestPayload,
            unparsedPayload: unparsedPayload,

            messageId: ingestPayload.messageId,
            type: ingestPayload.type,
            originDomain:
              ingestPayload.origin?.domain ||
              (ingestPayload.origin?.slug
                ? `${ingestPayload.origin?.slug}.${appConfig.publicEndpoints.dataHost}`
                : ingestPayload.httpHeaders?.["x-forwarded-host"] || appConfig.publicEndpoints.dataHost),
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
      key: "status",
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
      key: "date",
      render: d => <UTCDate date={d} />,
      width: "12em",
    },
    {
      key: "type",
      title: "Type",
      width: "12em",
      //dataIndex: "type",
      render: (d: IncomingEvent) => {
        const eventName = d.type === "track" ? d.event?.event || d.type : d.type;
        const isDeviceEvent = d.ingestType === "browser";
        return (
          <Tooltip title={eventName}>
            <Tag
              color={isDeviceEvent ? "geekblue" : "purple"}
              icon={
                <Icon
                  component={() => (isDeviceEvent ? <Globe className="w-3 h-3" /> : <Server className="w-3 h-3" />)}
                />
              }
              className={"whitespace-nowrap"}
            >
              {trimMiddle(eventName || "", 16)}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "Page Path",
      width: "20em",
      ellipsis: true,
      key: "pagePath",
      render: (d: IncomingEvent) =>
        d.pageURL && (
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
        if (d.status == "SKIPPED" || d.status == "FAILED") {
          return (
            <div className={"flex flex-row"}>
              <Tag
                color={d.status == "SKIPPED" ? "orange" : "error"}
                icon={<WarningOutlined />}
                className={"whitespace-nowrap"}
              >
                {d.error}
              </Tag>
            </div>
          );
        }
        return (
          <div className={"flex flex-row"}>
            <Geo geo={d.context?.geo} />
            {d.host && (
              <Tooltip title={"Host"} key={"host"}>
                <Tag color={"geekblue"} icon={<GlobalOutlined />} className={"whitespace-nowrap"}>
                  {d.host}
                </Tag>
              </Tooltip>
            )}
            {d.email && (
              <Tooltip title={"Email"} key={"email"}>
                <Tag color={"green"} icon={<UserOutlined />} className={"whitespace-nowrap"}>
                  {d.email}
                </Tag>
              </Tooltip>
            )}
            {d.userId && !d.email && (
              <Tooltip title={"User ID"} key={"userId"}>
                <Tag color={"green"} icon={<UserOutlined />} className={"whitespace-nowrap"}>
                  {d.userId.toString()}
                </Tag>
              </Tooltip>
            )}
            {d.referringDomain && d.host !== d.referringDomain && (
              <Tooltip title={"Referring Domain"} key={"rDomain"}>
                <Tag color={"purple"} icon={<LinkOutlined />} className={"whitespace-nowrap"}>
                  {d.referringDomain}
                </Tag>
              </Tooltip>
            )}
            {!d.userId && d.anonymousId && (
              <Tooltip title={"Anonymous ID"} key={"anonymousId"}>
                <Tag icon={<QuestionCircleOutlined />} className={"whitespace-nowrap"}>
                  {d.anonymousId.toString()}
                </Tag>
              </Tooltip>
            )}
            {/*{d.messageId && (*/}
            {/*  <Tooltip title={"Message ID"}>*/}
            {/*    <Tag icon={<NumberOutlined />} className={"whitespace-nowrap"}>*/}
            {/*      {d.messageId}*/}
            {/*    </Tag>*/}
            {/*  </Tooltip>*/}
            {/*)}*/}
          </div>
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
      mappedConnections={mappedConnections}
      drawerNode={IncomingEventDrawer}
      columns={columns}
    />
  );
};
