import React, { useState } from "react";
import { AutoComplete } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { useWorkspace } from "../../lib/context";

/** Discovery is optional. Manual IDs continue to work when OAuth/lookup isn't configured yet. */
export function GoogleTargetSelector({
  destinationId,
  kind,
  value,
  onChange,
  disabled,
}: {
  destinationId?: string;
  kind: "audience" | "conversion-action";
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const workspace = useWorkspace();
  const [requested, setRequested] = useState(false);
  const lookup = useQuery({
    queryKey: ["reverse-google-options", workspace.id, destinationId, kind],
    enabled: requested && !!destinationId && !disabled,
    queryFn: ({ signal }) =>
      rpc(`/api/${workspace.id}/reverse-etl/google-options`, { query: { destinationId, kind }, signal }),
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
      {lookup.isFetching && <div className="text-xs text-textSecondary mt-1">Loading Google targets…</div>}
      {lookup.isError && (
        <div className="text-xs text-textSecondary mt-1">Target lookup unavailable. You can enter the ID manually.</div>
      )}
    </div>
  );
}
