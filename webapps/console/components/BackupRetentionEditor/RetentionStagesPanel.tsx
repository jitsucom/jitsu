import React, { ReactNode } from "react";
import { formatBackupRetention } from "../../lib/shared/data-retention";

type Stage = { name: string; retention: ReactNode; description: ReactNode; highlight?: boolean };

/**
 * How long Jitsu keeps event data at each stage of the pipeline (JITSU-202).
 * The figures for the fixed stages are the Jitsu Cloud defaults; only the
 * backup window is per-workspace and comes from the editor above the panel.
 */
export const RetentionStagesPanel: React.FC<{ backupRetentionHours: number }> = ({ backupRetentionHours }) => {
  const stages: Stage[] = [
    {
      name: "Event stream",
      retention: "up to 16 hours",
      description: "All incoming events are held in the internal message queue (Kafka) during normal processing.",
    },
    {
      name: "Batched destinations",
      retention: "up to 2 days",
      description:
        "Events destined for warehouses and other batch-mode destinations stay in the queue until delivered.",
    },
    {
      name: "Failed events",
      retention: "7 days",
      description: "Undeliverable events are moved to a dead-letter queue and kept for retries and troubleshooting.",
    },
    {
      name: "Identity stitching",
      retention: "up to 30 days",
      description:
        "When enabled, anonymous events are stored so they can be associated with a user profile once identified.",
    },
    {
      name: "Backups",
      retention: formatBackupRetention(backupRetentionHours),
      description: (
        <>
          Raw event backups in Google Cloud Storage, retained for the window configured above. This is the only copy
          Jitsu can restore from if a destination fails or loses data.
        </>
      ),
      highlight: true,
    },
    {
      name: "Event logs",
      retention: "most recent 200,000 entries",
      description:
        "Live Events and function logs per configured entity (e.g. per source or destination), kept in ClickHouse for operational visibility and debugging.",
    },
  ];
  return (
    <div className="border-textDisabled rounded-lg border px-6 py-4">
      <div className="mb-1 text-lg font-semibold">How long Jitsu keeps your data</div>
      <div className="text-textLight mb-4 text-sm">
        Event data passes through several stages, each with its own limited retention. Once data has aged out of every
        stage, Jitsu no longer has a copy of it.
      </div>
      <div className="divide-textDisabled divide-y">
        {stages.map(stage => (
          <div key={stage.name} className="grid grid-cols-1 gap-1 py-3 md:grid-cols-[12rem_12rem_1fr] md:gap-4">
            <div className="font-medium">{stage.name}</div>
            <div className={stage.highlight ? "text-primary font-semibold" : "font-semibold"}>{stage.retention}</div>
            <div className="text-textLight text-sm">{stage.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
