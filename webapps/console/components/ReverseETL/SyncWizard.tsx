import React, { useRef, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Form, Input, Radio, Select, Steps, Tag } from "antd";
import { useRouter } from "next/router";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { PreviewResult } from "@jitsu/warehouse-query/src/schema";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useConfigApi } from "../../lib/useApi";
import { useConfigObjectList } from "../../lib/store";
import { ModelConfig } from "../../lib/schema";
import { ReverseSyncSetup } from "../../lib/reverse-etl";
import { useUnsavedChanges } from "../../lib/ui";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import { Failure, Panel } from "./shared";
import { ScheduleEditor } from "./ScheduleEditor";

export function SyncWizard() {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const router = useRouter();
  const maintenance = useAppConfig().maintenance?.active;
  const api = useConfigApi<ModelConfig>("model");
  const models = useQuery({ queryKey: ["reverse-etl-models", workspace.id], queryFn: () => api.list() });
  const destinations = useConfigObjectList("destination").filter(d => d.destinationType === "google-ads");
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [preview, setPreview] = useState<PreviewResult>();
  const [validated, setValidated] = useState<{ sampleRows: number; audienceName?: string }>();
  const [locked, setLocked] = useState(false);
  const version = useRef(0);
  const request = useRef<{ requestId: string; setup: ReverseSyncSetup }>();
  const modelId = Form.useWatch("modelId", { form, preserve: true });
  const kind = Form.useWatch("audienceKind", { form, preserve: true }) ?? "managed";
  const strategy = Form.useWatch("mirrorStrategy", { form, preserve: true }) ?? "snapshot-diff";
  const replacement = strategy === "full-replace";
  const model = models.data?.find(m => m.id === modelId);
  const destId = Form.useWatch("destinationId", { form, preserve: true });
  const destination = destinations.find(d => d.id === destId);
  const readonly = !workspace.featuresEnabled.includes("reverse-etl") || !role.editEntities || !!maintenance;
  useUnsavedChanges(dirty && !busy && !locked);
  const columns = preview?.columns.map(c => ({ value: c.name, label: c.name })) ?? [];
  const payload = () => {
    const values = form.getFieldsValue(true);
    const mapping: Record<string, string> = {};
    if (values.emailColumn) mapping[values.emailFormat === "hashed" ? "hashedEmail" : "email"] = values.emailColumn;
    if (values.phoneColumn) mapping[values.phoneFormat === "hashed" ? "hashedPhone" : "phone"] = values.phoneColumn;
    if (values.adUserData) mapping.adUserData = values.adUserData;
    if (values.adPersonalization) mapping.adPersonalization = values.adPersonalization;
    return ReverseSyncSetup.parse({
      name: values.name,
      modelId: values.modelId,
      destinationId: values.destinationId,
      audience:
        values.audienceKind === "existing"
          ? {
              kind: "existing",
              audienceId: values.audienceId,
              ...(values.mirrorStrategy === "full-replace"
                ? {
                    mirrorStrategy: "full-replace",
                    exclusiveManagementConfirmed: values.exclusive,
                  }
                : {}),
            }
          : {
              kind: "managed",
              displayName: values.displayName,
              exclusiveManagementConfirmed: values.exclusive,
              ...(values.mirrorStrategy === "full-replace" ? { mirrorStrategy: "full-replace" } : {}),
            },
      customerMatchTermsAccepted: values.terms,
      mapping,
      schedule: values.schedule,
      timezone: values.timezone,
    });
  };
  const inspect = async () => {
    if (!model) return;
    const current = ++version.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = PreviewResult.parse(
        await rpc(`/api/${workspace.id}/models/preview`, {
          method: "POST",
          body: { warehouseId: model.warehouseId, query: model.query },
        })
      );
      if (version.current === current) setPreview(result);
    } catch (e) {
      if (version.current === current) setError(e);
    } finally {
      if (version.current === current) setBusy(false);
    }
  };
  const validate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await form.validateFields();
      const result = await rpc(`/api/${workspace.id}/reverse-etl/validate`, { method: "POST", body: payload() });
      setValidated(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Retain the exact request across a lost response/reload. Never silently start another create.
      const key = `retl-create:${workspace.id}`;
      const saved = sessionStorage.getItem(key);
      if (!request.current && saved) {
        throw new Error(
          "A previous creation request is pending in this browser. Use Recover saved request to open that sync; the settings shown here have not been submitted."
        );
      }
      if (!request.current) request.current = { requestId: crypto.randomUUID(), setup: payload() };
      sessionStorage.setItem(key, JSON.stringify(request.current));
      setLocked(true);
      const { id } = await rpc(`/api/${workspace.id}/reverse-etl/syncs`, { method: "POST", body: request.current });
      sessionStorage.removeItem(key);
      setDirty(false);
      // Navigate to the durable object before asking Google to create anything.
      await router.replace(`/${workspace.slugOrId}/reverse-syncs?id=${id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    try {
      await form.validateFields();
      if (step === 0 && !model) throw new Error("Choose a model");
      if (step === 1 && (kind === "managed" || replacement) && (model?.cursor || model?.deleteColumn))
        throw new Error("Mirror requires a full-query model without a cursor or delete column");
      setError(undefined);
      setStep(step + 1);
    } catch (e) {
      setError(e);
    }
  };
  const discard = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const key = `retl-create:${workspace.id}`;
      const saved = sessionStorage.getItem(key);
      if (!saved) throw new Error("No pending creation request in this browser");
      const result = await rpc(`/api/${workspace.id}/reverse-etl/syncs`, {
        method: "DELETE",
        query: { requestId: JSON.parse(saved).requestId },
      });
      sessionStorage.removeItem(key);
      request.current = undefined;
      setLocked(false);
      setValidated(undefined);
      if (result.status === "saved") {
        setDirty(false);
        await router.replace(`/${workspace.slugOrId}/reverse-syncs?id=${result.id}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <EditorTitle
        title="New reverse sync"
        subtitle={<p className="text-textLight mb-6">Send a warehouse audience to Google Ads Customer Match.</p>}
        onBack={() => router.push(`/${workspace.slugOrId}/reverse-syncs`)}
      />
      <Steps
        size="small"
        current={step}
        className="mb-8"
        items={["Model & destination", "Audience & behavior", "Mapping & consent", "Schedule & review"].map(title => ({
          title,
        }))}
      />
      {readonly && <Alert type="warning" title="Creating syncs is unavailable for your current role or workspace." />}
      <Form
        form={form}
        layout="vertical"
        disabled={readonly || busy || locked}
        initialValues={{
          modelId: typeof router.query.modelId === "string" ? router.query.modelId : undefined,
          destinationId: typeof router.query.destinationId === "string" ? router.query.destinationId : undefined,
          audienceKind: "managed",
          mirrorStrategy: "snapshot-diff",
          emailFormat: "raw",
          phoneFormat: "raw",
          schedule: "0 0 * * *",
          timezone: "Etc/UTC",
        }}
        onValuesChange={changed => {
          setDirty(true);
          setValidated(undefined);
          if ("audienceKind" in changed)
            form.setFieldsValue({
              mirrorStrategy: changed.audienceKind === "managed" ? "snapshot-diff" : "upsert",
              exclusive: false,
            });
          if ("mirrorStrategy" in changed) form.setFieldsValue({ exclusive: false });
          if ("modelId" in changed) {
            version.current++;
            setPreview(undefined);
            form.setFieldsValue({
              emailColumn: undefined,
              phoneColumn: undefined,
              adUserData: undefined,
              adPersonalization: undefined,
            });
          }
        }}
      >
        {step === 0 && (
          <Panel
            title="Connect a model to a destination"
            description="Each destination has its own sync, schedule and saved state."
          >
            <Form.Item name="name" label="Sync name" rules={[{ required: true, whitespace: true }]}>
              <Input placeholder="High-value customers → Google Ads" maxLength={200} />
            </Form.Item>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Form.Item name="modelId" label="Source model" rules={[{ required: true }]}>
                <Select
                  placeholder="Choose a model"
                  options={models.data?.map(m => ({ value: m.id, label: m.name }))}
                />
              </Form.Item>
              <Form.Item name="destinationId" label="Google Ads destination" rules={[{ required: true }]}>
                <Select
                  placeholder="Choose a destination"
                  options={destinations.map(d => ({ value: d.id, label: d.name, disabled: !d.authorized }))}
                />
              </Form.Item>
            </div>
            {model && (
              <p className="text-textLight">
                <Tag>{model.cursor ? "Incremental" : "Full query"}</Tag>Primary key:{" "}
                <code>{model.primaryKey.join(", ")}</code>
              </p>
            )}
            {destination && (
              <p className="text-textLight">
                Customer account: <code>{String(destination.customerId || "Not configured")}</code>
              </p>
            )}
            <div className="flex gap-5 mt-4">
              <Link href={`/${workspace.slugOrId}/models?id=new`}>Create a model</Link>
              <Link href={`/${workspace.slugOrId}/destinations`}>Connect Google Ads</Link>
            </div>
            <Failure error={models.error} />
          </Panel>
        )}
        {step === 1 && (
          <Panel title="Choose how to manage your audience">
            <Form.Item name="audienceKind" label="Audience ownership">
              <Radio.Group className="flex flex-col gap-4">
                <Radio value="managed">
                  <strong>New Jitsu-managed audience</strong>
                  <div className="text-textLight ml-6">
                    Mirror the full model. Add new members and remove members that leave it.
                  </div>
                </Radio>
                <Radio value="existing">
                  <strong>Existing Google audience</strong>
                  <div className="text-textLight ml-6">
                    Add/remove members, or explicitly take over the entire audience with full replacement.
                  </div>
                </Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="mirrorStrategy" label="Sync behavior">
              <Radio.Group className="flex flex-col gap-3">
                {kind === "managed" ? (
                  <Radio value="snapshot-diff">
                    Mirror · snapshot diff — upload changes and remove missing members
                  </Radio>
                ) : (
                  <Radio value="upsert">Additions / explicit removals — preserve other audience members</Radio>
                )}
                <Radio value="full-replace">Mirror · full replacement — upload the entire model every run</Radio>
              </Radio.Group>
            </Form.Item>
            {replacement && (
              <Alert
                type="warning"
                showIcon
                className="mb-5"
                title="Full audience replacement"
                description="Every unique model member is uploaded, including unchanged members. After Google accepts every upload, Jitsu removes older members not refreshed by this run. This is asynchronous, not an atomic swap. An empty model clears the audience. Do not allow other tools or users to upload to this audience."
              />
            )}
            {kind === "managed" ? (
              <>
                <Form.Item name="displayName" label="New audience name" rules={[{ required: true, whitespace: true }]}>
                  <Input maxLength={120} />
                </Form.Item>
                <Alert
                  type="info"
                  showIcon
                  title={
                    replacement ? "540-day membership · full refresh every run" : "540-day membership · 30-day refresh"
                  }
                  description={
                    replacement
                      ? "All members are refreshed every run. A unique Jitsu suffix is added to the audience name."
                      : "Jitsu refreshes unchanged members during normal syncs after 30 days. A unique Jitsu suffix is added to the audience name."
                  }
                  className="mb-5"
                />
                <Form.Item
                  name="exclusive"
                  valuePropName="checked"
                  rules={[
                    {
                      validator: (_, v) =>
                        v ? Promise.resolve() : Promise.reject(new Error("Confirm exclusive management")),
                    },
                  ]}
                >
                  <Checkbox>
                    I will let Jitsu exclusively manage this audience and will not upload members outside Jitsu.
                  </Checkbox>
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item
                  name="audienceId"
                  label="Existing audience ID"
                  rules={[
                    { required: true, pattern: /^[1-9]\d{0,19}$/, message: "Enter a numeric Google audience ID" },
                  ]}
                >
                  <Input placeholder="123456789" />
                </Form.Item>
                {!replacement && (
                  <Alert
                    type="info"
                    title="Additions and explicit removals only"
                    description={
                      model?.deleteColumn
                        ? `Rows marked in “${model.deleteColumn}” will be removed. This does not replace the audience.`
                        : "This model has no delete column, so this sync only adds members. Use a model with a delete column for explicit removals."
                    }
                  />
                )}
                {replacement && (
                  <Form.Item
                    name="exclusive"
                    valuePropName="checked"
                    rules={[
                      {
                        validator: (_, value) =>
                          value
                            ? Promise.resolve()
                            : Promise.reject(new Error("Confirm exclusive management and audience replacement")),
                      },
                    ]}
                  >
                    <Checkbox>
                      I authorize Jitsu to replace all members of this existing audience, including members uploaded
                      outside Jitsu, and will disable other writers.
                    </Checkbox>
                  </Form.Item>
                )}
              </>
            )}
            <Form.Item
              name="terms"
              valuePropName="checked"
              className="mt-5"
              rules={[
                {
                  validator: (_, v) =>
                    v ? Promise.resolve() : Promise.reject(new Error("Confirm Customer Match terms")),
                },
              ]}
            >
              <Checkbox>
                I confirm that Customer Match terms are accepted for this Google Ads account and I am authorized to use
                this first-party data.
              </Checkbox>
            </Form.Item>
          </Panel>
        )}
        {step === 2 && (
          <>
            <Panel
              title="Map identifiers"
              description="Map email, phone or both. Raw values are normalized and SHA-256 hashed by the adapter; pre-hashed values are not hashed again."
            >
              <Button onClick={inspect} loading={busy}>
                Load model columns
              </Button>
              {preview && (
                <p className="mt-3 text-textLight">
                  {preview.columns.length} columns found · {preview.rows.length} sample rows
                </p>
              )}
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <Form.Item name="emailColumn" label="Email column">
                  <Select allowClear options={columns} placeholder="Not mapped" />
                </Form.Item>
                <Form.Item name="emailFormat" label="Email input format">
                  <Select
                    options={[
                      { value: "raw", label: "Raw email" },
                      { value: "hashed", label: "SHA-256 hash" },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="phoneColumn" label="Phone column">
                  <Select allowClear options={columns} placeholder="Not mapped" />
                </Form.Item>
                <Form.Item name="phoneFormat" label="Phone input format">
                  <Select
                    options={[
                      { value: "raw", label: "Raw E.164 phone (+country code)" },
                      { value: "hashed", label: "SHA-256 hash" },
                    ]}
                  />
                </Form.Item>
              </div>
            </Panel>
            <Panel
              title="Map consent"
              description="Consent mappings are optional. Each unmapped field is sent to Google as GRANTED for all additions. Map columns to use source consent values; mapped values must be GRANTED. Removals need only identifiers."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <Form.Item name="adUserData" label="Ad user data consent">
                  <Select allowClear options={columns} placeholder="Not mapped — assume GRANTED" />
                </Form.Item>
                <Form.Item name="adPersonalization" label="Ad personalization consent">
                  <Select allowClear options={columns} placeholder="Not mapped — assume GRANTED" />
                </Form.Item>
              </div>
              <Alert
                type="warning"
                title="Permanent row errors fail the run immediately"
                description="Filter non-consenting records in your model. Previously accepted changes are preserved; no rows are silently skipped."
              />
            </Panel>
          </>
        )}
        {step === 3 && (
          <>
            <Panel title="Schedule" description="Syncctl manages scheduled runs with Kubernetes CronJobs.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <Form.Item name="schedule" label="Schedule">
                  <ScheduleEditor />
                </Form.Item>
                <Form.Item name="timezone" label="Timezone">
                  <Input placeholder="Etc/UTC" />
                </Form.Item>
              </div>
            </Panel>
            <Panel
              title="Review your sync"
              description="Saving creates a disabled sync. Audience provisioning and enablement are explicit steps on the next screen."
            >
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: "model", label: "Model", children: model?.name },
                  { key: "dest", label: "Destination", children: destination?.name },
                  {
                    key: "mode",
                    label: "Behavior",
                    children: replacement
                      ? "Mirror · full replacement of the entire audience"
                      : kind === "managed"
                      ? "Mirror · new managed audience"
                      : "Additions / explicit removals · existing audience",
                  },
                  { key: "errors", label: "Row errors", children: "Fail immediately; preserve accepted changes" },
                ]}
              />
              <Button className="mt-5" onClick={validate} loading={busy}>
                Validate mapping & audience access
              </Button>
              {validated && (
                <Alert
                  className="mt-4"
                  type="success"
                  showIcon
                  title={`Validated ${validated.sampleRows} sample rows`}
                  description={`${
                    validated.audienceName ? `Audience: ${validated.audienceName}. ` : ""
                  }No audience members were written. Remaining rows are validated during the run.`}
                />
              )}
            </Panel>
          </>
        )}
      </Form>
      <Failure error={error} />
      {locked && (
        <Alert
          type="info"
          className="mb-4"
          title="Creation request saved"
          description="Retry uses the same settings and request ID. Discard unsaved request lets you correct rejected settings. If it was already saved, this opens the saved sync instead; no sync or Google audience is deleted."
        />
      )}
      <div className="flex flex-wrap justify-between gap-3 border-t border-textDisabled pt-5">
        <Button disabled={busy || locked || step === 0} onClick={() => setStep(step - 1)}>
          Previous
        </Button>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || !role.editEntities || !!maintenance} onClick={discard}>
            Discard unsaved request
          </Button>
          <Button
            disabled={busy || readonly}
            onClick={async () => {
              const saved = sessionStorage.getItem(`retl-create:${workspace.id}`);
              if (!saved) {
                setError(new Error("No pending creation request in this browser"));
                return;
              }
              request.current = JSON.parse(saved);
              await create();
            }}
          >
            Recover saved request
          </Button>
          {step < 3 ? (
            <Button type="primary" disabled={readonly || busy || locked} onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="primary" loading={busy} disabled={readonly || (!validated && !locked)} onClick={create}>
              {locked ? "Retry saved request" : "Save disabled sync"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
