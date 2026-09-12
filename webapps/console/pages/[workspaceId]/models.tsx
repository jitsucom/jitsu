import React, { useRef, useState } from "react";
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
  Space,
  Table,
  Typography,
  message,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { randomId, rpc } from "juava";
import { ModelDefinition, PreviewResult, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { ModelConfig } from "../../lib/schema";
import { useConfigApi } from "../../lib/useApi";
import { useConfigObjectList } from "../../lib/store";

export default function ModelsPage() {
  return (
    <WorkspacePageLayout>
      <Models />
    </WorkspacePageLayout>
  );
}

function Models() {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const api = useConfigApi<ModelConfig>("model");
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const warehouses = useConfigObjectList("destination").filter(supportsWarehouseReader);
  const models = useQuery({ queryKey: ["reverse-etl-models", workspace.id], queryFn: () => api.list() });
  const [editing, setEditing] = useState<ModelConfig | "new">();
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [preview, setPreview] = useState<PreviewResult>();
  const [error, setError] = useState<string>();
  const previewVersion = useRef(0);
  const [form] = Form.useForm();
  const cursorType = Form.useWatch(["cursor", "type"], form);

  const open = (model: ModelConfig | "new") => {
    previewVersion.current++;
    setPreview(undefined);
    setError(undefined);
    setEditing(model);
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
    setEditing(undefined);
    setError(undefined);
    setPreview(undefined);
  };
  const doPreview = async () => {
    if (!enabled) return;
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
      setPreviewing(false);
    }
  };
  const save = async () => {
    if (!enabled) return;
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
      close();
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
    <div className="w-full max-w-6xl px-6 py-6 mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Typography.Title level={2}>Models</Typography.Title>
          <Typography.Paragraph type="secondary">
            Reusable warehouse queries for Reverse ETL audiences.
          </Typography.Paragraph>
        </div>
        <Button
          type="primary"
          disabled={!enabled || !role.editEntities || !warehouses.length}
          onClick={() => open("new")}
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
        rowKey="id"
        loading={models.isLoading}
        dataSource={models.data ?? []}
        locale={{ emptyText: <Empty description="No models yet" /> }}
        columns={[
          {
            title: "Model",
            dataIndex: "name",
            render: (name, model) => (
              <Button type="link" onClick={() => open(model)}>
                {name}
              </Button>
            ),
          },
          { title: "Warehouse", dataIndex: "warehouseId", render: id => warehouses.find(w => w.id === id)?.name ?? id },
          { title: "Primary key", dataIndex: "primaryKey", render: keys => keys.join(", ") },
          {
            title: "Extraction",
            render: (_, model) => (model.cursor ? `Incremental: ${model.cursor.column}` : "Full query"),
          },
          {
            title: "",
            render: (_, model) => (
              <Button
                danger
                disabled={!role.deleteEntities}
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
      <Modal
        title={!enabled ? "View model" : editing === "new" ? "New model" : "Edit model"}
        open={!!editing}
        width={1000}
        onCancel={close}
        maskClosable={!saving}
        closable={!saving}
        keyboard={!saving}
        footer={
          <Space>
            <Button disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!enabled || !role.editEntities}
              onClick={() => void save().catch(() => {})}
            >
              Save model
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          disabled={!enabled || !role.editEntities || saving}
          onValuesChange={changed => {
            if ("query" in changed || "warehouseId" in changed) {
              previewVersion.current++;
              setPreview(undefined);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true }]}>
            <Select options={warehouses.map(w => ({ label: w.name, value: w.id }))} placeholder="Choose a warehouse" />
          </Form.Item>
          <Form.Item
            name="query"
            label="SQL query"
            rules={[{ required: true, whitespace: true }]}
            extra="Use one read-only SELECT, including any primary-key, cursor and delete columns. Incremental filtering is added automatically."
          >
            <Input.TextArea rows={9} spellCheck={false} className="font-mono" />
          </Form.Item>
          <Button
            loading={previewing}
            disabled={!enabled || !role.editEntities || saving}
            onClick={() => void doPreview().catch(() => {})}
          >
            Preview up to 100 rows
          </Button>
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
              ]}
            />
          )}
          <div className="grid grid-cols-2 gap-x-4 mt-4">
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
            <Form.Item name={["cursor", "column"]} label="Incremental cursor (optional)">
              <Select
                allowClear
                options={columns}
                onChange={value => {
                  if (value && !form.getFieldValue(["cursor", "type"]))
                    form.setFieldValue(["cursor", "type"], "timestamp");
                }}
              />
            </Form.Item>
            <Form.Item name={["cursor", "type"]} label="Cursor value type">
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
              hidden={cursorType !== "timestamp"}
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
        {error && <Alert className="my-4" type="error" title="Model could not be processed" description={error} />}
      </Modal>
    </div>
  );
}
