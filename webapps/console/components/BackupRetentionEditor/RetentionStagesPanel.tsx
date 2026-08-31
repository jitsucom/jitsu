import React, { ReactNode, useState } from "react";
import { Settings } from "lucide-react";
import { formatBackupRetention } from "../../lib/shared/data-retention";

type Stage = { name: string; retention: ReactNode; description: ReactNode; highlight?: boolean };

/**
 * How long Jitsu keeps event data at each stage of the pipeline (JITSU-202).
 * The figures for the fixed stages are the Jitsu Cloud defaults; only the
 * backup window is per-workspace. When `backupSettings` is provided, the
 * Backups row becomes an expandable subsection (gear icon in the right
 * column) with the settings nested under it.
 */
export const RetentionStagesPanel: React.FC<{ backupRetentionHours: number; backupSettings?: ReactNode }> = ({
  backupRetentionHours,
  backupSettings,
}) => {
  const [expanded, setExpanded] = useState(false);
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
          Raw event backups in Google Cloud Storage — the only copy Jitsu can restore from if a destination fails or
          loses data. The retention window is configurable per workspace.
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
  const rowGrid = "grid grid-cols-1 gap-1 py-3 md:grid-cols-[12rem_12rem_1fr_2.5rem] md:gap-4";
  return (
    <div className="border-textDisabled rounded-lg border px-6 py-4">
      <div className="mb-1 text-lg font-semibold">How long Jitsu keeps your data</div>
      <div className="text-textLight mb-4 text-sm">
        Event data passes through several stages, each with its own limited retention. Once data has aged out of every
        stage, Jitsu no longer has a copy of it.
      </div>
      <div className="divide-textDisabled divide-y">
        {stages.map(stage => {
          const configurable = stage.highlight && backupSettings !== undefined;
          const cells = (
            <>
              <div className="font-medium">{stage.name}</div>
              <div className={stage.highlight ? "text-primary font-semibold" : "font-semibold"}>{stage.retention}</div>
              <div className="text-textLight text-sm">{stage.description}</div>
              <div className={`${configurable ? "flex" : "hidden md:flex"} items-start justify-end`}>
                {configurable && (
                  <Settings
                    aria-hidden
                    className={`text-textLight h-5 w-5 transition-transform ${
                      expanded ? "text-primary rotate-90" : ""
                    }`}
                  />
                )}
              </div>
            </>
          );
          if (!configurable) {
            return (
              <div key={stage.name} className={rowGrid}>
                {cells}
              </div>
            );
          }
          return (
            <div key={stage.name}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls="backup-retention-settings"
                onClick={() => setExpanded(v => !v)}
                className={`${rowGrid} hover:bg-backgroundDark w-full rounded text-left transition-colors`}
                title={expanded ? "Hide backup settings" : "Configure backup retention"}
              >
                {cells}
              </button>
              {/* Kept mounted (hidden, not unmounted) so aria-controls always
                  resolves and the editor's draft state survives a collapse. */}
              <div
                id="backup-retention-settings"
                hidden={!expanded}
                className="border-textDisabled mb-3 ml-0 border-l-2 pb-1 pl-4"
              >
                {backupSettings}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
