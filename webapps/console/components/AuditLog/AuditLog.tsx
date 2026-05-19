import React, { useMemo, useState } from "react";
import { Alert, Button, DatePicker, Select, Table, Tag, Tooltip } from "antd";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { rpc } from "juava";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AuditLogDiff } from "../AuditLogDiff/AuditLogDiff";
import { inferTokenTypeFromId } from "../../lib/schema";
import { FaTerminal } from "react-icons/fa";
import { FaCloudArrowUp, FaWindowMaximize } from "react-icons/fa6";

dayjs.extend(utc);
dayjs.extend(relativeTime);

const { RangePicker } = DatePicker;

type DiffEntry = {
  field: string;
  kind: "added" | "removed" | "changed" | "secret-changed" | "noop";
  prev?: string;
  next?: string;
};

export type AuditLogItem = {
  id: string;
  timestamp: string;
  type: string;
  severity?: string | null;
  workspaceId?: string | null;
  workspace?: { id: string; name?: string | null; slug?: string | null } | null;
  userId?: string | null;
  objectId?: string | null;
  authType?: string | null;
  tokenId?: string | null;
  token?: { id: string; type?: string | null; name?: string | null } | null;
  changes?: any;
  diff?: DiffEntry[];
  actor?: { id: string; email?: string | null; name?: string | null } | null;
};

export type AuditLogPage = { items: AuditLogItem[]; nextCursor?: string };

const eventTypeOptions = [
  { value: "auth-login", label: "Login" },
  { value: "auth-logout", label: "Logout" },
  { value: "member-invited", label: "Member invited" },
  { value: "member-joined", label: "Member joined" },
  { value: "member-removed", label: "Member removed" },
  { value: "member-role-changed", label: "Member role changed" },
  { value: "workspace-deleted", label: "Workspace deleted" },
  { value: "workspace-updated", label: "Workspace updated" },
  { value: "config-object-create", label: "Config object created" },
  { value: "config-object-update", label: "Config object updated" },
  { value: "config-object-delete", label: "Config object deleted" },
];

const severityOptions = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "security", label: "Security" },
];

function severityTag(s?: string | null) {
  if (!s) return null;
  const color = s === "security" ? "red" : s === "warning" ? "orange" : "default";
  return <Tag color={color}>{s}</Tag>;
}

/**
 * authType values written by the auth/audit code:
 *   "next-auth", "oidc", "firebase", "credentials" → UI session
 *   "bearer" → API token; the row also carries a tokenType ("api" | "cli" | …)
 * Origin renders as one of three flat labels: UI / API / CLI. Other token
 * types fall through to their raw label so we don't quietly silo them.
 */
type Origin = { label: string; color: string; icon: React.ReactNode };

const ORIGIN_UI: Origin = { label: "UI", color: "geekblue", icon: <FaWindowMaximize /> };
const ORIGIN_API: Origin = { label: "API", color: "purple", icon: <FaCloudArrowUp /> };
const ORIGIN_CLI: Origin = { label: "CLI", color: "blue", icon: <FaTerminal /> };

function resolveOrigin(item: AuditLogItem): Origin | null {
  if (!item.authType) return null;
  if (item.authType !== "bearer") return ORIGIN_UI;
  const tokenType = item.token?.type || (item.tokenId ? inferTokenTypeFromId(item.tokenId) : "api");
  if (tokenType === "cli") return ORIGIN_CLI;
  if (tokenType === "api") return ORIGIN_API;
  // Unknown bearer subtype — surface it verbatim rather than collapsing to API.
  return { label: tokenType.toUpperCase(), color: "default", icon: <FaCloudArrowUp /> };
}

function originTag(item: AuditLogItem) {
  const origin = resolveOrigin(item);
  if (!origin) return <span className="text-text-light">—</span>;
  const tooltip =
    item.authType === "bearer"
      ? item.token?.name
        ? `${item.token.name} (${item.tokenId})`
        : item.tokenId || "Bearer token"
      : `Auth: ${item.authType}`;
  return (
    <Tooltip title={tooltip}>
      <Tag color={origin.color} className="inline-flex items-center gap-1">
        <span className="inline-flex items-center">{origin.icon}</span>
        <span>{origin.label}</span>
      </Tag>
    </Tooltip>
  );
}

function entityHref(objectType: string | undefined, objectId?: string | null): string | null {
  if (!objectType || !objectId) return null;
  switch (objectType) {
    case "stream":
      return `/streams?id=${encodeURIComponent(objectId)}`;
    case "destination":
      return `/destinations?id=${encodeURIComponent(objectId)}`;
    case "service":
      return `/services?id=${encodeURIComponent(objectId)}`;
    case "function":
      return `/functions?id=${encodeURIComponent(objectId)}`;
    case "link":
      return `/connections/edit?id=${encodeURIComponent(objectId)}`;
    case "profilebuilder":
    case "profile-builder":
      return `/profile-builder`;
    default:
      return null;
  }
}

const verbForOp: Record<string, string> = {
  "config-object-create": "Created",
  "config-object-update": "Updated",
  "config-object-delete": "Deleted",
};

const objectTypeLabel: Record<string, string> = {
  stream: "site",
  destination: "destination",
  service: "service",
  function: "function",
  link: "connection",
  profilebuilder: "profile builder",
  "profile-builder": "profile builder",
};

const EventCell: React.FC<{ item: AuditLogItem; workspaceSlug: string | undefined }> = ({ item, workspaceSlug }) => {
  const c = item.changes || {};
  if (item.type.startsWith("config-object-")) {
    const verb = verbForOp[item.type] || item.type;
    const objType = c.objectType as string | undefined;
    const typeLabel = objType ? objectTypeLabel[objType] || objType : "object";
    const name = (c.objectName as string | undefined) || item.objectId || "";
    const isDelete = item.type === "config-object-delete";
    const href = !isDelete && workspaceSlug ? entityHref(objType, item.objectId) : null;
    const nameNode = (
      <Tooltip title={item.objectId || undefined}>
        {href ? (
          <Link href={`/${workspaceSlug}${href}`} className="text-primary hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}
      </Tooltip>
    );
    return (
      <span>
        {verb} {typeLabel} {nameNode}
      </span>
    );
  }
  switch (item.type) {
    case "auth-login":
      return <span>Logged in via {item.authType || "unknown"}</span>;
    case "auth-logout":
      return <span>Logged out via {item.authType || "unknown"}</span>;
    case "member-invited":
      return (
        <span>
          Invited <span className="font-medium">{c.targetEmail || "user"}</span>
          {c.newRole ? <> as {c.newRole}</> : null}
        </span>
      );
    case "member-joined":
      return <span>Joined as {c.newRole || "member"}</span>;
    case "member-removed":
      return (
        <span>
          Removed <span className="font-medium">{c.targetEmail || c.targetUserId || "user"}</span>
        </span>
      );
    case "member-role-changed":
      return (
        <span>
          Changed <span className="font-medium">{c.targetEmail || c.targetUserId || "user"}</span> role:{" "}
          {c.prevRole || "?"} → {c.newRole || "?"}
        </span>
      );
    case "workspace-deleted":
      return <span>Deleted workspace</span>;
    case "workspace-updated":
      return <span>Updated workspace</span>;
    default:
      return <span>{item.type}</span>;
  }
};

export type AuditLogProps = {
  /**
   * When set, scopes the table to a single workspace and uses that workspace
   * slug for entity edit links. When omitted, the table runs in admin mode:
   * shows a Workspace column with name + link, and queries across all
   * workspaces (server enforces admin-only access).
   */
  workspaceId?: string;
  /**
   * Slug used to build entity edit links inside config-object events. If the
   * caller already has the workspace slug it can pass it; otherwise per-row
   * `workspace.slug` (admin view) is used.
   */
  workspaceSlug?: string;
  /** Heading text. Defaults to "Audit Log". */
  title?: string;
  description?: React.ReactNode;
};

export const AuditLog: React.FC<AuditLogProps> = ({ workspaceId, workspaceSlug, title = "Audit Log", description }) => {
  const adminView = !workspaceId;
  const [types, setTypes] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<AuditLogItem[][]>([]);

  const filterKey = useMemo(
    () => JSON.stringify({ types, severities, from: range?.[0]?.toISOString(), to: range?.[1]?.toISOString() }),
    [types, severities, range]
  );

  const query = useQuery<AuditLogPage, Error>(
    ["audit-log", workspaceId || "$all", filterKey, cursor],
    async () => {
      const params: Record<string, string> = {};
      if (workspaceId) params.workspaceId = workspaceId;
      if (types.length) params.type = types.join(",");
      if (severities.length) params.severity = severities.join(",");
      if (range?.[0]) params.from = range[0].toISOString();
      if (range?.[1]) params.to = range[1].toISOString();
      if (cursor) params.cursor = cursor;
      params.limit = "50";
      return (await rpc(`/api/audit-log`, { query: params })) as AuditLogPage;
    },
    {
      retry: false,
      cacheTime: 0,
      staleTime: 0,
      refetchOnWindowFocus: false,
      onSuccess: data => {
        setPages(prev => (cursor ? [...prev, data.items] : [data.items]));
      },
    }
  );

  const items = useMemo(() => pages.flat(), [pages]);

  const columns = useMemo(() => {
    const base: any[] = [
      {
        title: "Time",
        dataIndex: "timestamp",
        key: "timestamp",
        render: (ts: string) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs">{dayjs(ts).utc().format("YYYY-MM-DD HH:mm:ss [UTC]")}</span>
            <span className="text-text-light text-xs">{dayjs(ts).fromNow()}</span>
          </div>
        ),
      },
      {
        title: "Severity",
        dataIndex: "severity",
        key: "severity",
        render: severityTag,
      },
    ];
    if (adminView) {
      base.push({
        title: "Workspace",
        key: "workspace",
        render: (_: any, item: AuditLogItem) => {
          const w = item.workspace;
          if (!w) return <span className="text-text-light">—</span>;
          const target = w.slug || w.id;
          return (
            <Link href={`/${target}`} className="text-primary hover:underline">
              {w.name || w.slug || w.id}
            </Link>
          );
        },
      });
    }
    base.push(
      {
        title: "Actor",
        key: "actor",
        render: (_: any, item: AuditLogItem) => item.actor?.email || item.actor?.name || "—",
      },
      {
        title: "Origin",
        key: "origin",
        render: (_: any, item: AuditLogItem) => originTag(item),
      },
      {
        title: "Event",
        key: "event",
        render: (_: any, item: AuditLogItem) => (
          <EventCell item={item} workspaceSlug={workspaceSlug || item.workspace?.slug || item.workspace?.id} />
        ),
      }
    );
    return base;
  }, [adminView, workspaceSlug]);

  const reset = () => {
    setCursor(undefined);
    setPages([]);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {description ? (
        <p className="text-text-light">{description}</p>
      ) : (
        <p className="text-text-light">
          {adminView
            ? "Cross-workspace record of authentication, membership, and configuration changes."
            : "A workspace-scoped record of authentication, membership, and configuration changes."}
        </p>
      )}
      <div className="flex flex-row gap-3 flex-wrap">
        <Select
          mode="multiple"
          allowClear
          placeholder="Event type"
          style={{ minWidth: 240 }}
          value={types}
          options={eventTypeOptions}
          onChange={v => {
            setTypes(v);
            reset();
          }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Severity"
          style={{ minWidth: 160 }}
          value={severities}
          options={severityOptions}
          onChange={v => {
            setSeverities(v);
            reset();
          }}
        />
        <RangePicker
          showTime
          value={range as any}
          onChange={v => {
            setRange((v as any) || null);
            reset();
          }}
        />
      </div>
      {query.isError ? <Alert type="error" message={`Failed to load audit log: ${query.error?.message}`} /> : null}
      <Table
        rowKey="id"
        className="w-full"
        columns={columns}
        dataSource={items}
        loading={query.isLoading}
        pagination={false}
        expandable={{
          rowExpandable: (item: AuditLogItem) => Array.isArray(item.diff) && item.diff.length > 0,
          expandedRowRender: (item: AuditLogItem) => (
            <div className="pl-12 pr-4 py-2 bg-neutral-50">
              <AuditLogDiff diff={item.diff || []} />
            </div>
          ),
        }}
      />
      <div className="flex justify-center">
        {query.isFetching ? (
          <Button loading disabled>
            Loading
          </Button>
        ) : query.data?.nextCursor ? (
          <Button onClick={() => setCursor(query.data?.nextCursor)}>Load more</Button>
        ) : items.length > 0 ? (
          <span className="text-text-light text-sm">End of log</span>
        ) : null}
      </div>
    </div>
  );
};

export default AuditLog;
