import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Typography,
  Tabs,
  Tag,
  message,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { randomId, rpc } from "juava";
import { ModelDefinition, PreviewResult, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { ModelConfig } from "../../lib/schema";
import { useConfigApi } from "../../lib/useApi";
import { useConfigObjectList } from "../../lib/store";
import { EditorTitle } from "../../components/ConfigObjectEditor/EditorTitle";
import { useUnsavedChanges } from "../../lib/ui";

const SqlEditor = dynamic(() => import("../../components/CodeEditor/CodeEditor").then(m => m.CodeEditor), {
  ssr: false,
});

export default function ModelsPage() {
  return (
    <WorkspacePageLayout>
      <Models />
    </WorkspacePageLayout>
  );
}

function Models() {
  const workspace = useWorkspace();
  const router = useRouter();
  const maintenance = !!useAppConfig().maintenance?.active;
  const role = useWorkspaceRole();
  const api = useConfigApi<ModelConfig>("model");
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const warehouses = useConfigObjectList("destination").filter(supportsWarehouseReader);
  const models = useQuery({ queryKey: ["reverse-etl-models", workspace.id], queryFn: () => api.list() });
  const [editing, setEditing] = useState<ModelConfig | "new">();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty && !saving);
  const [previewing, setPreviewing] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [preview, setPreview] = useState<PreviewResult>();
  const [error, setError] = useState<string>();
  const previewVersion = useRef(0);
  const [form] = Form.useForm();
  const cursorType = Form.useWatch(["cursor", "type"], form);
  const [incremental, setIncremental] = useState(false);
  const links = useQuery({
    queryKey: ["reverse-etl-links", workspace.id],
    queryFn: async (): Promise<any[]> => (await rpc(`/api/${workspace.id}/config/link`)).links,
  });
  const dependencies = (links.data ?? []).filter(
    l => l.type === "reverse-sync" && l.fromId === (editing !== "new" ? editing?.id : undefined)
  );
  const readonly = !enabled || !role.editEntities || maintenance || dependencies.length > 0;

  useEffect(() => {
    const id = router.query.id;
    if (!id) {
      close();
      return;
    }
    if ((id === "new" && editing === "new") || (editing && editing !== "new" && editing.id === id)) return;
    if (id === "new") open("new");
    else {
      const model = models.data?.find(m => m.id === id);
      if (model) open(model);
    }
  }, [router.query.id, models.data]);

  const open = (model: ModelConfig | "new") => {
    previewVersion.current++;
    setPreviewing(false);
    setPreview(undefined);
    setError(undefined);
    setEditing(model);
    setDirty(false);
    setIncremental(model !== "new" && !!model.cursor);
    form.resetFields();
    form.setFieldsValue(
      model === "new"
        ? {
            name: "",
            query: "SELECT id, email FROM users",
            primaryKey: [],
            pageSize: 1000,
          }
        : model
    );
  };
  const close = () => {
    previewVersion.current++;
    setPreviewing(false);
    setEditing(undefined);
    setError(undefined);
    setPreview(undefined);
    setDirty(false);
  };
  const doPreview = async () => {
    if (!enabled || !role.editEntities || maintenance || saving) return;
    const values = await form.validateFields(["warehouseId", "query"]);
    const version = ++previewVersion.current;
    setPreviewing(true);
    setError(undefined);
    try {
      const result = await rpc(`/api/${workspace.id}/models/preview`, {
        method: "POST",
        body: { warehouseId: values.warehouseId, query: values.query },
      });
      if (version === previewVersion.current) {
        setPreview(PreviewResult.parse(result));
        setPreviewExpanded(true);
      }
    } catch (e) {
      if (version === previewVersion.current) setError((e as Error).message);
    } finally {
      if (version === previewVersion.current) setPreviewing(false);
    }
  };
  const save = async () => {
    if (readonly) return;
    const values = await form.validateFields();
    setSaving(true);
    setError(undefined);
    try {
      // An empty cursor picker means full extraction, not a half-configured cursor.
      const definition = ModelDefinition.parse({
        ...values,
        cursor: values.cursor?.column ? values.cursor : undefined,
      });
      const model = ModelConfig.parse({
        ...definition,
        id: editing === "new" ? randomId() : editing!.id,
        name: values.name,
        type: "model",
        workspaceId: workspace.id,
      });
      if (editing === "new") await api.create(model);
      else
        await api.update(model.id, {
          ...model,
          cursor: model.cursor ?? null,
          deleteColumn: model.deleteColumn ?? null,
        } as any);
      await models.refetch();
      setDirty(false);
      await router.push({ pathname: router.pathname, query: { workspaceId: workspace.slugOrId } });
      message.success("Model saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const columns = preview?.columns.map(c => ({ label: `${c.name} (${c.type})`, value: c.name })) ?? [];
  const deleteColumns =
    preview?.columns.filter(c => c.supportsDelete).map(c => ({ label: `${c.name} (${c.type})`, value: c.name })) ?? [];
  return (
    <div className="w-full max-w-6xl px-4 md:px-8 py-6 mx-auto min-w-0">
      {!router.query.id && (
        <>
          <div className="flex items-start justify-between mb-6">
            <div>
              <Typography.Title level={2}>Models</Typography.Title>
              <Typography.Paragraph type="secondary">
                Reusable warehouse queries for Reverse ETL audiences.
              </Typography.Paragraph>
            </div>
            <Button
              type="primary"
              disabled={!enabled || !role.editEntities || maintenance || !warehouses.length}
              onClick={() => router.push({ pathname: router.pathname, query: { ...router.query, id: "new" } })}
            >
              New model
            </Button>
          </div>
          {!enabled && (
            <Alert
              className="mb-4"
              type="info"
              title="Reverse ETL is not enabled for this workspace"
              description="Existing models can be viewed or deleted. Creating, editing and previewing models requires Reverse ETL to be enabled."
            />
          )}
          {enabled && !warehouses.length && (
            <Alert
              className="mb-4"
              type="info"
              title="Connect a supported warehouse first"
              description="Models currently support Postgres with password authentication and ClickHouse over HTTP or HTTPS. Use a connection with read-only warehouse permissions."
            />
          )}
          {!!models.error && <Alert type="error" title={(models.error as Error).message} />}
          <Table<ModelConfig>
            scroll={{ x: 850 }}
            rowKey="id"
            loading={models.isLoading}
            dataSource={models.data ?? []}
            locale={{ emptyText: <Empty description="No models yet" /> }}
            columns={[
              {
                title: "Model",
                dataIndex: "name",
                render: (name, model) => (
                  <Button
                    type="link"
                    onClick={() => router.push({ pathname: router.pathname, query: { ...router.query, id: model.id } })}
                  >
                    {name}
                  </Button>
                ),
              },
              {
                title: "Warehouse",
                dataIndex: "warehouseId",
                render: id => warehouses.find(w => w.id === id)?.name ?? id,
              },
              { title: "Primary key", dataIndex: "primaryKey", render: keys => keys.join(", ") },
              {
                title: "Extraction",
                render: (_, model) => <Tag>{model.cursor ? `Incremental: ${model.cursor.column}` : "Full query"}</Tag>,
              },
              {
                title: "Syncs",
                render: (_, model) =>
                  (links.data ?? []).filter(l => l.type === "reverse-sync" && l.fromId === model.id).length,
              },
              {
                title: "",
                render: (_, model) => (
                  <Button
                    type="link"
                    disabled={!enabled || !role.editEntities || maintenance}
                    onClick={() =>
                      router.push(`/${workspace.slugOrId}/reverse-syncs?id=new&modelId=${encodeURIComponent(model.id)}`)
                    }
                  >
                    Create sync
                  </Button>
                ),
              },
              {
                title: "",
                render: (_, model) => (
                  <Button
                    danger
                    disabled={!role.deleteEntities || maintenance}
                    onClick={() =>
                      Modal.confirm({
                        title: `Delete ${model.name}?`,
                        content: "Models used by reverse syncs cannot be deleted.",
                        okText: "Delete",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          try {
                            await api.del(model.id, { strict: true });
                            await models.refetch();
                          } catch (e) {
                            message.error((e as Error).message);
                            throw e;
                          }
                        },
                      })
                    }
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      {router.query.id && !editing && (
        <Alert
          type={models.isLoading ? "info" : "error"}
          title={models.isLoading ? "Loading model…" : "Model not found"}
        />
      )}
      {editing && router.query.id && (
        <>
          <EditorTitle
            title={!enabled ? "View model" : editing === "new" ? "New model" : editing.name}
            subtitle={
              <p className="text-textLight mb-6">Define the audience once. Reuse it across destination syncs.</p>
            }
            onBack={() => void router.push(`/${workspace.slugOrId}/models`)}
          />
          {dependencies.length > 0 && (
            <Alert
              className="mb-4"
              type="info"
              title="This model is used by reverse syncs"
              description={
                <span>
                  Its query and identity are locked to protect saved delivery state.{" "}
                  <a href={`/${workspace.slugOrId}/reverse-syncs?modelId=${editing !== "new" ? editing.id : ""}`}>
                    View {dependencies.length} dependent sync(s)
                  </a>
                  .
                </span>
              }
            />
          )}
          <Form
            form={form}
            layout="vertical"
            disabled={readonly || saving}
            onValuesChange={changed => {
              setDirty(true);
              if ("query" in changed || "warehouseId" in changed) {
                previewVersion.current++;
                setPreview(undefined);
                setPreviewing(false);
              }
            }}
          >
            <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
              <Select
                options={warehouses.map(w => ({ label: w.name, value: w.id }))}
                placeholder="Choose a warehouse"
              />
            </Form.Item>
            <Form.Item
              name="query"
              label="SQL query"
              rules={[{ required: true, whitespace: true }]}
              extra="Use one read-only SELECT, including any primary-key, cursor and delete columns. Incremental filtering is added automatically."
            >
              <SqlEditor
                value=""
                onChange={() => {}}
                language="sql"
                height="320px"
                monacoOptions={{ readOnly: readonly || saving, minimap: { enabled: false }, wordWrap: "on" }}
                ctrlEnterCallback={() => void doPreview().catch(() => {})}
              />
            </Form.Item>
            <Button
              loading={previewing}
              disabled={!enabled || !role.editEntities || saving}
              onClick={() => void doPreview().catch(() => {})}
            >
              Preview up to 100 rows
            </Button>
            {error && <Alert className="mt-4" type="error" title="Model could not be processed" description={error} />}
            {preview && (
              <Collapse
                className="mt-4"
                activeKey={previewExpanded ? ["preview"] : []}
                onChange={keys => setPreviewExpanded(keys.includes("preview"))}
                items={[
                  {
                    key: "preview",
                    label: `Preview · ${preview.rows.length} rows${preview.truncated ? " (limited)" : ""}`,
                    children: (
                      <Tabs
                        items={[
                          {
                            key: "rows",
                            label: "Rows",
                            children: (
                              <Table<{ index: number; values: Record<string, unknown> }>
                                size="small"
                                scroll={{ x: true }}
                                pagination={{ pageSize: 10 }}
                                rowKey="index"
                                dataSource={preview.rows.map((values, index) => ({ values, index }))}
                                columns={preview.columns.map(c => ({
                                  title: c.name,
                                  key: c.name,
                                  render: (_, row) => {
                                    const value = row.values[c.name];
                                    return (
                                      <span className="font-mono whitespace-pre-wrap break-all">
                                        {value == null
                                          ? "NULL"
                                          : typeof value === "object"
                                          ? JSON.stringify(value)
                                          : String(value)}
                                      </span>
                                    );
                                  },
                                }))}
                              />
                            ),
                          },
                          {
                            key: "columns",
                            label: "Columns",
                            children: (
                              <Table
                                rowKey="name"
                                size="small"
                                pagination={false}
                                dataSource={preview.columns}
                                columns={[
                                  { title: "Column", dataIndex: "name" },
                                  { title: "Type", dataIndex: "type" },
                                ]}
                              />
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-6 border-t border-textDisabled pt-6">
              <Form.Item label="Extraction">
                <Select
                  value={incremental ? "incremental" : "full"}
                  options={[
                    { value: "full", label: "Full query" },
                    { value: "incremental", label: "Incremental cursor" },
                  ]}
                  onChange={v => {
                    setIncremental(v === "incremental");
                    setDirty(true);
                    if (v === "full") form.setFieldValue("cursor", undefined);
                  }}
                />
              </Form.Item>
              <Form.Item
                name="primaryKey"
                label="Primary-key columns"
                rules={[{ required: true, type: "array", min: 1 }]}
                extra="Preview the query to populate column pickers."
              >
                <Select mode="multiple" options={columns} placeholder="Select stable, unique columns" />
              </Form.Item>
              <Form.Item
                name="deleteColumn"
                label="Delete column (optional)"
                extra="Use a boolean SELECT expression, or a column containing only 0/1 values (null means keep). Preview to list compatible types."
              >
                <Select allowClear options={deleteColumns} />
              </Form.Item>
              <Form.Item
                name={["cursor", "column"]}
                label="Incremental cursor"
                hidden={!incremental}
                rules={incremental ? [{ required: true }] : []}
              >
                <Select
                  allowClear
                  options={columns}
                  onChange={value => {
                    if (value && !form.getFieldValue(["cursor", "type"]))
                      form.setFieldValue(["cursor", "type"], "timestamp");
                  }}
                />
              </Form.Item>
              <Form.Item
                name={["cursor", "type"]}
                label="Cursor value type"
                hidden={!incremental}
                rules={incremental ? [{ required: true }] : []}
              >
                <Select
                  allowClear
                  options={["timestamp", "number", "string"].map(value => ({ value, label: value }))}
                  onChange={type => {
                    if (type !== "timestamp") form.setFieldValue(["cursor", "lookbackSeconds"], undefined);
                  }}
                />
              </Form.Item>
              <Form.Item
                name={["cursor", "lookbackSeconds"]}
                label="Timestamp lookback (seconds)"
                hidden={!incremental || cursorType !== "timestamp"}
                extra="Re-read this window to capture late-arriving updates (maximum 7 days)."
                getValueFromEvent={value => value ?? undefined}
              >
                <InputNumber min={0} max={604800} precision={0} />
              </Form.Item>
              <Form.Item name="pageSize" label="Read batch size">
                <InputNumber min={1} max={10000} precision={0} />
              </Form.Item>
            </div>
            <Form.Item name="description" label="Description (optional)">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
          <div className="flex justify-end gap-3 border-t border-textDisabled pt-6 mt-6">
            <Button disabled={saving} onClick={() => router.push(`/${workspace.slugOrId}/models`)}>
              Cancel
            </Button>
            <Button type="primary" loading={saving} disabled={readonly} onClick={() => void save().catch(() => {})}>
              Save model
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
