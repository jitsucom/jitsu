import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace, useWorkspaceRole } from "../../../lib/context";
import React, { useMemo, useState } from "react";
import { Alert, Button, DatePicker, Select, Table, Tag, Tooltip } from "antd";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { rpc } from "juava";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

dayjs.extend(utc);
dayjs.extend(relativeTime);

const { RangePicker } = DatePicker;

type AuditLogItem = {
  id: string;
  timestamp: string;
  type: string;
  severity?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  objectId?: string | null;
  authType?: string | null;
  changes?: any;
  actor?: { id: string; email?: string | null; name?: string | null } | null;
};

type AuditLogPage = { items: AuditLogItem[]; nextCursor?: string };

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

// Map a config-object `objectType` value to the workspace-relative URL where the
// entity is edited. Returning null means "no link" (e.g. profile-builder root,
// link/connection without a stable per-id route).
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

const EventCell: React.FC<{ item: AuditLogItem; workspaceSlug: string }> = ({ item, workspaceSlug }) => {
  const c = item.changes || {};
  if (item.type.startsWith("config-object-")) {
    const verb = verbForOp[item.type] || item.type;
    const objType = c.objectType as string | undefined;
    const typeLabel = objType ? objectTypeLabel[objType] || objType : "object";
    const name = (c.objectName as string | undefined) || item.objectId || "";
    const isDelete = item.type === "config-object-delete";
    const href = isDelete ? null : entityHref(objType, item.objectId);
    return (
      <span>
        {verb} {typeLabel}{" "}
        {href ? (
          <Link href={`/${workspaceSlug}${href}`} className="text-primary hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}
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
          Changed <span className="font-medium">{c.targetEmail || c.targetUserId || "user"}</span> role: {c.prevRole || "?"}{" "}
          → {c.newRole || "?"}
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

const AuditLogTable: React.FC = () => {
  const workspace = useWorkspace();
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
    ["audit-log", workspace.id, filterKey, cursor],
    async () => {
      const params: Record<string, string> = {};
      if (types.length) params.type = types.join(",");
      if (severities.length) params.severity = severities.join(",");
      if (range?.[0]) params.from = range[0].toISOString();
      if (range?.[1]) params.to = range[1].toISOString();
      if (cursor) params.cursor = cursor;
      params.limit = "50";
      return (await rpc(`/api/${workspace.id}/audit-log`, { query: params })) as AuditLogPage;
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

  const columns = [
    {
      title: "Time",
      dataIndex: "timestamp",
      key: "timestamp",
      render: (ts: string) => (
        <Tooltip title={dayjs(ts).utc().format("YYYY-MM-DD HH:mm:ss [UTC]")}>{dayjs(ts).fromNow()}</Tooltip>
      ),
    },
    {
      title: "Severity",
      dataIndex: "severity",
      key: "severity",
      render: severityTag,
    },
    {
      title: "Actor",
      key: "actor",
      render: (_: any, item: AuditLogItem) => item.actor?.email || item.actor?.name || "—",
    },
    {
      title: "Event",
      key: "event",
      render: (_: any, item: AuditLogItem) => <EventCell item={item} workspaceSlug={workspace.slugOrId} />,
    },
  ];

  const reset = () => {
    setCursor(undefined);
    setPages([]);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <p className="text-text-light">
        A workspace-scoped record of authentication, membership, and configuration changes.
      </p>
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
      {query.isError ? (
        <Alert type="error" message={`Failed to load audit log: ${query.error?.message}`} />
      ) : null}
      <Table
        rowKey="id"
        className="w-full"
        columns={columns as any}
        dataSource={items}
        loading={query.isLoading}
        pagination={false}
      />
      <div className="flex justify-center">
        {query.data?.nextCursor ? (
          <Button onClick={() => setCursor(query.data?.nextCursor)} disabled={query.isFetching}>
            Load more
          </Button>
        ) : items.length > 0 ? (
          <span className="text-text-light text-sm">End of log</span>
        ) : null}
      </div>
    </div>
  );
};

const AuditLogPage: React.FC = () => {
  const role = useWorkspaceRole();
  return (
    <WorkspacePageLayout>
      {role.manageUsers ? (
        <AuditLogTable />
      ) : (
        <Alert
          type="warning"
          showIcon
          message="Access denied"
          description="The audit log is visible to workspace owners only."
        />
      )}
    </WorkspacePageLayout>
  );
};

export default AuditLogPage;
