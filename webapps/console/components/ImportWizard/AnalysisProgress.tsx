import React from "react";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { MigrationReport } from "./types";

const STEP_TITLES: Record<string, string> = {
  sources: "Sources",
  destinations: "Destinations",
  warehouses: "Warehouses",
  connections: "Connections",
  trackingPlans: "Tracking plans",
  functions: "Functions",
  transformations: "Transformations",
  usage: "Usage",
};

/** Live per-entity progress while ee-api reads the provider workspace. */
export const AnalysisProgress: React.FC<{ report?: MigrationReport }> = ({ report }) => {
  const progress = report?.snapshot?.progress ?? {};
  const entries = Object.entries(progress);
  return (
    <div className="max-w-2xl border border-neutral-200 rounded-lg bg-backgroundLight px-6 py-5">
      <div className="flex items-center gap-3 pb-4">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <div className="text-lg font-semibold">Reading your workspace…</div>
      </div>
      {entries.length === 0 ? (
        <div className="text-textLight">Connecting…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(([name, state]) => (
            <div key={name} className="flex items-center gap-3">
              {state === "done" ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : state === "failed" ? (
                <XCircle className="w-4 h-4 text-error" />
              ) : state === "fetching" ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              ) : (
                <CircleDashed className="w-4 h-4 text-textDisabled" />
              )}
              <div>{STEP_TITLES[name] ?? name}</div>
              {state === "failed" && <div className="text-textLight text-sm">— skipped, details in the report</div>}
            </div>
          ))}
        </div>
      )}
      <div className="text-textLight text-sm pt-4">
        This usually takes under a minute. Partial failures don&apos;t stop the analysis — anything we couldn&apos;t
        read is listed in the report.
      </div>
    </div>
  );
};
