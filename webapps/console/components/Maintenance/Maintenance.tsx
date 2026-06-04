import React from "react";
import { Wrench } from "lucide-react";
import { useApi } from "../../lib/useApi";
import { GlobalError, GlobalOverlay } from "../GlobalError/GlobalError";
import { GlobalLoader } from "../GlobalLoader/GlobalLoader";
import { branding } from "../../lib/branding";

export type MaintenanceInfo = {
  active?: boolean;
  description?: string;
  planned_start?: string;
  planned_end?: string;
  show_in_advance?: boolean;
  database_access?: "read_only" | "off";
};

export function formatUtc(iso?: string): string | undefined {
  if (!iso) {
    return undefined;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return `${d.toISOString().split(".")[0].replace("T", " ")} UTC`;
}

const SUPPORT_EMAIL = "support@jitsu.com";

export const MaintenancePage: React.FC<{ maintenance?: MaintenanceInfo }> = ({ maintenance }) => {
  const start = formatUtc(maintenance?.planned_start);
  const end = formatUtc(maintenance?.planned_end);
  return (
    <GlobalOverlay>
      <div className="w-full max-w-xl px-6">
        <div className="flex items-center justify-center mb-8">
          <div className="h-9 w-9">{branding.logo}</div>
          <div className="ml-2 h-5 text-textDark">{branding.wordmark}</div>
        </div>
        <div className="bg-backgroundLight border border-backgroundDark rounded-2xl shadow-sm overflow-hidden">
          <div className="flex flex-col items-center gap-4 px-8 pt-8 pb-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Wrench className="w-6 h-6" />
            </div>
            <div className="text-2xl font-semibold tracking-tight">{branding.productName} is under maintenance</div>
            <div className="text-textLight leading-relaxed">
              {maintenance?.description ||
                "We're performing scheduled maintenance. The service will be back shortly — your data keeps being collected and will be processed once we're done."}
            </div>
            {(start || end) && (
              <div className="w-full mt-2 flex flex-col sm:flex-row gap-3 text-left">
                {start && (
                  <div className="flex-1 rounded-md border border-backgroundDark bg-background px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-textLight">Started</div>
                    <div className="text-sm font-medium text-textDark mt-0.5">{start}</div>
                  </div>
                )}
                {end && (
                  <div className="flex-1 rounded-md border border-backgroundDark bg-background px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-textLight">Planned end</div>
                    <div className="text-sm font-medium text-textDark mt-0.5">{end}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-backgroundDark bg-background/50 px-8 py-4 text-center text-sm text-textLight">
            Questions? Reach us at{" "}
            <a className="text-primary hover:underline font-medium" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </div>
        </div>
      </div>
    </GlobalOverlay>
  );
};

// Renders the maintenance page in place of the crash page only when the
// descriptor declares the DB is gone (database_access === "off"). For a
// read_only maintenance window the DB is still up, so any render-time error
// reaching the boundary is a real bug that should surface — not be masked
// under "we're under maintenance". Uses the database-free /api/maintenance
// endpoint so it works during an outage.
export const ErrorOrMaintenance: React.FC<{ error: any; title?: string }> = ({ error, title }) => {
  const { data, isLoading } = useApi<{ maintenance?: MaintenanceInfo | null }>(`/api/maintenance`);
  if (isLoading) {
    return <GlobalLoader title={"Loading..."} />;
  }
  if (data?.maintenance?.active && data.maintenance.database_access === "off") {
    return <MaintenancePage maintenance={data.maintenance} />;
  }
  return <GlobalError error={error} title={title} />;
};
