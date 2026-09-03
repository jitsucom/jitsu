import React from "react";

type Stage = {
  name: string;
  retention: string;
  /** Second line under the value, when the unit needs a caveat. */
  retentionNote?: string;
  description: string;
};

type StageGroup = { label: string; stages: Stage[] };

/**
 * How long Jitsu keeps event data at each stage of the pipeline (JITSU-202).
 * Read-only: these are the Jitsu Cloud defaults, the same for every workspace.
 * The one per-workspace window — backups — is edited in the Recovery panel
 * next to this list, so it deliberately does not appear here.
 */
const STAGE_GROUPS: StageGroup[] = [
  {
    label: "Processing",
    stages: [
      { name: "Event stream", retention: "16 hours", description: "Internal queue during processing" },
      {
        name: "Identity stitching",
        retention: "30 days",
        description: "Anonymous events awaiting a profile, if enabled",
      },
    ],
  },
  {
    label: "Delivery",
    stages: [
      { name: "Batched destinations", retention: "2 days", description: "Buffer for warehouses and batch sinks" },
      { name: "Failed events", retention: "7 days", description: "Dead-letter queue for retries and troubleshooting" },
    ],
  },
  {
    label: "Observability",
    stages: [
      {
        name: "Event logs",
        retention: "200k entries",
        retentionNote: "by count, not age",
        description: "Live Events and function logs, per source or destination",
      },
    ],
  },
];

export const PipelineRetentionList: React.FC<{}> = () => (
  <section aria-labelledby="pipeline-retention">
    <div
      id="pipeline-retention"
      className="text-textLight border-b border-neutral-100 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
    >
      Pipeline retention
    </div>
    {STAGE_GROUPS.map((group, i) => (
      <div key={group.label} className={i > 0 ? "mt-2 border-t border-neutral-100" : undefined}>
        <div className="text-primary pb-1.5 pt-[18px] text-xs font-semibold">{group.label}</div>
        {group.stages.map(stage => (
          <div key={stage.name} className="grid grid-cols-[1fr_auto] gap-6 py-2 text-[15px]">
            <div>
              <div className="text-textDark font-medium">{stage.name}</div>
              <div className="text-textLight text-[13px] leading-5">{stage.description}</div>
            </div>
            <div className="text-textDark text-right tabular-nums">
              {stage.retention}
              {stage.retentionNote && <span className="text-textLight block text-xs">{stage.retentionNote}</span>}
            </div>
          </div>
        ))}
      </div>
    ))}
    <p className="text-textLight mt-5 text-[13px]">
      Once data has aged out of every stage, Jitsu no longer holds a copy of it.
    </p>
  </section>
);
