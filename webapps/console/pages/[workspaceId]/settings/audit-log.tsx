import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace, useWorkspaceRole } from "../../../lib/context";
import React, { useMemo, useState } from "react";
import { Alert, Button, DatePicker, Select, Table, Tag, Tooltip } from "antd";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { rpc } from "juava";
import { useQuery } from "@tanstack/react-query";

dayjs.extend(utc);

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

function describeEvent(item: AuditLogItem): string {
  const c = item.changes || {};
  switch (item.type) {
    case "auth-login":
      return `Logged in via ${item.authType || "unknown"}`;
    case "auth-logout":
      return `Logged out via ${item.authType || "unknown"}`;
    case "member-invited":
      return `Invited ${c.targetEmail || "user"}${c.newRole ? ` as ${c.newRole}` : ""}`;
    case "member-joined":
      return `Joined as ${c.newRole || "member"}`;
    case "member-removed":
      return `Removed ${c.targetEmail || c.targetUserId || "user"}`;
    case "member-role-changed":
      return `Changed ${c.targetEmail || c.targetUserId || "user"} role: ${c.prevRole || "?"} → ${c.newRole || "?"}`;
    case "workspace-deleted":
      return `Deleted workspace`;
    case "workspace-updated":
      return `Updated workspace`;
    case "config-object-create":
      return `Created ${c.objectType || "object"}`;
    case "config-object-update":
      return `Updated ${c.objectType || "object"}`;
    case "config-object-delete":
      return `Deleted ${c.objectType || "object"}`;
    default:
      return item.type;
  }
}

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
      width: 180,
      render: (ts: string) => (
        <Tooltip title={dayjs(ts).utc().format("YYYY-MM-DD HH:mm:ss [UTC]")}>{dayjs(ts).format("YYYY-MM-DD HH:mm:ss")}</Tooltip>
      ),
    },
    {
      title: "Severity",
      dataIndex: "severity",
      key: "severity",
      width: 110,
      render: severityTag,
    },
    {
      title: "Actor",
      key: "actor",
      width: 250,
      render: (_: any, item: AuditLogItem) => (
        <span>
          {item.actor?.email || item.actor?.name || "—"}
          {item.authType ? (
            <Tag style={{ marginLeft: 6 }} color="blue">
              {item.authType}
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: "Event",
      key: "event",
      render: (_: any, item: AuditLogItem) => describeEvent(item),
    },
  ];

  const reset = () => {
    setCursor(undefined);
    setPages([]);
  };

  return (
    <div className="flex flex-col gap-4">
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
        columns={columns as any}
        dataSource={items}
        loading={query.isLoading}
        pagination={false}
        expandable={{
          expandedRowRender: (item: AuditLogItem) => (
            <pre style={{ margin: 0, fontSize: 12, background: "#f9fafb", padding: 8, overflowX: "auto" }}>
              {JSON.stringify(item.changes ?? {}, null, 2)}
            </pre>
          ),
          rowExpandable: item => !!item.changes,
        }}
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
