import React, { useEffect } from "react";
import { Checkbox, Radio, Select, Skeleton, Tooltip } from "antd";
import { QuestionCircleFilled } from "@ant-design/icons";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../lib/context";
import { rpc } from "juava";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import classNames from "classnames";
import { buildConnectionAggregate, ConnectionAggregate, KnownEventStatus, Report } from "../../lib/shared/reporting";
import { useConfigObjectLinks, useConfigObjectList, UseConfigObjectLinkResult } from "../../lib/store";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { Chart } from "chart.js/auto";

const TotalEvents: React.FC<{ val?: number; className?: string }> = ({ val, className }) => (
  <div className={className}>
    <h3 className={classNames("text-textLight")}>Total Events</h3>
    <div className="h-10 flex items-center">
      {val || val === 0 ? (
        <div className="text-2xl">{val.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
      ) : (
        <Skeleton paragraph={false} active />
      )}
    </div>
  </div>
);

const Period: React.FC<{ value?: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const [period, setPeriod] = React.useState(value || "24h");

  return (
    <div>
      <Radio.Group
        value={period}
        onChange={e => {
          if (e.target.value !== "custom") {
            setPeriod(e.target.value);
            onChange(e.target.value);
          } else {
            alert("Custom period is not implemented yet");
          }
        }}
      >
        <Radio.Button value="24h">24H</Radio.Button>
        <Radio.Button value="7d">7D </Radio.Button>
        <Radio.Button value="1m">1 Month</Radio.Button>
        <Radio.Button value="custom" disabled={true}>
          Custom (soon)
        </Radio.Button>
      </Radio.Group>
    </div>
  );
};

export const LabelWithComment: React.FC<{ children: string; comment: string; className?: string }> = ({
  children,
  comment,
  className,
}) => {
  return (
    <div className={`flex flex-row gap-1 ${className}`}>
      <div>{children}</div>
      <Tooltip title={comment}>
        <QuestionCircleFilled />
      </Tooltip>
    </div>
  );
};

const eventStatuses = ["success", "dropped", "error"] as const;
type EventStatus = (typeof eventStatuses)[number];

const EventTypes: React.FC<{ value: EventStatus[]; onChange: (val: EventStatus[]) => void }> = props => {
  const [value, setValue] = React.useState<EventStatus[]>(props.value);
  return (
    <Checkbox.Group
      onChange={_val => {
        const newVal = _val as EventStatus[];
        if (_val.length === 0) {
          return;
        }
        setValue(newVal);
        props.onChange(newVal);
      }}
      value={value}
      options={[
        {
          label: (
            <LabelWithComment
              comment="Events that hasn't been parsed properly, not included in billed events"
              className="text-error"
            >
              Errors
            </LabelWithComment>
          ),
          value: "error",
        },
        {
          label: (
            <LabelWithComment
              comment="Events that hasn't been filtered by function, or came to a connection not connected to any destination. Those events are not included in billing"
              className="text-textLight"
            >
              Dropped
            </LabelWithComment>
          ),
          value: "dropped",
        },
        {
          label: (
            <LabelWithComment
              comment="Events that has been sucesfully sent to at least one destination"
              className="text-success"
            >
              Success
            </LabelWithComment>
          ),
          value: "success",
        },
      ]}
    />
  );
};

const ConnectionSelector = (props: { onChange: (val: string) => void; value?: string }) => {
  const links = useConfigObjectLinks();
  const allConnections = links
    .filter(l => l.type === "push")
    .reduce((acc, l) => ({ ...acc, [l.id]: l }), {} as Record<string, UseConfigObjectLinkResult>);
  const streams = useConfigObjectList("stream");
  const destinations = useConfigObjectList("destination");
  const [connectionId, setConnectionId] = React.useState(props.value || undefined);
  return (
    <>
      <Select
        placeholder={"Select connection to see statistics"}
        style={{ width: "500px" }}
        dropdownMatchSelectWidth={false}
        value={connectionId}
        defaultValue={connectionId}
        onSelect={val => {
          setConnectionId(val);
          props.onChange(val);
        }}
      >
        {Object.entries(allConnections).map(([id, connection]) => (
          <Select.Option key={id} value={id}>
            <div className="flex items-center gap-2">
              <StreamTitle stream={streams.find(s => s.id === connection.fromId)} />
              <ArrowRight className="w-3" />
              <DestinationTitle destination={destinations.find(d => d.id === connection.toId)} />
            </div>
          </Select.Option>
        ))}
      </Select>
    </>
  );
};

export const ChartView: React.FC<{
  report: ConnectionAggregate;
  dateFormat: "day" | "hour";
  status: KnownEventStatus[];
}> = ({ report, dateFormat, status }) => {
  const wrapperRef = React.useRef<HTMLCanvasElement>(null);
  const data = [...report.breakdown].sort((a, b) => a.period.getTime() - b.period.getTime());
  useEffect(() => {
    if (wrapperRef.current) {
      const chart = new Chart(wrapperRef.current as any, {
        type: "bar",
        options: {
          //for dev env double animation due to double rendering is just annoying
          animation: process.env.NODE_ENV === "development" ? false : undefined,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
          },
        },
        data: {
          labels: data.map(row =>
            dateFormat === "day"
              ? row.period.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
              : row.period.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })
          ),
          datasets: [
            status.includes("error")
              ? {
                  stack: "main",
                  label: "error",
                  backgroundColor: "rgb(224, 49, 48)",
                  data: data.map(row => row.error),
                }
              : undefined,
            status.includes("dropped")
              ? {
                  stack: "main",
                  label: "dropped",
                  backgroundColor: "#737373",
                  data: data.map(row => row.dropped),
                }
              : undefined,
            status.includes("success")
              ? {
                  stack: "main",
                  backgroundColor: "#009140",
                  data: data.map(row => row.success),
                }
              : undefined,
          ].filter(Boolean) as any,
        },
      });
      return () => {
        chart.destroy();
      };
    }
  }, [data]);

  return <canvas ref={wrapperRef} className="w-full h-full my-12"></canvas>;
};

export const EventStatPage: React.FC = () => {
  const workspace = useWorkspace();
  const [period, setPeriod] = useQueryStringState("period", {
    defaultValue: "24h",
  });
  const [eventTypes, setEventTypes] = useQueryStringState("ev", {
    defaultValue: "success,error,dropped",
  });
  const [connectionId, setConnectionId] = useQueryStringState<string | undefined>("connectionId", {
    defaultValue: undefined,
  });
  const [start, end, granularity] = (() => {
    switch (period) {
      case "24h":
        return [new Date(Date.now() - 24 * 60 * 60 * 1000), new Date(), "hour"];
      case "7d":
        return [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date(), "day"];
      case "1m":
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return [monthAgo, new Date(), "day"];
      default:
        throw new Error(`Unknown period '${period}'`);
    }
  })();
  const remoteResult = useQuery<Report>(
    ["event-stat", workspace.slugOrId, period, granularity],
    async () => {
      return Report.parse(
        await rpc(
          `/api/${
            workspace.slugOrId
          }/reports/event-stat?start=${start.toISOString()}&end=${end.toISOString()}&granularity=${granularity}`
        )
      );
    },
    { retry: false, staleTime: 0, cacheTime: 0 }
  );
  return (
    <div>
      <h1 className="text-3xl  mt-4 mb-4">Workspace Statistics</h1>
      <div className="border border-textDisabled px-4 py-6 rounded-lg">
        <section className="flex justify-between items-start">
          <div className="flex items-center justify-end gap-2 w-full">
            <ConnectionSelector value={connectionId} onChange={setConnectionId} />
            <Period value={period} onChange={setPeriod} />
          </div>
        </section>
        <div style={{ height: "600px" }}>
          {!connectionId && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="mt-4 text-textLight">Please select connection to display stat</div>
            </div>
          )}

          {connectionId && remoteResult.isLoading && (
            <div className="flex flex-col items-center justify-center h-full">
              <Loader2 className="w-12 h-12 animate-spin" />
              <div className="mt-4 text-textLight">Hang tight, statistics is loading...</div>
            </div>
          )}
          {connectionId && remoteResult.error ? (
            <div className="flex flex-col items-center justify-center h-full">
              <AlertTriangle size={64} className="text-error" />
              <div className="mt-4 text-textLight">
                Failed to load data from the server, see error console for details
              </div>
            </div>
          ) : undefined}
          {remoteResult.data && connectionId ? (
            <ChartView
              report={buildConnectionAggregate(remoteResult.data, connectionId)}
              dateFormat={granularity as any}
              status={eventTypes.split(",") as KnownEventStatus[]}
            />
          ) : undefined}
        </div>
        <div className="flex justify-end mr-4">
          <EventTypes value={eventTypes.split(",") as EventStatus[]} onChange={val => setEventTypes(val.join(","))} />
        </div>
      </div>
    </div>
  );
};
