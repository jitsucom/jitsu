import React, { useState } from "react";
import { Alert, Button, Descriptions, Table } from "antd";
import { useMutation } from "@tanstack/react-query";
import { rpc } from "juava";
import { MicrosoftResults as Result } from "@jitsu/destination-functions/src/functions/microsoft-ads/results-meta";
import { useWorkspace } from "../../lib/context";
import { Panel } from "./shared";

export function MicrosoftResults({ syncId }: { syncId: string }) {
  const workspace = useWorkspace();
  const [result, setResult] = useState<Result>();
  const load = useMutation({
    mutationFn: async (continuation?: string) =>
      Result.parse(
        await rpc(`/api/${workspace.id}/reverse-etl/microsoft-results`, {
          method: "POST",
          body: { syncId, continuation },
        })
      ),
    onSuccess: setResult,
    retry: false,
  });
  return (
    <Panel
      title="Microsoft Advertising results"
      description="Current destination-level results across all senders, not delivery counts or attribution to this Jitsu run. Loading results never sends audience members or conversions."
    >
      <div className="flex gap-2">
        <Button loading={load.isPending} onClick={() => load.mutate(undefined)}>
          Refresh Microsoft results
        </Button>
        {result?.kind === "pending" && (
          <Button disabled={load.isPending} onClick={() => load.mutate(result.continuation)}>
            Check report status
          </Button>
        )}
      </div>
      {load.isError && (
        <Alert
          className="mt-3"
          type="warning"
          title="Microsoft results could not be loaded"
          description={load.error instanceof Error ? load.error.message : "Try again later. Delivery is unaffected."}
        />
      )}
      {result && (
        <>
          <p className="text-xs text-textSecondary mt-3">
            Account {result.accountId}. Fetched {new Date(result.observedAt).toLocaleString()} — fetch time, not
            Microsoft processing time.
          </p>
          {result.kind === "unavailable" ? (
            <Alert type="info" title="Results unavailable" description={result.message} />
          ) : result.kind === "audience" ? (
            <>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "target", label: "Audience", children: `${result.name} (${result.targetId})` },
                  { key: "search", label: "Search audience size", children: result.searchSize ?? "Not reported yet" },
                  {
                    key: "network",
                    label: "Audience Network size",
                    children: result.audienceNetworkSize ?? "Not reported yet",
                  },
                ]}
              />
              <p className="text-xs text-textSecondary mt-3">
                Matching may take up to 48 hours. Sizes are Microsoft’s current audience estimates, not a per-upload
                match rate; missing sizes do not mean zero. Audience eligibility also depends on Microsoft’s
                minimum-size and policy requirements.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm mt-3">
                Goal: {result.goal}. Last 30 completed days: {result.start} – {result.end}, Pacific time.
              </p>
              {result.kind === "pending" ? (
                <Alert
                  type="info"
                  title="Preparing report"
                  description="Microsoft is generating the report. Check its status shortly; this does not start another sync."
                />
              ) : result.totals.length ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey="currency"
                  dataSource={result.totals}
                  columns={[
                    { title: "Currency", dataIndex: "currency" },
                    {
                      title: "Attributed conversions",
                      dataIndex: "conversions",
                      render: (n: number) => n.toLocaleString(),
                    },
                    {
                      title: "Revenue",
                      dataIndex: "revenue",
                      render: (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                    },
                  ]}
                />
              ) : (
                <Alert
                  type="info"
                  title="No goal data returned"
                  description="Microsoft reported no rows for this goal and period. This does not confirm zero uploaded or accepted events."
                />
              )}
              <p className="text-xs text-textSecondary mt-3">
                Microsoft campaign reporting, grouped by the goal’s exact name, including conversions excluded from
                bidding. Reporting uses ad-interaction dates, not upload dates; recent attribution may be incomplete or
                revised. These totals include other senders and are not attributed to Jitsu.
              </p>
            </>
          )}
        </>
      )}
    </Panel>
  );
}
