import React from "react";
import { Alert, Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { useWorkspace } from "../../lib/context";

export function MetaTargetCheck({
  destinationId,
  stream,
  streamOptions,
  disabled,
}: {
  destinationId: string;
  stream: string;
  streamOptions: Record<string, unknown>;
  disabled: boolean;
}) {
  const workspace = useWorkspace();
  // A new target/settings key has no result. A late response cannot certify another target.
  const check = useQuery<{ name: string; message: string }>({
    queryKey: ["reverse-meta-check", workspace.id, destinationId, stream, streamOptions],
    enabled: false,
    queryFn: ({ signal }) =>
      rpc(`/api/${workspace.id}/reverse-etl/meta-check`, {
        method: "POST",
        body: { destinationId, stream, streamOptions },
        signal,
      }),
    retry: false,
    cacheTime: 0,
  });
  return (
    <div className="my-4">
      <Button disabled={disabled} loading={check.isFetching} onClick={() => check.refetch()}>
        Check Meta connection
      </Button>
      {check.isSuccess && (
        <Alert
          className="mt-2"
          type="info"
          title={`Target verified: ${check.data.name}`}
          description={check.data.message}
        />
      )}
      {check.isError && (
        <Alert
          className="mt-2"
          type="error"
          title="Meta connection check failed"
          description={check.error instanceof Error ? check.error.message : "Could not check target access. Try again."}
        />
      )}
    </div>
  );
}
