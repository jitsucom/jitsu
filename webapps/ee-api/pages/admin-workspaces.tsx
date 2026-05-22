import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Input, Progress, Segmented, Select, Spin, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { MoreOutlined, ReloadOutlined, ThunderboltFilled } from "@ant-design/icons";
import { useRouter } from "next/router";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
import { AdminLayout } from "../components/AdminLayout";
import { RequireAdmin } from "../components/RequireAdmin";
import { useAuth } from "../components/AuthProvider";
import type { AdminWorkspaceRow, AdminWorkspacesResponse, ChartPoint, WorkspaceStatus } from "../lib/admin-workspaces";

/** Which billing period the table is showing. */
type PeriodVariant = "active" | "previous";

const intFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtInt = (n: number) => intFmt.format(Math.round(n));
const fmtCompact = (n: number) => compactFmt.format(n);
const fmtMoney = (n: number) => moneyFmt.format(n);
// Period boundaries are UTC instants — format in UTC so US timezones don't shift the date.
const fmtDate = (iso: string) => dayjs.utc(iso).format("MMM D, YYYY");
const fmtDateShort = (iso: string) => dayjs.utc(iso).format("MMM D");
const fmtDateTime = (iso: string) => dayjs.utc(iso).format("MMM D, HH:mm [UTC]");

const STATUS_META: Record<WorkspaceStatus, { label: string; color: string }> = {
  PAYING: { label: "Paying", color: "green" },
  CANCELLING: { label: "Cancelling", color: "gold" },
  PAST_DUE: { label: "Past Due", color: "red" },
  ENTERPRISE: { label: "Enterprise", color: "purple" },
  BILLING_DISABLED: { label: "Billing Disabled", color: "default" },
  FREE: { label: "Free", color: "blue" },
  QUOTA_EXCEEDED: { label: "Quota Exceeded", color: "volcano" },
  QUOTA_ABOUT_TO_EXCEED: { label: "Quota Warning", color: "orange" },
};
const STATUS_ORDER = Object.keys(STATUS_META) as WorkspaceStatus[];

/** A best-effort error message from a non-OK API response. */
async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    if (body?.error) {
      return typeof body.error === "string" ? body.error : JSON.stringify(body.error);
    }
  } catch {
    // fall through
  }
  return `HTTP ${resp.status}`;
}

/** Period start/end and events for the selected variant. */
function periodOf(row: AdminWorkspaceRow, variant: PeriodVariant) {
  return variant === "active"
    ? { start: row.periodStart, end: row.periodEnd, events: row.events.period }
    : {
        start: row.previousPeriodStart,
        // previousPeriodEnd is an exclusive bound (= current period start); show
        // the last day actually included so the range matches the summed totals.
        end: dayjs.utc(row.previousPeriodEnd).subtract(1, "day").toISOString(),
        events: row.events.previousPeriod,
      };
}

/** Full plan breakdown shown on status hover/click — rendered as a white table. */
const PlanDetails: React.FC<{ row: AdminWorkspaceRow; variant: PeriodVariant }> = ({ row, variant }) => {
  const { plan } = row;
  const period = periodOf(row, variant);
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Plan",
      value: (
        <>
          {plan.planName || "—"}
          {plan.planId ? <span className="font-normal text-neutral-400"> ({plan.planId})</span> : null}
        </>
      ),
    },
    ...(plan.planKind ? [{ label: "Kind", value: plan.planKind }] : []),
    {
      label: "Base fee",
      value: plan.baseFee != null ? `${fmtMoney(plan.baseFee)} / ${plan.billingInterval || "month"}` : "—",
    },
    { label: "Events quota", value: plan.eventsQuota != null ? fmtInt(plan.eventsQuota) : "Unlimited" },
    {
      label: "Event overage",
      value: plan.overagePricePer100k != null ? `${fmtMoney(plan.overagePricePer100k * 10)} / 1M` : "—",
    },
    { label: "Syncs limit", value: plan.syncsLimit != null ? fmtInt(plan.syncsLimit) : "—" },
    {
      label: "Sync overage",
      value: plan.syncOveragePrice != null ? `${fmtMoney(plan.syncOveragePrice)} / sync` : "—",
    },
    ...(plan.discountPercent > 0 ? [{ label: "Discount", value: `${plan.discountPercent}% off overage` }] : []),
    {
      label: variant === "active" ? "Current period" : "Previous period",
      value: `${fmtDate(period.start)} → ${fmtDate(period.end)}`,
    },
    { label: "Events in period", value: fmtInt(period.events) },
  ];
  return (
    <table className="text-sm text-neutral-900">
      <tbody>
        {rows.map(({ label, value }) => (
          <tr key={label} className="align-top">
            <td className="whitespace-nowrap py-1 pr-8 font-normal text-neutral-500">{label}</td>
            <td className="whitespace-nowrap py-1 text-right font-semibold tabular-nums">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const CHART_GREEN = "#16a34a";
const CHART_GREEN_HOVER = "#15803d";

/** Tooltip shown over a hovered bar in {@link MiniBarChart}. */
const ChartTooltip: React.FC<{
  point: ChartPoint;
  align: "left" | "center" | "right";
  placement: "top" | "bottom";
}> = ({ point, align, placement }) => {
  const projected = point.projected != null && point.projected > point.events;
  // Anchor near the chart edges so the tooltip cannot spill out of the cell.
  const position: React.CSSProperties =
    align === "left" ? { left: 0 } : align === "right" ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
  return (
    <div
      className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs leading-tight text-white shadow-lg ${
        placement === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
      }`}
      style={position}
    >
      <div className="font-semibold">{dayjs.utc(point.date).format("ddd, MMM D")}</div>
      <div className="tabular-nums text-neutral-300">
        {fmtInt(point.events)} events
        {projected && <span className="text-neutral-400"> · ~{fmtCompact(point.projected!)} projected</span>}
      </div>
    </div>
  );
};

/**
 * Interactive daily-events bar chart. Hovering a bar reveals the date, weekday
 * and value. Today's bar is drawn solid for the volume so far, capped with a
 * dashed outline extrapolated to the projected full-day total.
 */
const MiniBarChart: React.FC<{ data: ChartPoint[]; height?: number; tooltipPlacement?: "top" | "bottom" }> = ({
  data,
  height = 40,
  tooltipPlacement = "top",
}) => {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return <div style={{ height }} />;
  }
  const max = Math.max(1, ...data.map(d => Math.max(d.events, d.projected ?? 0)));
  return (
    <div className="relative px-2" onMouseLeave={() => setHover(null)}>
      <div className="flex items-end gap-px border-b border-neutral-200" style={{ height }}>
        {data.map((d, i) => {
          // Drawn height — floored so non-zero days keep a visible sliver.
          const actualPct = d.events > 0 ? Math.max((d.events / max) * 100, 3) : 0;
          const projectedPct = d.projected != null ? (d.projected / max) * 100 : 0;
          const active = hover === i;
          return (
            <div key={d.date} className="relative h-full flex-1" onMouseEnter={() => setHover(i)}>
              {projectedPct > actualPct && (
                <div
                  className="absolute inset-x-0"
                  style={{
                    bottom: `${actualPct}%`,
                    height: `${projectedPct - actualPct}%`,
                    border: `1px dashed ${CHART_GREEN}`,
                    borderBottom: "none",
                    background: "rgba(22,163,74,0.1)",
                  }}
                />
              )}
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[1px]"
                style={{ height: `${actualPct}%`, background: active ? CHART_GREEN_HOVER : CHART_GREEN }}
              />
              {active && (
                <ChartTooltip
                  point={d}
                  align={i < data.length * 0.25 ? "left" : i > data.length * 0.75 ? "right" : "center"}
                  placement={tooltipPlacement}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** One stat in the summary bar. */
const SummaryStat: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="px-5 py-3 border-r border-neutral-200 last:border-r-0">
    <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
    <div className={`text-xl font-semibold mt-0.5 tabular-nums ${accent ? "text-indigo-600" : "text-neutral-900"}`}>
      {value}
    </div>
  </div>
);

function buildColumns(appBaseUrl: string, variant: PeriodVariant): TableColumnsType<AdminWorkspaceRow> {
  return [
    {
      title: "Workspace",
      dataIndex: "workspaceName",
      key: "workspaceName",
      fixed: "left",
      width: 240,
      sorter: (a, b) => a.workspaceName.localeCompare(b.workspaceName),
      render: (_, row) => {
        const href = `${appBaseUrl}/${row.workspaceSlug || row.workspaceId}`;
        return (
          <div className="min-w-0">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-neutral-900 hover:text-indigo-600 hover:underline"
            >
              {row.workspaceName}
            </a>
            <div className="truncate text-xs text-neutral-400">{row.workspaceSlug || row.workspaceId}</div>
          </div>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 150,
      sorter: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      render: (_, row) => {
        const meta = STATUS_META[row.status];
        return (
          <div className="flex flex-col items-start gap-1">
            <Tooltip
              title={<PlanDetails row={row} variant={variant} />}
              color="#ffffff"
              trigger={["hover", "click"]}
              styles={{ root: { maxWidth: "none" }, container: { padding: "12px 16px" } }}
            >
              <Tag color={meta.color} bordered={false} className="cursor-help !rounded-full">
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
                <span className="align-middle">{meta.label}</span>
              </Tag>
            </Tooltip>
            {variant === "active" && row.throttle > 0 && (
              <Tooltip title={`Ingest throttled at ${row.throttle}%`}>
                <Tag color="red" bordered={false} className="!m-0 cursor-help !rounded-full">
                  <ThunderboltFilled className="mr-1 align-middle" />
                  <span className="align-middle">Throttled {row.throttle}%</span>
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: "Period",
      key: "period",
      width: 170,
      // Paying workspaces first, then by period end. The previous view is sorted
      // by this column (most recently ended on top); the active view is sorted by
      // the Yesterday column instead.
      sorter: (a, b) => {
        if (a.paid !== b.paid) {
          return a.paid ? -1 : 1;
        }
        return new Date(periodOf(a, variant).end).getTime() - new Date(periodOf(b, variant).end).getTime();
      },
      defaultSortOrder: variant === "previous" ? "descend" : undefined,
      render: (_, row) => {
        const period = periodOf(row, variant);
        return (
          <div className="tabular-nums">
            <div className="text-[15px] font-semibold leading-tight text-neutral-900">{fmtDate(period.end)}</div>
            <div className="text-xs text-neutral-400">from {fmtDateShort(period.start)}</div>
          </div>
        );
      },
    },
    // Activity: 30-day sparkline above a compact today / yesterday / 30-day stat line. Active view only.
    ...(variant === "active"
      ? ([
          {
            title: "Stats",
            key: "stats",
            width: 240,
            sorter: (a, b) => a.events.yesterday - b.events.yesterday,
            // Active view's default sort: highest yesterday volume on top.
            defaultSortOrder: "descend",
            // Sparkline spans the full cell — drop the cell's horizontal padding.
            onCell: () => ({ style: { paddingLeft: 0, paddingRight: 0 } }),
            render: (_, row, index) => (
              <div>
                {/* Row 0 sits flush under the sticky header — flip its tooltip below so it isn't clipped. */}
                <MiniBarChart data={row.events.chart} tooltipPlacement={index === 0 ? "bottom" : "top"} />
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 px-2 text-xs tabular-nums text-neutral-400">
                  <span>
                    <span className="font-semibold text-neutral-900">{fmtCompact(row.events.yesterday)}</span> yest
                  </span>
                  <span>·</span>
                  <span>
                    <span className="font-semibold text-neutral-900">{fmtCompact(row.events.today)}</span> today
                  </span>
                  <span>·</span>
                  <span>
                    <span className="font-semibold text-neutral-900">{fmtCompact(row.events.avg30 * 30)}</span> 30d
                  </span>
                </div>
              </div>
            ),
          },
        ] as TableColumnsType<AdminWorkspaceRow>)
      : []),
    variant === "active"
      ? {
          title: "Overage",
          key: "overage",
          width: 210,
          // Sort by projected fee — the forward-looking billable amount.
          sorter: (a, b) => (a.overage?.projectedFee || 0) - (b.overage?.projectedFee || 0),
          render: (_, row) => {
            const ov = row.overage;
            if (!ov || (ov.currentFee === 0 && ov.projectedFee === 0)) {
              return <span className="text-neutral-300">—</span>;
            }
            const over = ov.currentFee > 0;
            // Bar fills as the realized overage progresses toward the projection.
            const percent = ov.projectedFee > 0 ? Math.min(100, (ov.currentFee / ov.projectedFee) * 100) : 0;
            return (
              <div className="text-xs tabular-nums">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-sm font-semibold ${over ? "text-red-600" : "text-neutral-400"}`}>
                    {fmtMoney(ov.currentFee)}
                  </span>
                  <span className="text-neutral-400">/ {fmtMoney(ov.projectedFee)}</span>
                </div>
                <Progress
                  percent={percent}
                  showInfo={false}
                  size="small"
                  strokeColor={over ? "#dc2626" : "#f59e0b"}
                  trailColor="#f1f5f9"
                  style={{ width: "100%", margin: "3px 0" }}
                />
                <div className="text-neutral-400">
                  {fmtCompact(ov.currentEvents)} / {fmtCompact(ov.projectedEvents)} events
                </div>
              </div>
            );
          },
        }
      : {
          title: "Overage",
          key: "overage",
          width: 220,
          sorter: (a, b) => (a.previousOverage?.totalFee || 0) - (b.previousOverage?.totalFee || 0),
          render: (_, row) => {
            const ov = row.previousOverage;
            if (!ov || ov.totalFee === 0) {
              return <span className="text-neutral-300">—</span>;
            }
            return (
              <div className="text-xs tabular-nums">
                <div className="text-sm font-semibold text-red-600">{fmtMoney(ov.totalFee)}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-neutral-400">
                  <span>
                    events <span className="font-semibold text-neutral-700">{fmtCompact(ov.eventsOver)}</span> (
                    {fmtMoney(ov.eventsFee)})
                  </span>
                  <span>
                    syncs <span className="font-semibold text-neutral-700">{fmtInt(ov.syncsOver)}</span> (
                    {fmtMoney(ov.syncsFee)})
                  </span>
                </div>
              </div>
            );
          },
        },
    {
      title: "Syncs",
      key: "syncs",
      width: 160,
      sorter: (a, b) => a.syncs.active - b.syncs.active,
      render: (_, row) => {
        const { active, limit, overLimit } = row.syncs;
        const over = overLimit > 0;
        const percent = limit ? Math.min(100, (active / limit) * 100) : 0;
        return (
          <div className="flex items-center gap-2">
            <Progress
              percent={percent}
              showInfo={false}
              size="small"
              strokeColor={over ? "#dc2626" : "#404040"}
              trailColor="#f1f5f9"
              style={{ width: 56, margin: 0 }}
            />
            <span className={`text-xs tabular-nums ${over ? "font-semibold text-red-600" : "text-neutral-600"}`}>
              {fmtInt(active)} / {limit != null ? fmtInt(limit) : "∞"}
            </span>
          </div>
        );
      },
    },
    {
      title: "",
      key: "actions",
      fixed: "right",
      width: 56,
      render: (_, row) => {
        const slug = row.workspaceSlug || row.workspaceId;
        const items = [
          {
            key: "console",
            label: (
              <a href={`${appBaseUrl}/${slug}`} target="_blank" rel="noreferrer">
                Open in console
              </a>
            ),
          },
          {
            key: "billing",
            label: (
              <a href={`${appBaseUrl}/${slug}/settings/billing`} target="_blank" rel="noreferrer">
                Billing settings
              </a>
            ),
          },
          {
            key: "email",
            label: (
              <a href={`/email?workspace=${encodeURIComponent(row.workspaceId)}`} target="_blank" rel="noreferrer">
                Send email
              </a>
            ),
          },
          { type: "divider" as const },
          row.stripeCustomerLink
            ? {
                key: "customer",
                label: (
                  <a href={row.stripeCustomerLink} target="_blank" rel="noreferrer">
                    Stripe customer
                  </a>
                ),
              }
            : { key: "customer", label: "Stripe customer", disabled: true },
          row.stripeSubscriptionLink
            ? {
                key: "subscription",
                label: (
                  <a href={row.stripeSubscriptionLink} target="_blank" rel="noreferrer">
                    Stripe subscription
                  </a>
                ),
              }
            : { key: "subscription", label: "Stripe subscription", disabled: true },
        ];
        return (
          <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
            <Button type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        );
      },
    },
  ];
}

const AdminWorkspaces: React.FC = () => {
  const { authFetch } = useAuth();
  const [data, setData] = useState<AdminWorkspacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkspaceStatus[]>([]);
  // The active/previous toggle is mirrored in the URL so the view survives reloads and can be linked.
  const router = useRouter();
  const variant: PeriodVariant = router.query.period === "previous" ? "previous" : "active";
  const setVariant = useCallback(
    (next: PeriodVariant) => {
      router.replace({ pathname: router.pathname, query: { ...router.query, period: next } }, undefined, {
        shallow: true,
      });
    },
    [router]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await authFetch("/api/admin/workspaces-overview");
      if (!resp.ok) {
        throw new Error(await readError(resp));
      }
      setData(await resp.json());
    } catch (e: any) {
      setError(e?.message || "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => buildColumns(data?.appBaseUrl || "", variant), [data?.appBaseUrl, variant]);

  const filtered = useMemo(() => {
    const rows = data?.rows || [];
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      // The previous-period view is about billing — free workspaces are not billed.
      if (variant === "previous" && !row.paid) {
        return false;
      }
      if (statusFilter.length > 0 && !statusFilter.includes(row.status)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        row.workspaceName.toLowerCase().includes(q) ||
        (row.workspaceSlug || "").toLowerCase().includes(q) ||
        row.workspaceId.toLowerCase().includes(q)
      );
    });
  }, [data?.rows, search, statusFilter, variant]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        if (row.paid) {
          acc.paying += 1;
        }
        if (row.activeYesterday) {
          acc.active += 1;
        }
        acc.eventsToday += row.events.today;
        acc.eventsYesterday += row.events.yesterday;
        // avg30 is the per-day average over the last 30 days; ×30 is the period total.
        acc.events30 += row.events.avg30 * 30;
        return acc;
      },
      { paying: 0, active: 0, eventsToday: 0, eventsYesterday: 0, events30: 0 }
    );
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[600px] py-24 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Failed to load workspaces</h1>
        <p className="mt-2 text-sm text-red-500">{error}</p>
        <Button className="mt-4" icon={<ReloadOutlined />} onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const summaryStats = [
    { label: "Active workspaces", value: fmtInt(summary.active) },
    { label: "Paying", value: fmtInt(summary.paying) },
    { label: "Events today", value: fmtCompact(summary.eventsToday) },
    { label: "Events yesterday", value: fmtCompact(summary.eventsYesterday) },
    { label: "Events 30 days", value: fmtCompact(summary.events30) },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Admin Workspaces</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Billing status, usage and overage. Event stats are read from <code>stat_cache</code>.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {data?.statCacheUpdatedAt && (
            <span className="text-xs text-neutral-400">Event stats through {fmtDateTime(data.statCacheUpdatedAt)}</span>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-stretch rounded-lg border border-neutral-200 bg-white">
        {summaryStats.map(stat => (
          <SummaryStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented<PeriodVariant>
          value={variant}
          onChange={setVariant}
          options={[
            { label: "Active periods", value: "active" },
            { label: "Previous periods", value: "previous" },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="Search by name, slug or id"
          className="w-72"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Filter by status"
          className="min-w-64"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_ORDER.map(s => ({ value: s, label: STATUS_META[s].label }))}
        />
        <span className="text-xs text-neutral-400">{fmtInt(filtered.length)} workspaces</span>
      </div>

      <div className="mt-4">
        <Table<AdminWorkspaceRow>
          key={variant}
          rowKey="workspaceId"
          size="small"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: variant === "active" ? 1230 : 1000 }}
          sticky
          pagination={{ pageSize: 500, showSizeChanger: false }}
        />
      </div>
    </div>
  );
};

export default function AdminWorkspacesPage() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <AdminWorkspaces />
      </AdminLayout>
    </RequireAdmin>
  );
}
