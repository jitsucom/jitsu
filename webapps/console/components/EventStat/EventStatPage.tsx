import React from "react";
import { Checkbox, Radio, Skeleton, Tooltip } from "antd";
import { QuestionCircleFilled } from "@ant-design/icons";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../lib/context";
import { rpc } from "juava";
import { FakeProgressBar } from "../../pages/admin/overage-billing";
import { AlertTriangle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import classNames from "classnames";

const TotalEvents: React.FC<{ val?: number, className?: string }> = ({ val, className }) => (
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
        <Radio.Button value="custom" disabled={true}>Custom (soon)</Radio.Button>
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
type DataRow = {
  date: Date;
} & Record<EventStatus, number | undefined>;

const EventTypes: React.FC<{ value: EventStatus[]; onChange: (val: EventStatus[]) => void }> = props => {
  const [value, setValue] = React.useState<EventStatus[]>(props.value);
  return (
    <Checkbox.Group
      onChange={(_val) => {
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

function getDataTable(data: any[]) {
  if (!data) {
    return undefined;
  }
  return Object.entries(
    data
      .map(
        (r: any) =>
          ({
            date: new Date(r.dt),
            ...eventStatuses.reduce((acc, res) => ({ ...acc, [res]: r.status === res ? parseInt(r.events) : 0 }), {}),
          } as DataRow)
      )
      .reduce(
        (byDate, row: DataRow) => ({
          ...byDate,
          [row.date.toISOString()]: {
            ...eventStatuses.reduce(
              (acc, res) => ({ ...acc, [res]: (byDate[row.date.toISOString()]?.[res] || 0) + (row[res] || 0) }),
              {}
            ),
          },
        }),
        {}
      ) as Record<string, Omit<DataRow, "date">>
  )
    .reduce((acc, [date, row]) => [...acc, { date: new Date(date), ...row } as DataRow], [] as DataRow[])
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export const EventStatPage: React.FC = () => {
  const workspace = useWorkspace();
  const [period, setPeriod] = useQueryStringState("period", {
    defaultValue: "24h",
  });
  const [eventTypes, setEventTypes] = useQueryStringState("ev", {
    defaultValue: "success,error,dropped",
  });
  const currentTypesSet = new Set(eventTypes.split(",") as EventStatus[]);
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
  const remoteResult = useQuery(
    ["event-stat", workspace.slugOrId, period, granularity],
    async () => {
      return (
        await rpc(
          `/api/${
            workspace.slugOrId
          }/sql/report?start=${start.toISOString()}&end=${end.toISOString()}&statuses=${eventStatuses.join(",")}&granularity=${granularity}`
        )
      ).data;
    },
    { retry: false, staleTime: 60 * 1000, cacheTime: 5 * 60 * 1000 }
  );
  const rows: DataRow[] | undefined =
    remoteResult.status === "success" && remoteResult.data ? getDataTable(remoteResult.data) : undefined;
  console.log(`Rows`, rows);
  return (
    <div>
      <h1 className="text-3xl  mt-4 mb-4">Workspace Statistics</h1>
      <div className="border border-textDisabled px-4 py-6 rounded-lg">
        <section className="flex justify-between items-start">
          <TotalEvents
            className="ml-6"
            val={remoteResult.data
              ?.map(r => (currentTypesSet.has(r.status) ? parseInt(r.events) : 0))
              .reduce((sum, delta) => sum + delta, 0)}
          />
          <div className="flex items-center justify-end gap-2">
            <EventTypes value={eventTypes.split(",") as EventStatus[]} onChange={val => setEventTypes(val.join(","))} />
            <Period value={period} onChange={setPeriod} />
          </div>
        </section>
        <div style={{ height: "600px" }}>
          {remoteResult.isLoading && (
            <div className="flex flex-col items-center justify-center h-full">
              <FakeProgressBar durationSeconds={60} />
              <div className="mt-4 text-textLight">Hang tight, statistics is loading...</div>
            </div>
          )}
          {remoteResult.error ? (
            <div className="flex flex-col items-center justify-center h-full">
              <AlertTriangle size={64} className="text-error" />
              <div className="mt-4 text-textLight">
                Failed to load data from the server, see error console for details
              </div>
            </div>
          ) : undefined}
          {rows ? (
            <ResponsiveContainer width="100%" height="90%">
              <AreaChart
                data={rows}
                margin={{
                  top: 20,
                  right: 30,
                  left: 20,
                  bottom: 5,
                }}
              >
                <XAxis
                  dataKey="date"

                  tickFormatter={date => {
                    return granularity === "day"
                      ? date.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
                      : date.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        });
                  }}
                />
                <YAxis tickFormatter={v => v.toLocaleString("en-US")} orientation={"right"} />
                {/*<ChartTooltip formatter={(v, n) => n === "date" ? (v as Date).toISOString() : (v as number).toLocaleString("en-US")} />*/}
                <ChartTooltip
                  formatter={v => (typeof v === "number" ? v.toLocaleString("en-US") : v + "")}
                  labelFormatter={v =>
                    v instanceof Date ? v.toISOString().replace("T", " ").split(".")[0] + " UTC" : v + ""
                  }
                  wrapperStyle={{ background: "red" }}
                />
                {currentTypesSet.has("dropped") ? (
                  <Area dataKey="dropped" type="monotone" opacity={0.9} stroke="#737373" stackId="a" fill="#737373" />
                ) : undefined}
                {currentTypesSet.has("error") ? (
                  <Area
                    dataKey="error"
                    stackId="a"
                    type="monotone"
                    opacity={0.5}
                    stroke="rgb(224, 49, 48)"
                    fill="rgb(224, 49, 48)"
                  />
                ) : undefined}
                {currentTypesSet.has("success") ? (
                  <Area dataKey="success" stroke="#009140" stackId="a" type="monotone" opacity={0.5} fill="#009140" />
                ) : undefined}
              </AreaChart>
            </ResponsiveContainer>
          ) : undefined}
        </div>
      </div>
    </div>
  );
};
