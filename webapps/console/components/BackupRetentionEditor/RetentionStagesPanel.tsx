import React, { ReactNode, useState } from "react";
import { Settings } from "lucide-react";
import { formatBackupRetention } from "../../lib/shared/data-retention";

type Stage = { name: string; retention: ReactNode; description: ReactNode };

const ROW_GRID = "grid grid-cols-1 gap-1 px-6 py-3.5 md:grid-cols-[11rem_10.5rem_1fr_2.5rem] md:gap-5";

const STAGES: Stage[] = [
  {
    name: "Event stream",
    retention: "up to 16 hours",
    description: "All incoming events, in the internal message queue during normal processing.",
  },
  {
    name: "Batched destinations",
    retention: "up to 2 days",
    description: "Events for warehouses and other batch destinations.",
  },
  {
    name: "Failed events",
    retention: "7 days",
    description: "Undeliverable events, kept in a dead-letter queue for retries and troubleshooting.",
  },
  {
    name: "Identity stitching",
    retention: "up to 30 days",
    description: "Anonymous events waiting to be joined to a user profile, when enabled.",
  },
];

const LOGS_STAGE: Stage = {
  name: "Event logs",
  retention: "last 200,000 entries",
  description: "Live Events and function logs per source or destination, for operational visibility and debugging.",
};

/**
 * How long Jitsu keeps event data at each stage of the pipeline (JITSU-202).
 * The fixed stages are the Jitsu Cloud defaults; only the backup window is
 * per-workspace, so the Backups row is expandable (gear affordance in the
 * right column) and reveals `backupSettings` as an inset panel inside the
 * same card.
 */
export const RetentionStagesPanel: React.FC<{ backupRetentionHours: number; backupSettings?: ReactNode }> = ({
  backupRetentionHours,
  backupSettings,
}) => {
  const [expanded, setExpanded] = useState(false);
  const configurable = backupSettings !== undefined;
  return (
    <div className="border-textDisabled overflow-hidden rounded-xl border">
      {STAGES.map(stage => (
        <div key={stage.name} className={`${ROW_GRID} border-b border-neutral-100 md:items-baseline`}>
          <div className="text-textDark text-sm font-medium">{stage.name}</div>
          <div className="text-sm font-medium">{stage.retention}</div>
          <div className="text-textLight text-[13px] leading-5">{stage.description}</div>
          <div className="hidden md:block" />
        </div>
      ))}

      <div
        className="border-b border-neutral-100 transition-colors"
        style={{ background: expanded ? "rgba(79, 70, 229, 0.03)" : "transparent" }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="backup-retention-settings"
          disabled={!configurable}
          onClick={() => setExpanded(v => !v)}
          title={expanded ? "Hide backup settings" : "Configure backup retention"}
          className={`${ROW_GRID} w-full text-left md:items-baseline ${
            configurable ? "hover:bg-primary/5 cursor-pointer" : "cursor-default"
          }`}
        >
          <div className="text-textDark text-sm font-medium">Backups</div>
          <div className="text-primary text-sm font-bold">{formatBackupRetention(backupRetentionHours)}</div>
          <div className="text-textLight text-[13px] leading-5">
            Raw event backups in Google Cloud Storage — the only copy Jitsu can restore from. Configurable per
            workspace.
          </div>
          <div className={`${configurable ? "flex" : "hidden md:flex"} items-center justify-end self-center`}>
            {configurable && (
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-300"
                style={{
                  background: expanded ? "rgba(79, 70, 229, 0.1)" : "transparent",
                  color: expanded ? "#4f46e5" : "#a3a3a3",
                  transform: `rotate(${expanded ? 90 : 0}deg)`,
                }}
              >
                <Settings className="h-[17px] w-[17px]" />
              </span>
            )}
          </div>
        </button>

        {configurable && (
          // Kept mounted (collapsed to 0fr, not unmounted) so aria-controls
          // always resolves and the draft selection survives a collapse.
          // `visibility` keeps collapsed content out of the tab order; its
          // switch is delayed on collapse so the content doesn't vanish
          // before the height finishes animating.
          <div
            id="backup-retention-settings"
            className="grid"
            style={{
              gridTemplateRows: expanded ? "1fr" : "0fr",
              visibility: expanded ? "visible" : "hidden",
              transition: `grid-template-rows 300ms ease, visibility 0s linear ${expanded ? "0s" : "300ms"}`,
            }}
          >
            <div className="overflow-hidden">
              <div className="px-6 pb-5 pt-1">{backupSettings}</div>
            </div>
          </div>
        )}
      </div>

      <div className={`${ROW_GRID} md:items-baseline`}>
        <div className="text-textDark text-sm font-medium">{LOGS_STAGE.name}</div>
        <div className="text-sm font-medium">{LOGS_STAGE.retention}</div>
        <div className="text-textLight text-[13px] leading-5">{LOGS_STAGE.description}</div>
        <div className="hidden md:block" />
      </div>
    </div>
  );
};
