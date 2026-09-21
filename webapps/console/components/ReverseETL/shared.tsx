import React from "react";
import { Alert, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { z } from "zod";
import { useWorkspace } from "../../lib/context";
import { ReverseSyncView, reverseStatusLabels } from "../../lib/reverse-etl";

export function useReverseSyncs() {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: ["reverse-etl-syncs", workspace.id],
    queryFn: async () => z.array(ReverseSyncView).parse(await rpc(`/api/${workspace.id}/reverse-etl/syncs`)),
    refetchInterval: 10_000,
  });
}
export function RunStatus({ status }: { status?: string }) {
  return (
    <Tag
      color={
        status === "SUCCESS"
          ? "success"
          : status === "FAILED"
          ? "error"
          : status === "RUNNING"
          ? "processing"
          : status === "WAITING"
          ? "warning"
          : "default"
      }
    >
      {status ? reverseStatusLabels[status] ?? status : "No runs yet"}
    </Tag>
  );
}
export function Panel({
  title,
  description,
  children,
}: React.PropsWithChildren<{ title: React.ReactNode; description?: string }>) {
  return (
    <section className="border border-textDisabled rounded-lg bg-backgroundLight p-5 md:p-6 mb-5 min-w-0">
      <h2 className="text-lg text-textDark font-semibold mb-1">{title}</h2>
      {description && <p className="text-textLight mb-5">{description}</p>}
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}
export function ReverseNotice({ enabled }: { enabled: boolean }) {
  return !enabled ? (
    <Alert
      className="mb-5"
      type="info"
      showIcon
      title="Reverse ETL is not enabled"
      description="Existing syncs and logs remain visible. You can pause, cancel attempts and delete disabled syncs; creating or enabling a sync requires the rollout flag."
    />
  ) : null;
}
export function Failure({ error }: { error: unknown }) {
  return error ? (
    <Alert
      className="my-4"
      type="error"
      showIcon
      title="Action could not be completed"
      description={error instanceof Error ? error.message : String(error)}
    />
  ) : null;
}
