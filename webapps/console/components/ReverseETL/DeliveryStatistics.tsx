import React from "react";
import { Table, Tag } from "antd";
import { reverseRecordStatuses } from "@jitsu/protocols/reverse-etl-stats";
import type { ReverseTask } from "../../lib/reverse-etl";

const cleanupStatuses = {
  not_started: {
    label: "NOT STARTED",
    color: "default",
    description: "Cleanup starts after all snapshot uploads are accepted.",
  },
  prepared: {
    label: "UNCONFIRMED",
    color: "gold",
    description: "Cleanup was prepared, but submission has not been confirmed.",
  },
  pending: {
    label: "PENDING",
    color: "green",
    description: "Uploads are accepted. Waiting for Google to finish removing older audience membership.",
  },
  accepted: {
    label: "ACCEPTED",
    color: "green",
    description: "Google has confirmed cleanup of older audience membership.",
  },
};

export function ReverseDeliveryStatistics({ task }: { task: ReverseTask }) {
  const stats = task.stats;
  const cleanup = stats?.replacement ? cleanupStatuses[stats.replacement] : undefined;
  const rows = stats?.recordCounts
    ? [
        {
          key: "upsert",
          type: stats.replacement ? "Full-snapshot uploads" : "Additions / upserts",
          ...stats.recordCounts.upsert,
        },
        { key: "remove", type: "Removals", ...stats.recordCounts.remove },
      ]
    : [];
  return (
    <div className="break-words">
      {stats ? (
        <>
          {cleanup && (
            <section aria-label="Full-mirror cleanup request" className="border rounded p-3 mb-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <strong>Full-mirror cleanup request</strong>
                <Tag color={cleanup.color}>{cleanup.label}</Tag>
              </div>
              <p>{cleanup.description}</p>
              <p className="text-xs text-textLight mt-2">
                This is a separate request, not a removal batch, and is not included in record totals. Google does not
                report the number of members removed.
              </p>
            </section>
          )}
          {stats.recordCounts ? (
            <div className="overflow-x-auto">
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={rows}
                columns={[
                  { title: "Operation", dataIndex: "type", width: 170 },
                  ...reverseRecordStatuses
                    .filter(status => status !== "accepted" && rows.some(row => row[status] !== 0))
                    .map(status => ({
                      title: status[0].toUpperCase() + status.slice(1),
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
            </div>
          ) : (
            <p className="text-textLight">Record breakdown by operation is unavailable for this older attempt.</p>
          )}
          <p className="text-xs text-textLight mt-3">
            Totals cover records prepared for delivery so far in this logical run, including earlier attempts. Totals
            can grow during delivery. Each record appears in one status.
          </p>
          <p className="text-xs mt-2">
            Records: {stats.records.accepted.toLocaleString()} accepted · {stats.records.pending.toLocaleString()}{" "}
            pending · {stats.records.rejected.toLocaleString()} rejected. These are API records, not matched audience
            size.
          </p>
          <p className="text-xs text-textLight mt-2">
            Observed {new Date(stats.observedAt).toISOString().replace("T", " ").replace("Z", " UTC")}. Older attempts
            retain their own last observation.
          </p>
        </>
      ) : (
        <p className="text-textLight">Record statistics unavailable for this attempt. {task.description}</p>
      )}
    </div>
  );
}
