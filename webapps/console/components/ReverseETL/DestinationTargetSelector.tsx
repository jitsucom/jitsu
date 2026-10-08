import React, { useState } from "react";
import { AutoComplete } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { useWorkspace } from "../../lib/context";

/** Discovery is optional. Manual IDs continue to work when OAuth/lookup isn't configured yet. */
export function DestinationTargetSelector({
  destinationId,
  kind,
  lookupParams,
  value,
  onChange,
  disabled,
}: {
  destinationId?: string;
  kind: string;
  lookupParams?: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const workspace = useWorkspace();
  const [requested, setRequested] = useState(false);
  const lookup = useQuery({
    queryKey: ["reverse-destination-options", workspace.id, destinationId, kind, lookupParams],
    enabled: requested && !!destinationId && !disabled && (kind !== "meta-audience" || !!lookupParams?.accountId),
    queryFn: ({ signal }) =>
      rpc(`/api/${workspace.id}/reverse-etl/options`, { query: { destinationId, kind, ...lookupParams }, signal }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return (
    <div>
      <AutoComplete
        className="w-80"
        disabled={disabled}
        value={value}
        onChange={onChange}
        onFocus={() => setRequested(true)}
        options={lookup.data?.options ?? []}
        placeholder="Choose a target or enter its ID"
        filterOption={(input, option) =>
          String(option?.label ?? "")
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
      {lookup.isFetching && <div className="text-xs text-textSecondary mt-1">Loading targets…</div>}
      {lookup.data?.truncated && (
        <div className="text-xs text-textSecondary mt-1">
          More targets are available. Enter an ID manually if it is not listed.
        </div>
      )}
      {kind === "meta-audience" && !lookupParams?.accountId && (
        <div className="text-xs text-textSecondary mt-1">
          Choose an ad account to browse its customer-list audiences.
        </div>
      )}
      {lookup.isError && (
        <div className="text-xs text-textSecondary mt-1">
          {lookup.error instanceof Error ? lookup.error.message : "Target lookup unavailable."} You can enter the ID
          manually.
        </div>
      )}
    </div>
  );
}
