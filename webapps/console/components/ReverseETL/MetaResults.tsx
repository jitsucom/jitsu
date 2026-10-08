import React from "react";
import { Alert, Button, Descriptions, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import {
  MetaDestinationResults,
  type MetaRangeMetric,
  type MetaScalarMetric,
} from "@jitsu/destination-functions/src/functions/facebook/results-meta";
import { useWorkspace } from "../../lib/context";
import { Panel } from "./shared";

const reasons = {
  "not-reported": "Not reported yet by Meta; matching may be delayed or this metric may be withheld.",
  "privacy-limited": "Unavailable because Meta limits small-audience estimates for privacy.",
  processing: "Unavailable while matching is incomplete or estimates do not yet align with the snapshot.",
  "not-eligible":
    "Unavailable for existing audiences or snapshots with duplicate/excluded members; a reliable model denominator is unknown.",
  "no-snapshot":
    "Unavailable until a successful mirror run records its complete snapshot counts. Older runners do not record these counts.",
  "empty-snapshot": "Unavailable for an empty model; a match percentage cannot be calculated.",
  "invalid-response": "Meta did not return a valid metric. Refresh later.",
};
function metric(value: MetaScalarMetric, unit: "score" | "percent") {
  return value.status === "available" ? (
    `${value.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === "score" ? " / 10" : "%"}`
  ) : (
    <span title={reasons[value.reason]}>Not available</span>
  );
}
function range(value: MetaRangeMetric, percent = false) {
  if (value.status === "unavailable") return reasons[value.reason];
  const format = (n: number) =>
    `${n.toLocaleString(undefined, { maximumFractionDigits: percent ? 2 : 0 })}${percent ? "%" : ""}`;
  return value.lower === value.upper ? format(value.lower) : `${format(value.lower)} – ${format(value.upper)}`;
}
const operations: Record<number, string> = {
  0: "Not reported",
  200: "Normal",
  410: "No upload yet",
  411: "Low match rate",
  412: "Invalid entries reported",
  414: "Replacement in progress",
  415: "Replacement failed",
  441: "Audience is populating",
  450: "Audience is out of date",
  470: "Owner account inactive",
  471: "Audience restricted by policy",
  500: "Action required in Ads Manager",
};

export function MetaResults({ syncId, configurationKey }: { syncId: string; configurationKey?: string }) {
  const workspace = useWorkspace();
  const query = useQuery({
    queryKey: ["reverse-meta-results", workspace.id, syncId, configurationKey],
    queryFn: async ({ signal }) =>
      MetaDestinationResults.nullable().parse(
        await rpc(`/api/${workspace.id}/reverse-etl/meta-results`, { query: { syncId }, signal })
      ),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const result = query.data;
  if (query.isSuccess && result === null) return null;
  return (
    <Panel
      title="Meta destination results"
      description="Current results for this audience or dataset, across all senders. These are not the acceptance counts or attribution results of the selected run. Meta matching can be delayed; refresh manually after processing."
    >
      <Button onClick={() => query.refetch()} loading={query.isFetching}>
        Refresh Meta results
      </Button>
      {query.isError ? (
        <Alert
          className="mt-3"
          type="warning"
          title="Meta results could not be loaded"
          description="Refresh later. Delivery and saved state are unaffected."
        />
      ) : (
        result && (
          <>
            <p className="text-xs text-textSecondary mt-3">
              Fetched {new Date(result.observedAt).toLocaleString()}. This is the fetch time, not the last time Meta
              processed data.
            </p>
            {result.kind === "unavailable" ? (
              <Alert type="info" title="Results unavailable" description={result.message} />
            ) : result.kind === "audience" ? (
              <>
                <Descriptions
                  column={1}
                  size="small"
                  items={[
                    { key: "target", label: "Audience ID", children: result.targetId },
                    { key: "size", label: "Approximate audience size", children: range(result.size) },
                    { key: "rate", label: "Estimated match range", children: range(result.matchRate, true) },
                    ...(result.denominatorRows !== undefined
                      ? [
                          {
                            key: "denominator",
                            label: "Completed snapshot source rows",
                            children: result.denominatorRows.toLocaleString(),
                          },
                        ]
                      : []),
                    {
                      key: "operation",
                      label: "Audience processing",
                      children:
                        result.operationCode === undefined
                          ? "Not reported"
                          : operations[result.operationCode] ??
                            `Meta status ${result.operationCode}; check Ads Manager`,
                    },
                    {
                      key: "delivery",
                      label: "Ad eligibility",
                      children:
                        result.deliveryCode === 200
                          ? "Ready for ads"
                          : result.deliveryCode === 300
                          ? "Audience too small to use"
                          : result.deliveryCode === undefined
                          ? "Not reported"
                          : `Meta status ${result.deliveryCode}; check Ads Manager`,
                    },
                  ]}
                />
                <p className="text-xs text-textSecondary mt-3">
                  The match range is Meta’s approximate size divided by the source rows of the latest completed managed
                  mirror. It is an estimate, not a measured upload match rate. External uploads and Meta’s privacy
                  thresholds can affect these numbers.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm mt-3">
                  Dataset ID: {result.targetId}. Web events only. EMQ measures matching quality; Additional Conversions
                  Reported is Meta’s estimated uplift alongside the browser Pixel, not an event count or campaign
                  attribution total.
                </p>
                {!result.events.length ? (
                  <Alert
                    type="info"
                    title="No web-event quality metrics reported yet"
                    description="This does not mean zero events. Meta may be processing data or withholding metrics; non-web events are not included here."
                  />
                ) : (
                  <Table
                    size="small"
                    rowKey="eventName"
                    pagination={{ pageSize: 10 }}
                    dataSource={result.events}
                    columns={[
                      { title: "Event (all dataset senders)", dataIndex: "eventName" },
                      { title: "Event Match Quality", dataIndex: "emq", render: value => metric(value, "score") },
                      {
                        title: "Additional Conversions Reported",
                        dataIndex: "acr",
                        render: value => metric(value, "percent"),
                      },
                    ]}
                  />
                )}
                <p className="text-xs text-textSecondary mt-3">
                  Not available means Meta omitted or withheld the metric, not zero. Quality reporting requires dataset
                  access and additional permissions or Events Manager opt-in; a token that sends conversions may not be
                  able to read it.
                </p>
              </>
            )}
          </>
        )
      )}
    </Panel>
  );
}
