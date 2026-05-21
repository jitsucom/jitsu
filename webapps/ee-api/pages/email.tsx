import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { App, Button, Card, Empty, InputNumber, Select, Spin, Table, Tag } from "antd";
import { MailOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
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

const ResultPre: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="text-xs bg-neutral-50 rounded-md p-3 overflow-auto max-h-96">{JSON.stringify(value, null, 2)}</pre>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">{children}</div>
);

/** Left column: pick a template, send it, and manage throttling. */
const ControlsPanel: React.FC<{
  workspaceId?: string;
  template?: string;
  onTemplateChange: (template?: string) => void;
  onSent: () => void;
  onThrottleChanged: () => void;
}> = ({ workspaceId, template, onTemplateChange, onSent, onThrottleChanged }) => {
  const { authFetch } = useAuth();
  const { message, modal } = App.useApp();
  const [templates, setTemplates] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [throttle, setThrottle] = useState<number>(0);
  const [throttleLoading, setThrottleLoading] = useState(false);
  const [throttleSaving, setThrottleSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await authFetch("/api/admin/email");
        if (!resp.ok) {
          throw new Error(await readError(resp));
        }
        const { templates } = await resp.json();
        if (!cancelled) {
          setTemplates(templates || []);
        }
      } catch (e: any) {
        if (!cancelled) {
          message.error(`Failed to load templates: ${e?.message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, message]);

  useEffect(() => {
    if (!workspaceId) {
      setThrottle(0);
      // Clear any spinner left by a request that was superseded mid-flight.
      setThrottleLoading(false);
      return;
    }
    let cancelled = false;
    setThrottleLoading(true);
    (async () => {
      try {
        const resp = await authFetch(`/api/admin/set-throttle?workspaceId=${encodeURIComponent(workspaceId)}`);
        if (!resp.ok) {
          throw new Error(await readError(resp));
        }
        const { throttle } = await resp.json();
        if (!cancelled) {
          setThrottle(throttle ?? 0);
        }
      } catch (e: any) {
        if (!cancelled) {
          message.error(`Failed to load throttle: ${e?.message}`);
        }
      } finally {
        if (!cancelled) {
          setThrottleLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, workspaceId, message]);

  const sendEmail = async () => {
    if (!workspaceId || !template) {
      return;
    }
    setSending(true);
    try {
      const resp = await authFetch("/api/admin/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, workspaceId }),
      });
      if (!resp.ok) {
        throw new Error(await readError(resp));
      }
      const result = await resp.json();
      const sentCount = Object.keys(result?.sent || {}).length;
      const errorCount = Object.keys(result?.errors || {}).length;
      if (errorCount > 0) {
        message.warning(`Email sent to ${sentCount} recipient(s), ${errorCount} failed`);
      } else {
        message.success(`Email sent to ${sentCount} recipient(s)`);
      }
      onSent();
    } catch (e: any) {
      message.error(`Failed to send email: ${e?.message}`);
    } finally {
      setSending(false);
    }
  };

  const saveThrottle = async () => {
    if (!workspaceId) {
      return;
    }
    setThrottleSaving(true);
    try {
      const resp = await authFetch("/api/admin/set-throttle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, throttle }),
      });
      if (!resp.ok) {
        throw new Error(await readError(resp));
      }
      const result = await resp.json();
      modal.info({ title: "Throttle updated", width: 680, content: <ResultPre value={result} /> });
      onThrottleChanged();
    } catch (e: any) {
      message.error(`Failed to set throttle: ${e?.message}`);
    } finally {
      setThrottleSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card size="small" title="Send email">
        <SectionLabel>Template</SectionLabel>
        <Select
          className="w-full"
          showSearch
          optionFilterProp="label"
          allowClear
          placeholder="Select a template"
          value={template}
          onChange={v => onTemplateChange(v || undefined)}
          options={templates.map(t => ({ value: t, label: t }))}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          block
          className="mt-3"
          loading={sending}
          disabled={!workspaceId || !template}
          onClick={sendEmail}
        >
          Send to workspace
        </Button>
        <div className="text-xs text-neutral-400 mt-2">
          {workspaceId ? "Sends to every member of the workspace." : "Select a workspace to send."}
        </div>
      </Card>

      <Card size="small" title="Throttling">
        <SectionLabel>Throttle %</SectionLabel>
        <Spin spinning={throttleLoading}>
          <div className="flex gap-2">
            <InputNumber
              min={0}
              max={100}
              addonAfter="%"
              className="flex-1"
              style={{ width: "100%" }}
              value={throttle}
              onChange={v => setThrottle(v ?? 0)}
              disabled={!workspaceId}
            />
            <Button type="primary" loading={throttleSaving} disabled={!workspaceId} onClick={saveThrottle}>
              Save
            </Button>
          </div>
        </Spin>
        <div className="text-xs text-neutral-400 mt-2">Percentage of events to drop. 0 disables throttling.</div>
      </Card>
    </div>
  );
};

/** Right column: live render of the selected template. */
const PreviewPanel: React.FC<{ template?: string }> = ({ template }) => {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ html: string; subject: string; from: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!template) {
      setPreview(null);
      setError(null);
      // Clear any spinner left by a request that was superseded mid-flight.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const resp = await authFetch(`/api/admin/email-preview?template=${encodeURIComponent(template)}`);
        if (!resp.ok) {
          throw new Error(await readError(resp));
        }
        const data = await resp.json();
        if (!cancelled) {
          setPreview(data);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to render preview");
          setPreview(null);
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
  }, [authFetch, template]);

  return (
    <Card size="small" title="Preview" styles={{ body: { padding: 0 } }} className="overflow-hidden">
      {preview && (
        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50">
          {preview.from && (
            <div className="text-xs text-neutral-500">
              <span className="font-medium text-neutral-600">From</span>&nbsp;&nbsp;{preview.from}
            </div>
          )}
          <div className="text-sm font-medium text-neutral-900 mt-0.5">{preview.subject}</div>
        </div>
      )}
      <div className="relative bg-neutral-100" style={{ height: 720 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <Spin />
          </div>
        )}
        {!template && !loading && (
          <div className="flex h-full items-center justify-center">
            <Empty
              image={<MailOutlined className="text-5xl text-neutral-300" />}
              description={<span className="text-neutral-400">Select a template to preview it</span>}
            />
          </div>
        )}
        {error && (
          <div className="flex h-full items-center justify-center px-8">
            <div className="text-center text-sm text-red-500">{error}</div>
          </div>
        )}
        {preview && !error && (
          <div className="flex h-full justify-center p-6">
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox=""
              className="h-full w-full max-w-[680px] rounded-md border border-neutral-200 bg-white"
            />
          </div>
        )}
      </div>
    </Card>
  );
};

/** Full-width: email-sending log for the workspace. */
const EmailHistoryCard: React.FC<{ workspaceId?: string; reloadToken: number }> = ({ workspaceId, reloadToken }) => {
  const { authFetch } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!workspaceId) {
      setRows([]);
      // Clear any spinner left by a request that was superseded mid-flight.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const resp = await authFetch(`/api/admin/email-history?workspaceId=${encodeURIComponent(workspaceId)}`);
        if (!resp.ok) {
          throw new Error(await readError(resp));
        }
        const { history } = await resp.json();
        if (!cancelled) {
          setRows((history || []).map((r: any, i: number) => ({ ...r, key: `${r.timestamp}-${i}` })));
        }
      } catch (e: any) {
        if (!cancelled) {
          message.error(`Failed to load email history: ${e?.message}`);
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
  }, [authFetch, workspaceId, message, reloadToken, tick]);

  const columns = [
    {
      title: "Timestamp",
      dataIndex: "timestamp",
      width: 190,
      render: (t: string) => (t ? new Date(t).toLocaleString() : "—"),
    },
    { title: "Template", dataIndex: "template", width: 210 },
    {
      title: "Subject",
      dataIndex: "subject",
      render: (s: string | string[]) => (Array.isArray(s) ? s.join(", ") : s),
    },
    { title: "Sent to", dataIndex: "sentTo" },
    {
      title: "Errors",
      dataIndex: "errors",
      render: (e: string) => (e ? <Tag color="error">{e}</Tag> : null),
    },
  ];

  return (
    <Card
      size="small"
      title="Email history"
      extra={
        <Button size="small" icon={<ReloadOutlined />} disabled={!workspaceId} onClick={() => setTick(t => t + 1)}>
          Refresh
        </Button>
      }
    >
      <Table
        size="small"
        loading={loading}
        rowKey="key"
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: workspaceId ? "No emails sent yet" : "Select a workspace to see its email history" }}
      />
    </Card>
  );
};

function EmailPage() {
  const router = useRouter();
  const workspaceId = typeof router.query.workspace === "string" ? router.query.workspace : undefined;
  const [template, setTemplate] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);
  const refreshHistory = useCallback(() => setReloadToken(t => t + 1), []);

  const setWorkspaceId = useCallback(
    (id: string | undefined) => {
      const query: Record<string, any> = { ...router.query };
      if (id) {
        query.workspace = id;
      } else {
        delete query.workspace;
      }
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router]
  );

  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="text-2xl font-semibold text-neutral-900">Email</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Preview and send templated emails to a workspace, and manage event throttling.
      </p>

      <div className="mt-6">
        <WorkspaceSelector value={workspaceId} onChange={setWorkspaceId} />
      </div>

      <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="w-full lg:w-[340px] lg:shrink-0">
          <ControlsPanel
            workspaceId={workspaceId}
            template={template}
            onTemplateChange={setTemplate}
            onSent={refreshHistory}
            onThrottleChanged={refreshHistory}
          />
        </div>
        <div className="min-w-0 flex-1">
          <PreviewPanel template={template} />
        </div>
      </div>

      <div className="mt-5">
        <EmailHistoryCard workspaceId={workspaceId} reloadToken={reloadToken} />
      </div>
    </div>
  );
}

export default function EmailPageRoute() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <EmailPage />
      </AdminLayout>
    </RequireAdmin>
  );
}
