import React, { useEffect } from "react";
import { Button, DatePicker } from "antd";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { useWorkspace } from "../../lib/context";
import dayjs, { Dayjs } from "dayjs";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { ActiveEventsReport } from "../../lib/shared/reporting";
import { Chart } from "chart.js/auto";

export const ChartView: React.FC<{ data: ActiveEventsReport }> = ({ data }) => {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wrapperRef.current) {
      const chart = new Chart(wrapperRef.current.getElementsByTagName("canvas").item(0)!, {
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
          scales: {
            x: {
              grid: {
                display: false,
              },
            },
            y: {
              grid: {
                display: false,
              },
            },
          },
        },

        data: {
          labels: data.breakdown.map(row => dayjs(row.period).utc().format("MMM D")),
          datasets: [
            {
              stack: "main",
              backgroundColor: "#009140",
              data: data.breakdown.map(row => row.activeEvents),
            },
          ],
        },
      });
      return () => {
        chart.destroy();
      };
    }
  }, [data]);
  return (
    <div ref={wrapperRef} className="h-full relative">
      <div className="absolute -translate-y-full pb-8">
        <div className="text-textLight">Total Acive Events</div>
        <div className="text-2xl">{data.totalActiveEvents.toLocaleString("en-US")}</div>
      </div>
      <canvas className="w-full h-full my-12"></canvas>
    </div>
  );
};

export function roundDay(how: "start" | "end", date: Dayjs | Date | string | undefined): Dayjs {
  const d = dayjs(date);
  if (how === "start") {
    return d.utc().startOf("day");
  } else {
    return d.utc().endOf("day").add(-1, "millisecond");
  }
}

export const ChartLoader: React.FC<{ start: Dayjs; end: Dayjs }> = ({ start, end }) => {
  const workspace = useWorkspace();
  const { isLoading, error, data } = useQuery(
    ["billing usage", workspace.id, start, end],
    async () => {
      return (await rpc(
        `/api/${workspace.id}/reports/active-events?start=${roundDay("start", start).toISOString()}&end=${roundDay(
          "end",
          end
        ).toISOString()}`
      )) as ActiveEventsReport;
    },
    { retry: false, cacheTime: 0, staleTime: 0 }
  );
  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col justify-center items-center">
        <Loader2 className={"animate-spin  w-16 h-16 text-primary"} />
        <div className="text-lg mt-2 text-textLight">Loading...</div>
      </div>
    );
  } else if (error) {
    return (
      <div className="w-full h-full flex flex-col justify-center items-center">
        <AlertTriangle className="text-error w-16 h-16" />
        <div className="text-lg mt-2 text-textLight">Error loading data</div>
      </div>
    );
  } else if (data) {
    return <ChartView data={data} />;
  } else {
    //should never happen
    return <div>Something isn't right</div>;
  }
};

export const BillingDetails: React.FC = () => {
  const workspace = useWorkspace();
  const [start, setStart] = useQueryStringState("start", {
    defaultValue: dayjs().utc().startOf("month"),
    parser: val => roundDay("start", val),
    serializer: val => roundDay("end", val).toISOString(),
  });
  const [end, setEnd] = useQueryStringState("end", {
    defaultValue: dayjs().utc().endOf("month").add(-1, "milliseconds"),
    parser: val => roundDay("end", val),
    serializer: val => roundDay("end", val).toISOString(),
  });
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl mt-4 mb-4">Billing Details</h1>
        <div>
          <Button href={`/${workspace.slugOrId}/settings/billing`} type="primary" size="large">
            <ButtonLabel icon={<ArrowLeft className="ant-icon" />}>Back to billing page</ButtonLabel>
          </Button>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-end mt-6">
          <DatePicker.RangePicker
            value={[start, end]}
            onChange={val => {
              if (val?.length === 2) {
                const [start, end] = val;
                setStart(dayjs(start));
                setEnd(dayjs(end));
              }
            }}
          />
        </div>
      </div>
      <div className="" style={{ height: "500px" }}>
        <ChartLoader start={start} end={end} />
      </div>
    </div>
  );
};
