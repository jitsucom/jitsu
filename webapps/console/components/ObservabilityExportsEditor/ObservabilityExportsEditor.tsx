import { Alert, Button, Input, Skeleton, Switch } from "antd";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { useState } from "react";
import { ObservabilityExportsSettings } from "../../lib/shared/observability-exports";
import { rpc } from "juava";
import { CheckOutlined, DeleteOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import { ConfigSection } from "../DataRentionEditor/DataRentionEditor";

type TestResult = { ok: boolean; status?: number; response?: string; error?: string };

export const ObservabilityExportsEditorLoader: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const settings = useQuery(
    ["observability-exports", workspace.id],
    () => get(`/api/workspace/${workspace.id}/observability-exports`),
    { retry: false, cacheTime: 0, refetchOnWindowFocus: false }
  );
  return (
    <div>
      {settings.isLoading && <Skeleton active={true} />}
      {settings.isError && <ErrorCard error={settings.error} />}
      {settings.data && <ObservabilityExportsEditor obj={ObservabilityExportsSettings.parse(settings.data)} />}
    </div>
  );
};

export const ObservabilityExportsEditor: React.FC<{ obj: ObservabilityExportsSettings }> = ({ obj }) => {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const readonly = !role.editEntities;
  const [settings, setSettings] = useState<ObservabilityExportsSettings>(obj);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | undefined>(undefined);

  const setHeader = (index: number, patch: Partial<{ name: string; value: string }>) => {
    setSettings(s => ({
      ...s,
      headers: s.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      {readonly && (
        <Alert message="You don't have permission to change observability exports settings" type="info" showIcon />
      )}
      <ConfigSection
        title="Enabled"
        documentation={
          <>
            Export Live Events to your observability backend as OpenTelemetry logs. Turning this off stops new exports.
            Live Events inside Jitsu are unaffected.
          </>
        }
      >
        <div className="flex items-center gap-2">
          <Switch
            id="observabilityExportsEnabled"
            checked={settings.enabled}
            disabled={readonly || saving}
            onChange={enabled => setSettings(s => ({ ...s, enabled }))}
          />
          <label htmlFor="observabilityExportsEnabled">{settings.enabled ? "Enabled" : "Disabled"}</label>
        </div>
      </ConfigSection>
      <ConfigSection
        title="OTLP logs endpoint"
        documentation={
          <>
            HTTPS URL of your OTLP/HTTP endpoint, including the logs path — usually <code>/v1/logs</code>. For Datadog,
            use your site's OTLP intake, for example <code>https://otlp.datadoghq.com/v1/logs</code> for US1.
          </>
        }
      >
        <Input
          placeholder="https://otlp.datadoghq.com/v1/logs"
          value={settings.endpoint}
          disabled={readonly || saving}
          onChange={e => setSettings(s => ({ ...s, endpoint: e.target.value }))}
        />
      </ConfigSection>
      <ConfigSection
        title="Authentication headers"
        documentation={
          <>
            Headers sent with every export request. Use them for your backend's API key — for Datadog,{" "}
            <code>dd-api-key: &lt;your Datadog API key&gt;</code>. Values are hidden after saving and can only be
            replaced, not read back.
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {settings.headers.map((header, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                className="max-w-[20em]"
                placeholder="Header name"
                value={header.name}
                disabled={readonly || saving}
                onChange={e => setHeader(i, { name: e.target.value })}
              />
              <Input.Password
                placeholder="Header value"
                value={header.value}
                disabled={readonly || saving}
                onChange={e => setHeader(i, { value: e.target.value })}
              />
              <Button
                type="text"
                icon={<DeleteOutlined />}
                disabled={readonly || saving}
                onClick={() => setSettings(s => ({ ...s, headers: s.headers.filter((_, j) => j !== i) }))}
              />
            </div>
          ))}
          <div>
            <Button
              icon={<PlusOutlined />}
              disabled={readonly || saving}
              onClick={() => setSettings(s => ({ ...s, headers: [...s.headers, { name: "", value: "" }] }))}
            >
              Add header
            </Button>
          </div>
        </div>
      </ConfigSection>
      <ConfigSection
        title="Send test log"
        documentation={
          <>
            Sends one test log to your endpoint and shows the response, so you can verify the URL and credentials. Test
            logs are marked as tests and are never billed.
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <Button
              icon={<SendOutlined />}
              disabled={readonly || saving || testing || !settings.endpoint}
              loading={testing}
              onClick={async () => {
                setTesting(true);
                setTestResult(undefined);
                try {
                  const result = await rpc(`/api/workspace/${workspace.id}/observability-exports/test`, {
                    body: ObservabilityExportsSettings.parse(settings),
                  });
                  setTestResult(result);
                } catch (e: any) {
                  setTestResult({ ok: false, error: e.message });
                } finally {
                  setTesting(false);
                }
              }}
            >
              Send test log
            </Button>
          </div>
          {testResult && (
            <Alert
              type={testResult.ok ? "success" : "error"}
              showIcon
              message={
                testResult.ok
                  ? `Test log accepted (HTTP ${testResult.status})`
                  : testResult.status
                  ? `Endpoint returned HTTP ${testResult.status}`
                  : `Test failed: ${testResult.error}`
              }
              description={testResult.response ? <code className="break-all">{testResult.response}</code> : undefined}
            />
          )}
        </div>
      </ConfigSection>
      <div className="flex justify-end">
        <Button
          type="primary"
          size="large"
          icon={<CheckOutlined />}
          disabled={readonly || saving}
          loading={saving}
          onClick={async () => {
            const parsed = ObservabilityExportsSettings.safeParse(settings);
            if (!parsed.success) {
              feedbackError(parsed.error.issues[0]?.message || "Invalid settings");
              return;
            }
            setSaving(true);
            try {
              const saved = await rpc(`/api/workspace/${workspace.id}/observability-exports`, {
                method: "PUT",
                body: parsed.data,
              });
              setSettings(ObservabilityExportsSettings.parse(saved));
              feedbackSuccess("Observability exports settings saved");
            } catch (e: any) {
              feedbackError("Failed to save observability exports settings", { error: e });
            } finally {
              setSaving(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
};
