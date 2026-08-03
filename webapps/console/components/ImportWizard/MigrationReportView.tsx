import React, { useState } from "react";
import Head from "next/head";
import { Alert, InputNumber, Table, Tag, Upload } from "antd";
import { CalendarClock, ChevronRight, FileText, Loader2, RefreshCw, UploadCloud } from "lucide-react";
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

/**
 * Migration report (JITSU-131). Savings are headlined per YEAR — the number
 * that lands in a budget conversation — with the monthly figure alongside.
 * Volume can be refined as events or MTUs; with MTUs alone the backend
 * estimates events as MTUs × 100 — the same rule as
 * jitsu.com/migrate-from-segment, so both surfaces agree on MTU-only data.
 */

// Booking link comes exclusively from MIGRATION_CALENDLY_URL
// (appConfig.migrationCalendlyUrl) — no personal links in code. Unset → the
// CTA opens the contact page instead.
const CONTACT_FALLBACK = "https://jitsu.com/contact?utm_source=console&utm_campaign=migration-report";

/** Calendly popup, identical to the websites teaser; plain navigation fallback
 * if the URL is unset or the widget script hasn't loaded. */
function showCalendly(url: string | undefined): void {
  if (!url) {
    // noopener: don't hand the new tab a handle to the console tab.
    window.open(CONTACT_FALLBACK, "_blank", "noopener,noreferrer");
    return;
  }
  const calendly = (window as any)["Calendly"];
  const fullUrl = `${url}${url.includes("?") ? "&" : "?"}hide_landing_page_details=1&hide_gdpr_banner=1`;
  // The popup widget doesn't fit narrow viewports (forces a scrollbar) —
  // open the booking page in a tab there; also when the script is blocked.
  if (calendly?.initPopupWidget && window.innerWidth >= 768) {
    calendly.initPopupWidget({ url: fullUrl });
  } else {
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  }
}

// Text carries the meaning; the colored dot is decorative (a11y checklist).
const VERDICT_TAG: Record<Verdict, React.ReactNode> = {
  green: <Tag color="green">Auto-importable</Tag>,
  yellow: <Tag color="orange">Small change</Tag>,
  phone: <Tag>Needs a call</Tag>,
};

/** Bolds dollar amounts and numbers (incl. 100k-style) inside a basis line. */
function highlightNumbers(text: string): React.ReactNode[] {
  return text.split(/(\$[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?[kM]?\b)/g).map((part, i) =>
    /^(\$[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?[kM]?)$/.test(part) ? (
      // theme token `text` is neutral-600 (gray); `textDark` is the strong one
      <span key={i} className="font-semibold text-textDark">
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

const BASIS_DOT: Record<"usage" | "current" | "jitsu", string> = {
  usage: "#8c8c8c",
  current: "#fa8c16",
  jitsu: "#c026d3",
};

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

const StatItem: React.FC<{ value: React.ReactNode; label: string; className?: string }> = ({
  value,
  label,
  className,
}) => (
  <li className="px-6 py-5">
    <span className={`block text-2xl font-bold ${className ?? ""}`}>{value}</span>
    <span className="block text-textLight text-sm pt-0.5">{label}</span>
  </li>
);

/**
 * Invoice upload → LLM parse → user confirms numbers → report-usage applies
 * them. The raw parse never lands in the report: only what the user confirms
 * here is submitted (JITSU-128 design rule). Volume can be given as events or
 * MTUs; when only MTUs are known the backend estimates events as MTUs × 100.
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
        // reportId attaches the extraction (data only, never the file) to the
        // report as snapshot.parsedInvoice — lead intel for the sales call.
        body: { provider: report.provider, file: base64, mediaType, reportId: report.id },
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

  // Enter and the button share one guard: a keyboard submit must not bypass
  // the disabled state and post an empty usage update.
  const canApply = !applying && !parsing && (!!amountDollars || !!monthlyEvents || !!mtus);

  const apply = async () => {
    if (!canApply) {
      return;
    }
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
    <section
      aria-labelledby="refine-heading"
      className="border border-neutral-200 rounded-lg bg-backgroundLight px-6 py-5 mt-6"
    >
      <h2 id="refine-heading" className="text-lg font-semibold pb-2">
        Refine the savings estimate
      </h2>
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
          <label htmlFor="refine-spend" className="block text-textLight text-sm pb-1">
            Monthly spend, USD
          </label>
          <InputNumber
            id="refine-spend"
            min={0}
            value={amountDollars}
            onChange={v => setAmountDollars(v ?? undefined)}
            onPressEnter={() => apply()}
            style={{ width: 160 }}
          />
        </div>
        <div>
          <label htmlFor="refine-events" className="block text-textLight text-sm pb-1">
            Events / month
          </label>
          <InputNumber
            id="refine-events"
            min={0}
            value={monthlyEvents}
            onChange={v => setMonthlyEvents(v ?? undefined)}
            onPressEnter={() => apply()}
            style={{ width: 160 }}
          />
        </div>
        <div>
          <label htmlFor="refine-mtus" className="block text-textLight text-sm pb-1">
            MTUs / month
          </label>
          <InputNumber
            id="refine-mtus"
            min={0}
            value={mtus}
            onChange={v => setMtus(v ?? undefined)}
            onPressEnter={() => apply()}
            aria-describedby="refine-help"
            style={{ width: 160 }}
          />
        </div>
        <JitsuButton
          type="primary"
          disabled={!canApply}
          icon={applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          onClick={apply}
        >
          Apply
        </JitsuButton>
      </div>
      <p id="refine-help" className="text-textLight text-xs pt-3 mb-0">
        Leave events empty and we estimate them as MTUs × 100. Savings are calculated per year.
      </p>
    </section>
  );
};

/** Collapsed by default: the headline numbers are the point of the report;
 * the per-destination tables are for the migration call. */
const DetailedReport: React.FC<{ snapshot: NonNullable<MigrationReport["snapshot"]> }> = ({ snapshot }) => {
  const [expanded, setExpanded] = useState(false);
  const chips = [
    `${snapshot.destinations.length} destination${snapshot.destinations.length === 1 ? "" : "s"}`,
    snapshot.warehouses.length > 0
      ? `${snapshot.warehouses.length} warehouse${snapshot.warehouses.length === 1 ? "" : "s"}`
      : undefined,
    `${snapshot.sources.length} source${snapshot.sources.length === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  return (
    <section className="border border-neutral-200 rounded-lg mt-6">
      <h2 className="m-0">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="detailed-report"
          className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left rounded-lg hover:bg-neutral-50"
        >
          <span className="flex items-center gap-2 text-lg font-semibold">
            <FileText className="w-5 h-5 text-textLight" />
            Detailed report
          </span>
          <span className="flex items-center gap-2 text-textLight text-sm">
            {chips.map(chip => (
              <span key={chip} className="hidden md:inline border border-neutral-200 rounded-full px-2 py-0.5">
                {chip}
              </span>
            ))}
            <ChevronRight
              className={`w-5 h-5 transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>
      </h2>
      {expanded && (
        <div id="detailed-report" className="px-6 pb-6 border-t border-neutral-200">
          <h3 className="text-xl pt-5 pb-3">Destinations</h3>
          <Table
            rowKey="externalId"
            size="small"
            pagination={false}
            columns={destinationColumns}
            dataSource={snapshot.destinations}
          />
          {snapshot.warehouses.length > 0 && (
            <>
              <h3 className="text-xl pt-6 pb-3">Warehouses</h3>
              <Table
                rowKey="externalId"
                size="small"
                pagination={false}
                columns={destinationColumns}
                dataSource={snapshot.warehouses}
              />
            </>
          )}
          <h3 className="text-xl pt-6 pb-3">Sources</h3>
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
            <>
              <h3 className="text-xl pt-6 pb-3">Also found</h3>
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
            </>
          )}
        </div>
      )}
    </section>
  );
};

export const MigrationReportView: React.FC<{
  report: MigrationReport;
  refresh: () => Promise<void>;
  onStartOver: () => void;
}> = ({ report, refresh, onStartOver }) => {
  const appConfig = useAppConfig();
  const bookCallUrl = appConfig.migrationCalendlyUrl;
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
  // Savings are stored per month (billing's unit for every cost field);
  // the headline annualizes and never shows a negative.
  const monthlyCents = savings?.savingsCents ?? undefined;
  const annualCents = monthlyCents === undefined ? undefined : Math.max(0, monthlyCents) * 12;
  // The backend suppresses when savings are ≤ 0 or the inputs don't support an
  // estimate — respect it rather than headlining a number it disowned.
  const suppressed = savings?.suppressed !== false || annualCents === undefined;
  return (
    <div>
      <Head>
        {/* Calendly popup assets for the book-a-call CTA (same as the marketing teaser) */}
        <link href="https://assets.calendly.com/assets/external/widget.css" rel="stylesheet" />
        <script src="https://assets.calendly.com/assets/external/widget.js" type="text/javascript" async />
      </Head>
      {report.status === "partial" && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Some parts of the workspace could not be read"
          description={snapshot.gaps.map(g => `${g.area}: ${g.reason}`).join(" · ")}
        />
      )}
      {/* `basis` alone still renders: a suppressed estimate ("No usage data —
          upload an invoice…") is exactly when the explanation matters most. */}
      {(annualCents !== undefined || savings?.basisLines || savings?.basis) && (
        <section
          aria-labelledby="savings-heading"
          className={`border rounded-lg px-6 py-5 mb-6 ${
            suppressed ? "border-neutral-200 bg-backgroundLight" : "border-success bg-success/5"
          }`}
        >
          <h2 id="savings-heading" className="text-textLight text-sm font-semibold uppercase tracking-wider m-0">
            {suppressed ? "Your migration estimate" : "Estimated annual savings with Jitsu"}
          </h2>
          {suppressed ? (
            // A "$0/yr" hero would be noise here. Two different situations, so
            // two different sentences: we computed a near-tie, or we couldn't
            // compute at all (no usage yet) — the basis text below adds detail.
            <p className="py-2 mb-0">
              {monthlyCents !== undefined
                ? "At this volume the plans are close — let's find you the right price on the call."
                : "Not enough data to estimate savings yet — add your monthly spend and volume below, or upload an invoice."}
            </p>
          ) : (
            <p className="flex items-baseline gap-3 flex-wrap py-2 mb-0">
              <span className="text-5xl font-bold text-success">{formatCents(annualCents!)}/yr</span>
              <span className="text-textLight">≈ {formatCents(Math.max(0, monthlyCents ?? 0))} per month</span>
            </p>
          )}
          {savings?.basisLines ? (
            <ul className="text-sm text-text flex flex-col gap-2 pt-2 list-none pl-0 mb-0">
              {savings.basisLines.map((line, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 h-2 rounded-full shrink-0 mt-1.5"
                    style={{ backgroundColor: BASIS_DOT[line.kind] }}
                  />
                  <span>{highlightNumbers(line.text)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-textLight text-sm whitespace-pre-line">{savings?.basis}</div>
          )}
        </section>
      )}
      <ul
        aria-label="Workspace summary"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border border-neutral-200 rounded-lg overflow-hidden list-none pl-0 mb-6"
      >
        <StatItem value={snapshot.sources.length} label="sources" />
        <StatItem value={allDestinations.length} label="destinations" />
        <StatItem value={counts.green} label="auto-importable" className="text-success" />
        <StatItem value={counts.yellow} label="small change" className="text-warning" />
        <StatItem value={counts.phone} label="needs a call" />
        {usage?.monthlyEvents ? (
          <StatItem value={usage.monthlyEvents.toLocaleString("en-US")} label="events / month" />
        ) : usage?.mtus ? (
          <StatItem value={usage.mtus.toLocaleString("en-US")} label="MTUs / month" />
        ) : null}
      </ul>
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
          onClick={() => showCalendly(bookCallUrl)}
        >
          Book a migration call
        </JitsuButton>
      </div>
      {/* Always offered: a real invoice beats the public-pricing estimate
          (custom tiers, discounts) even when API usage produced a number. */}
      <UsageEditor report={report} refresh={refresh} />
      <DetailedReport snapshot={snapshot} />
    </div>
  );
};
