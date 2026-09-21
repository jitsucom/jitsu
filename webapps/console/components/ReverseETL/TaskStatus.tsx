import React, { useState } from "react";
import { Alert, Popover, Table, Tag } from "antd";
import { ChevronDown } from "lucide-react";
import { reverseBatchStatuses } from "@jitsu/protocols/reverse-etl-stats";
import type { ReverseTask } from "../../lib/reverse-etl";
import { WJitsuButton } from "../JitsuButton/JitsuButton";

export function ReverseTaskStatus({ task }: { task?: ReverseTask | null }) {
  const [open, setOpen] = useState(false);
  if (!task)
    return (
      <div className="flex flex-col items-end">
        <Tag style={{ marginRight: 0 }}>NO RUNS</Tag>
        <span className="text-xxs text-gray-500">&nbsp;</span>
      </div>
    );
  const stats = task.stats;
  const rows = stats
    ? [
        { key: "upsert", type: stats.replacement ? "Full-snapshot uploads" : "Additions / upserts", ...stats.upsert },
        { key: "remove", type: "Removals", ...stats.remove },
      ]
    : [];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      title="Batch delivery statistics"
      content={
        <div className="max-w-[90vw]" style={{ width: 850 }}>
          {task.error && <Alert className="mb-3" type="error" title={task.error} />}
          {stats ? (
            <>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: 800 }}
                dataSource={rows}
                columns={[
                  { title: "Batch type", dataIndex: "type", width: 170 },
                  ...reverseBatchStatuses
                    .filter(status => status !== "accepted" && rows.some(row => row[status] !== 0))
                    .map(status => ({
                      title: status === "partial" ? "Mixed result" : status[0].toUpperCase() + status.slice(1),
                      dataIndex: status,
                      key: status,
                    })),
                  { title: "Accepted", dataIndex: "accepted" },
                  {
                    title: <strong>Total</strong>,
                    dataIndex: "total",
                    render: (total: number) => <strong>{total}</strong>,
                  },
                ]}
              />
              <p className="text-xs text-textLight mt-3">
                Totals cover batches created so far in this logical run, including earlier attempts. Totals can grow
                during delivery. Each batch appears in one status; pending batches may contain both accepted and
                rejected rows.
              </p>
              <p className="text-xs mt-2">
                Records: {stats.records.accepted.toLocaleString()} accepted · {stats.records.pending.toLocaleString()}{" "}
                pending · {stats.records.rejected.toLocaleString()} rejected. These are API records, not matched
                audience size.
              </p>
              {stats.replacement && (
                <p className="text-xs mt-2">
                  Full-audience cleanup:{" "}
                  <strong>
                    {stats.replacement === "prepared" ? "prepared / unconfirmed" : stats.replacement.replace("_", " ")}
                  </strong>
                  . This is a separate request, not a removal batch. Google does not report the number of members
                  removed.
                </p>
              )}
              <p className="text-xs text-textLight mt-2">
                Observed {new Date(stats.observedAt).toISOString().replace("T", " ").replace("Z", " UTC")}. Older
                attempts retain their own last observation.
              </p>
            </>
          ) : (
            <p className="text-textLight">Batch statistics unavailable for this attempt. {task.description}</p>
          )}
          <div className="flex justify-end mt-3">
            <WJitsuButton href={`/reverse-syncs/logs?syncId=${task.sync_id}&taskId=${task.task_id}`} type="primary">
              Show Logs
            </WJitsuButton>
          </div>
        </div>
      }
    >
      <button
        className="outline-0 inline-flex flex-col items-end"
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Tag
          style={{ marginRight: 0 }}
          color={
            task.status === "SUCCESS"
              ? "green"
              : task.status === "FAILED"
              ? "red"
              : ["RUNNING", "WAITING"].includes(task.status)
              ? "blue"
              : undefined
          }
        >
          {task.status} <ChevronDown className="inline w-3 h-3" />
        </Tag>
        <span className="text-xxs text-gray-500">{stats ? "show stats" : "show details"}</span>
      </button>
    </Popover>
  );
}
