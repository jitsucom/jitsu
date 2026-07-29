import React, { useState } from "react";
import { Alert, InputNumber, Table, Tag, Upload } from "antd";
import { CalendarClock, Gauge, Loader2, RefreshCw, UploadCloud, Waypoints } from "lucide-react";
import { branding } from "../../lib/branding";
import segmentIcon from "../../lib/schema/icons/segment";
import { rpc } from "juava";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import { ErrorCard } from "../GlobalError/GlobalError";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import {
  formatCents,
  InvoiceExtraction,
  MigrationReport,
  SnapshotDestination,
  SUPPORTED_INVOICE_MEDIA_TYPES,
  Verdict,
} from "./types";

// Booking link comes from MIGRATION_CALENDLY_URL (appConfig.migrationCalendlyUrl);
// jitsu.com/contact is the fallback when the env is unset.
const BOOK_A_CALL_FALLBACK = "https://jitsu.com/contact?utm_source=console&utm_campaign=migration-report";

const VERDICT_TAG: Record<Verdict, React.ReactNode> = {
  green: <Tag color="green">✅ Auto-importable</Tag>,
  yellow: <Tag color="gold">🟡 Small change</Tag>,
  phone: <Tag>📞 Needs a call</Tag>,
};

/** Bolds dollar amounts and numbers (incl. 100k-style) inside a basis line. */
function highlightNumbers(text: string): React.ReactNode[] {
  return text.split(/(\$[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?[kM]?\b)/g).map((part, i) =>
    /^(\$[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?[kM]?)$/.test(part) ? (
      <span key={i} className="font-semibold text-text">
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function basisLineIcon(kind: "usage" | "current" | "jitsu", provider: string): React.ReactNode {
  if (kind === "jitsu") {
    return branding.logo;
  }
  if (kind === "current") {
    return provider === "segment" ? segmentIcon : <Waypoints className="w-full h-full text-blue-500" />;
  }
  return <Gauge className="w-full h-full" />;
}

function verdictCounts(items: SnapshotDestination[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { green: 0, yellow: 0, phone: 0 };
  for (const item of items) {
    counts[item.verdict]++;
  }
  return counts;
}

const destinationColumns = [
  {
    title: "Name",
    key: "name",
    render: (d: SnapshotDestination) => (
      <div className={d.enabled ? "" : "opacity-50"}>
        <div className="font-semibold">{d.name}</div>
        <div className="text-textLight text-xs">
          {d.type}
          {!d.enabled && " · disabled"}
          {d.mode === "device" && " · device mode"}
        </div>
      </div>
    ),
  },
  {
    title: "Verdict",
    key: "verdict",
    width: 170,
    render: (d: SnapshotDestination) => VERDICT_TAG[d.verdict],
  },
  {
    title: "How it migrates",
    key: "reason",
    render: (d: SnapshotDestination) => (
      <div>
        <div>{d.verdictReason}</div>
        {d.secretsPresent && <div className="text-textLight text-xs pt-1">Credentials will need to be re-entered</div>}
      </div>
    ),
  },
];

/**
 * Invoice upload → LLM parse → user confirms numbers → report-usage applies
 * them. The raw parse never lands in the report: only what the user confirms
 * here is submitted (JITSU-128 design rule).
 */
const UsageEditor: React.FC<{ report: MigrationReport; refresh: () => Promise<void> }> = ({ report, refresh }) => {
  const workspace = useWorkspace();
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [source, setSource] = useState<"invoice" | "manual">("manual");
  const [extraction, setExtraction] = useState<InvoiceExtraction | undefined>();
  const [amountDollars, setAmountDollars] = useState<number | undefined>();
  const [monthlyEvents, setMonthlyEvents] = useState<number | undefined>(
    report.snapshot?.usage?.monthlyEvents ?? undefined
  );
  const [mtus, setMtus] = useState<number | undefined>(report.snapshot?.usage?.mtus ?? undefined);

  const parseFile = async (file: File) => {
    const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!SUPPORTED_INVOICE_MEDIA_TYPES.includes(mediaType)) {
      feedbackError("Please upload a PDF or a PNG/JPEG/WebP screenshot");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      feedbackError("File is too large (max 10 MB)");
      return;
    }
    setParsing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const parsed: InvoiceExtraction = await rpc(`/api/migration/parse-invoice`, {
        query: { workspaceId: workspace.id },
        body: { provider: report.provider, file: base64, mediaType },
      });
      setExtraction(parsed);
      setSource("invoice");
      // Pre-fill the confirmation form — the user reviews before applying.
      // Savings math is USD: never pre-fill an amount in another currency.
      const usd = !parsed.currency || parsed.currency.toUpperCase() === "USD";
      setAmountDollars(usd && parsed.amountCents != null ? Math.round(parsed.amountCents / 100) : undefined);
      setMonthlyEvents(parsed.monthlyEvents ?? undefined);
      setMtus(parsed.mtus ?? undefined);
    } catch (e) {
      feedbackError("Failed to parse the invoice", { error: e });
    } finally {
      setParsing(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      await rpc(`/api/migration/report-usage`, {
        query: { workspaceId: workspace.id },
        body: {
          reportId: report.id,
          source,
          ...(monthlyEvents ? { monthlyEvents: Math.round(monthlyEvents) } : {}),
          ...(mtus ? { mtus: Math.round(mtus) } : {}),
          ...(amountDollars ? { billedAmountCents: Math.round(amountDollars * 100) } : {}),
        },
      });
      feedbackSuccess("Savings estimate updated");
      setExtraction(undefined);
      await refresh();
    } catch (e) {
      feedbackError("Failed to update the estimate", { error: e });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="border border-neutral-200 rounded-lg bg-backgroundLight px-6 py-5 mt-6">
      <div className="text-lg font-semibold pb-2">Refine the savings estimate</div>
      <div className="text-textLight pb-4">
        {`Upload a recent ${report.provider === "segment" ? "Segment" : "RudderStack"} invoice (PDF or screenshot) ` +
          "and we'll read the numbers from it — or enter your monthly spend and volume manually. " +
          "The file is processed in memory and never stored."}
      </div>
      <Upload.Dragger
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        maxCount={1}
        showUploadList={false}
        disabled={parsing}
        beforeUpload={file => {
          parseFile(file);
          return false;
        }}
      >
        <div className="flex flex-col items-center py-3">
          {parsing ? (
            <Loader2 className="w-8 h-8 mb-2 animate-spin text-primary" />
          ) : (
            <UploadCloud className="w-8 h-8 mb-2 text-textLight" />
          )}
          <div>{parsing ? "Reading the invoice…" : "Click or drag an invoice here"}</div>
        </div>
      </Upload.Dragger>
      {extraction && (
        <div className="pt-4">
          {extraction.currency && extraction.currency.toUpperCase() !== "USD" && (
            <Alert
              type="warning"
              showIcon
              className="mb-3"
              message={`This invoice is in ${extraction.currency.toUpperCase()} — the savings estimate works in USD, so the amount was not pre-filled. Enter the approximate USD equivalent manually.`}
            />
          )}
          {extraction.warnings.length > 0 && (
            <Alert type="warning" showIcon className="mb-3" message={extraction.warnings.join("; ")} />
          )}
          <div className="text-textLight text-sm pb-2">
            Extracted with {extraction.confidence} confidence
            {extraction.planName ? ` — plan: ${extraction.planName}` : ""}
            {extraction.periodStart ? ` — period: ${extraction.periodStart}` : ""}. Please check the numbers before
            applying.
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-6 items-end pt-4">
        <div>
          <div className="text-textLight text-sm pb-1">Monthly spend, USD</div>
          <InputNumber
            min={0}
            value={amountDollars}
            onChange={v => setAmountDollars(v ?? undefined)}
            style={{ width: 160 }}
          />
        </div>
        <div>
          <div className="text-textLight text-sm pb-1">Events / month</div>
          <InputNumber
            min={0}
            value={monthlyEvents}
            onChange={v => setMonthlyEvents(v ?? undefined)}
            style={{ width: 160 }}
          />
        </div>
        <div>
          <div className="text-textLight text-sm pb-1">MTUs / month</div>
          <InputNumber min={0} value={mtus} onChange={v => setMtus(v ?? undefined)} style={{ width: 160 }} />
        </div>
        <JitsuButton
          type="primary"
          disabled={applying || (!amountDollars && !monthlyEvents && !mtus)}
          icon={applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          onClick={apply}
        >
          Apply
        </JitsuButton>
      </div>
    </div>
  );
};

export const MigrationReportView: React.FC<{
  report: MigrationReport;
  refresh: () => Promise<void>;
  onStartOver: () => void;
}> = ({ report, refresh, onStartOver }) => {
  const appConfig = useAppConfig();
  const bookCallUrl = appConfig.migrationCalendlyUrl || BOOK_A_CALL_FALLBACK;
  if (report.status === "failed") {
    return (
      <div className="max-w-2xl">
        {/* The backend writes user-facing fix-it copy into report.error (wrong
            token scope, invalid workspaceConfig, …) — show it verbatim. */}
        <Alert
          type="error"
          showIcon
          message="Analysis failed"
          description={report.error ?? "Unknown error — please try again"}
        />
        <div className="pt-4">
          <JitsuButton onClick={onStartOver}>Try again</JitsuButton>
        </div>
      </div>
    );
  }
  const snapshot = report.snapshot;
  if (!snapshot) {
    return <ErrorCard title="Report has no data" hideActions={true} error={{ message: "Empty snapshot" }} />;
  }
  const savings = snapshot.savings;
  const allDestinations = [...snapshot.destinations, ...snapshot.warehouses];
  const counts = verdictCounts(allDestinations);
  const usage = snapshot.usage;
  return (
    <div>
      {report.status === "partial" && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Some parts of the workspace could not be read"
          description={snapshot.gaps.map(g => `${g.area}: ${g.reason}`).join(" · ")}
        />
      )}
      {savings && !savings.suppressed && savings.savingsCents != null ? (
        <div className="border border-success rounded-lg px-6 py-5 mb-6 bg-backgroundLight">
          <div className="text-textLight">Estimated savings with Jitsu</div>
          <div className="text-5xl font-bold text-success py-2">{formatCents(savings.savingsCents)}/mo</div>
          {savings.basisLines ? (
            <div className="text-textLight text-sm flex flex-col gap-1.5 pt-1">
              {savings.basisLines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 shrink-0">{basisLineIcon(line.kind, report.provider)}</div>
                  <span>{highlightNumbers(line.text)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-textLight text-sm whitespace-pre-line">{savings.basis}</div>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-8 mb-6">
        <div>
          <div className="text-3xl font-bold">{snapshot.sources.length}</div>
          <div className="text-textLight">sources</div>
        </div>
        <div>
          <div className="text-3xl font-bold">{allDestinations.length}</div>
          <div className="text-textLight">destinations</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-success">{counts.green}</div>
          <div className="text-textLight">✅ auto-importable</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-warning">{counts.yellow}</div>
          <div className="text-textLight">🟡 small change</div>
        </div>
        <div>
          <div className="text-3xl font-bold">{counts.phone}</div>
          <div className="text-textLight">📞 needs a call</div>
        </div>
        {usage?.monthlyEvents ? (
          <div>
            <div className="text-3xl font-bold">{usage.monthlyEvents.toLocaleString("en-US")}</div>
            <div className="text-textLight">events / month{usage.source !== "api" ? ` (${usage.source})` : ""}</div>
          </div>
        ) : null}
      </div>
      <div className="border border-neutral-200 rounded-lg px-6 py-5 mb-6 bg-backgroundLight flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-lg font-semibold">Ready to migrate?</div>
          <div className="text-textLight">
            Book a call with the Jitsu team — we&apos;ll walk through this report together and plan the switch.
            {counts.phone > 0 && ` ${counts.phone} of your destinations need a conversation anyway.`}
          </div>
        </div>
        <JitsuButton
          type="primary"
          size="large"
          icon={<CalendarClock className="w-4 h-4" />}
          onClick={() => window.open(bookCallUrl, "_blank")}
        >
          Book a migration call
        </JitsuButton>
      </div>
      {/* Always offered: a real invoice beats the public-pricing estimate
          (custom tiers, discounts) even when API usage produced a number. */}
      <UsageEditor report={report} refresh={refresh} />
      <h2 className="text-2xl pt-8 pb-3">Destinations</h2>
      <Table
        rowKey="externalId"
        size="small"
        pagination={false}
        columns={destinationColumns}
        dataSource={snapshot.destinations}
      />
      {snapshot.warehouses.length > 0 && (
        <>
          <h2 className="text-2xl pt-8 pb-3">Warehouses</h2>
          <Table
            rowKey="externalId"
            size="small"
            pagination={false}
            columns={destinationColumns}
            dataSource={snapshot.warehouses}
          />
        </>
      )}
      <h2 className="text-2xl pt-8 pb-3">Sources</h2>
      <Table
        rowKey="externalId"
        size="small"
        pagination={false}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Type", dataIndex: "type", width: 160 },
          {
            title: "Status",
            width: 120,
            render: (s: any) => (s.enabled ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>),
          },
        ]}
        dataSource={snapshot.sources}
      />
      {(snapshot.transformations.length > 0 || snapshot.trackingPlans.length > 0) && (
        <div className="pt-8">
          <h2 className="text-2xl pb-3">Also found</h2>
          <ul className="list-disc pl-6 text-textLight">
            {snapshot.transformations.length > 0 && (
              <li>
                {snapshot.transformations.length} transformation{snapshot.transformations.length > 1 ? "s" : ""} /
                function{snapshot.transformations.length > 1 ? "s" : ""} — portable to Jitsu Functions (JavaScript);
                we&apos;ll review them on the call
              </li>
            )}
            {snapshot.trackingPlans.length > 0 && (
              <li>
                {snapshot.trackingPlans.length} tracking plan{snapshot.trackingPlans.length > 1 ? "s" : ""} — event
                schemas can be enforced with Jitsu Functions
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
