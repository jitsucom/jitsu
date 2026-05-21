import React, { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Table } from "antd";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { AdminLayout } from "../components/AdminLayout";
import { RequireAdmin } from "../components/RequireAdmin";
import { WorkspaceSelector } from "../components/WorkspaceSelector";
import { useAuth } from "../components/AuthProvider";

/** Best-effort error message from a non-OK API response. */
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

type WorkspaceRef = { id: string; name: string; slug: string | null };
type BillingParentLink = { child: WorkspaceRef; parent: WorkspaceRef; createdAt: string };

const WorkspaceCell: React.FC<{ workspace: WorkspaceRef }> = ({ workspace }) => (
  <div className="flex items-baseline gap-2">
    <span className="font-medium text-neutral-900">{workspace.name}</span>
    {workspace.slug && <span className="text-indigo-600">{workspace.slug}</span>}
    <span className="font-mono text-xs text-neutral-400">{workspace.id}</span>
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">{children}</div>
);

function BillingParentsPage() {
  const { authFetch } = useAuth();
  const { message, modal } = App.useApp();
  const [childId, setChildId] = useState<string | undefined>();
  const [parentId, setParentId] = useState<string | undefined>();
  const [links, setLinks] = useState<BillingParentLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const resp = await authFetch("/api/admin/billing-parents");
        if (!resp.ok) {
          throw new Error(await readError(resp));
        }
        const { links } = await resp.json();
        if (!cancelled) {
          setLinks(links || []);
        }
      } catch (e: any) {
        if (!cancelled) {
          message.error(`Failed to load billing-parent links: ${e?.message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, message, tick]);

  const link = async () => {
    if (!childId || !parentId) {
      return;
    }
    setLinking(true);
    try {
      const resp = await authFetch("/api/admin/billing-parents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: childId, parentWorkspaceId: parentId }),
      });
      if (!resp.ok) {
        throw new Error(await readError(resp));
      }
      message.success("Billing-parent link created");
      setChildId(undefined);
      setParentId(undefined);
      reload();
    } catch (e: any) {
      message.error(`Failed to link workspaces: ${e?.message}`);
    } finally {
      setLinking(false);
    }
  };

  const unlink = (row: BillingParentLink) => {
    modal.confirm({
      title: "Remove billing-parent link?",
      content: `${row.child.name} will bill on its own again instead of under ${row.parent.name}.`,
      okText: "Unlink",
      okButtonProps: { danger: true },
      onOk: async () => {
        const resp = await authFetch("/api/admin/billing-parents", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: row.child.id }),
        });
        if (!resp.ok) {
          const error = await readError(resp);
          message.error(`Failed to unlink: ${error}`);
          throw new Error(error);
        }
        message.success("Billing-parent link removed");
        reload();
      },
    });
  };

  const columns = [
    {
      title: "Child workspace",
      key: "child",
      render: (_: unknown, row: BillingParentLink) => <WorkspaceCell workspace={row.child} />,
    },
    {
      title: "Bills under (parent)",
      key: "parent",
      render: (_: unknown, row: BillingParentLink) => <WorkspaceCell workspace={row.parent} />,
    },
    {
      title: "Linked",
      dataIndex: "createdAt",
      width: 190,
      render: (t: string) => (t ? new Date(t).toLocaleString() : "—"),
    },
    {
      title: "",
      key: "action",
      width: 100,
      render: (_: unknown, row: BillingParentLink) => (
        <Button size="small" danger onClick={() => unlink(row)}>
          Unlink
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="text-2xl font-semibold text-neutral-900">Billing Parents</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Link a workspace to bill under a parent. The child inherits the parent&apos;s plan, and the parent&apos;s
        billing page consolidates the whole group. Only one level of nesting is allowed; free workspaces cannot be
        joined.
      </p>

      <Card size="small" title="Create link" className="mt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <SectionLabel>Child workspace</SectionLabel>
            <WorkspaceSelector value={childId} onChange={setChildId} />
          </div>
          <div className="min-w-0 flex-1">
            <SectionLabel>Parent workspace</SectionLabel>
            <WorkspaceSelector value={parentId} onChange={setParentId} />
          </div>
          <Button
            type="primary"
            icon={<LinkOutlined />}
            className="h-16 lg:w-32"
            loading={linking}
            disabled={!childId || !parentId}
            onClick={link}
          >
            Link
          </Button>
        </div>
      </Card>

      <Card
        size="small"
        title="Existing links"
        className="mt-5"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
            Refresh
          </Button>
        }
      >
        <Table
          size="small"
          loading={loading}
          rowKey={row => row.child.id}
          dataSource={links}
          columns={columns}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: "No billing-parent links yet" }}
        />
      </Card>
    </div>
  );
}

export default function BillingParentsPageRoute() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <BillingParentsPage />
      </AdminLayout>
    </RequireAdmin>
  );
}
