import { Button, Input, Skeleton, Switch } from "antd";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { useMemo, useState } from "react";
import { ObservabilityExportsSettings } from "../../lib/shared/observability-exports";
import { rpc } from "juava";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import { useBilling } from "../Billing/BillingProvider";
import { UpgradeDialog } from "../Billing/UpgradeDialog";
import { EditorField } from "../ConfigObjectEditor/EditorField";
import { EditorButtons } from "../ConfigObjectEditor/EditorButtons";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import { ConfigTestResult } from "../ConfigObjectEditor/ConfigEditor";
import { useRouter } from "next/router";

const planTiers = { free: 0, business: 1, enterprise: 2 } as const;
type OtlpExportPlan = keyof typeof planTiers;

// planId is an opaque string (Stripe product ids for self-service plans);
// tiers: free < business (any paid plan) < enterprise
function workspacePlanTier(settings: { planId?: string; planKind?: string }): number {
  if (settings.planId === "$admin") {
    return planTiers.enterprise;
  }
  if (settings.planKind === "enterprise" || settings.planId === "enterprise") {
    return planTiers.enterprise;
  }
  return settings.planId && settings.planId !== "free" ? planTiers.business : planTiers.free;
}

const upgradePlans: Record<OtlpExportPlan, string[]> = {
  free: [],
  business: ["paid", "enterprise"],
  enterprise: ["enterprise"],
};

export const ObservabilityExportsEditorLoader: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const billing = useBilling();
  const router = useRouter();
  const settings = useQuery(
    ["observability-exports", workspace.id],
    () => get(`/api/workspace/${workspace.id}/observability-exports`),
    { retry: false, cacheTime: 0, refetchOnWindowFocus: false }
  );
  const requiredPlan: OtlpExportPlan = appConfig.otlpExportBillingPlan || "free";
  // gate follows the Workspace Domains convention: applies only when billing is
  // enabled (self-hosted deployments have no plans to compare against)
  const planTooLow =
    !billing.loading && billing.enabled && workspacePlanTier(billing.settings) < planTiers[requiredPlan];
  return (
    <div className="flex justify-center">
      <div className="max-w-4xl grow">
        <EditorTitle title="Observability exports" onBack={() => router.push(`/${workspace.slugOrId}/settings`)} />
        {billing.loading || settings.isLoading ? (
          <Skeleton active={true} />
        ) : planTooLow ? (
          <UpgradeDialog featureDescription="Observability exports" availableInPlans={upgradePlans[requiredPlan]} />
        ) : settings.isError ? (
          <ErrorCard error={settings.error} />
        ) : settings.data ? (
          <ObservabilityExportsEditor obj={ObservabilityExportsSettings.parse(settings.data)} />
        ) : null}
      </div>
    </div>
  );
};

// field-level errors mapped from the zod issues, keyed like the ConfigEditor
function fieldErrors(settings: ObservabilityExportsSettings): Record<string, string> {
  const parsed = ObservabilityExportsSettings.safeParse(settings);
  if (parsed.success) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

export const ObservabilityExportsEditor: React.FC<{ obj: ObservabilityExportsSettings }> = ({ obj }) => {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const readonly = !role.editEntities;
  const [original, setOriginal] = useState<ObservabilityExportsSettings>(obj);
  const [settings, setSettings] = useState<ObservabilityExportsSettings>(obj);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const isTouched = useMemo(() => JSON.stringify(settings) !== JSON.stringify(original), [settings, original]);
  const errors = useMemo(() => fieldErrors(settings), [settings]);
  const hasErrors = Object.keys(errors).length > 0;
  const displayErrors = showErrors ? errors : {};

  const setHeader = (index: number, patch: Partial<{ name: string; value: string }>) => {
    setSettings(s => ({
      ...s,
      headers: s.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }));
  };

  const onSave = async () => {
    setShowErrors(true);
    if (hasErrors) {
      feedbackError(Object.values(errors)[0]);
      return;
    }
    setSaving(true);
    try {
      const saved = await rpc(`/api/workspace/${workspace.id}/observability-exports`, {
        method: "PUT",
        body: ObservabilityExportsSettings.parse(settings),
      });
      const parsed = ObservabilityExportsSettings.parse(saved);
      setOriginal(parsed);
      setSettings(parsed);
      setShowErrors(false);
      feedbackSuccess("Observability exports settings saved");
    } catch (e: any) {
      feedbackError("Failed to save observability exports settings", { error: e });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (): Promise<ConfigTestResult> => {
    setShowErrors(true);
    if (hasErrors) {
      return { ok: false, error: Object.values(errors)[0] };
    }
    if (!settings.endpoint) {
      return { ok: false, error: "OTLP logs endpoint is not configured" };
    }
    setTesting(true);
    try {
      const result = await rpc(`/api/workspace/${workspace.id}/observability-exports/test`, {
        body: ObservabilityExportsSettings.parse(settings),
      });
      if (result.ok) {
        return { ok: true };
      }
      return {
        ok: false,
        error: result.status
          ? `Endpoint returned HTTP ${result.status}${result.response ? `: ${result.response}` : ""}`
          : result.error || "unknown error",
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <EditorField
        id="enabled"
        label="Enabled"
        help={
          <>
            Export Live Events to your observability backend as OpenTelemetry logs. Turning this off stops new exports.
            Live Events inside Jitsu are unaffected.
          </>
        }
      >
        <Switch
          id="enabled"
          checked={settings.enabled}
          disabled={readonly || saving}
          onChange={enabled => setSettings(s => ({ ...s, enabled }))}
        />
      </EditorField>
      <EditorField
        id="endpoint"
        label="OTLP logs endpoint"
        required={settings.enabled}
        errors={displayErrors["endpoint"]}
        help={
          <>
            HTTPS URL of your OTLP/HTTP endpoint, including the logs path — usually <code>/v1/logs</code>. For Datadog,
            use your site's OTLP intake, for example <code>https://otlp.datadoghq.com/v1/logs</code> for US1.
          </>
        }
      >
        <Input
          id="endpoint"
          placeholder="https://otlp.datadoghq.com/v1/logs"
          value={settings.endpoint}
          disabled={readonly || saving}
          onChange={e => setSettings(s => ({ ...s, endpoint: e.target.value }))}
        />
      </EditorField>
      <EditorField
        id="headers"
        label="Authentication headers"
        errors={displayErrors["headers"]}
        help={
          <>
            Headers sent with every export request. Use them for your backend's API key — for Datadog,{" "}
            <code>dd-api-key: &lt;your Datadog API key&gt;</code>. Values are hidden after saving and can only be
            replaced, not read back. The <b>Send test log</b> button below sends one test log to your endpoint and shows
            the response, so you can verify the URL and credentials. Test logs are marked as tests and are never billed.
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
      </EditorField>
      <EditorButtons
        isNew={true}
        loading={saving}
        testing={testing}
        onDelete={() => {}}
        onTest={readonly ? undefined : onTest}
        testButtonLabel="Send test log"
        onCancel={() => {
          setSettings(original);
          setShowErrors(false);
        }}
        onSave={onSave}
        isTouched={isTouched}
        hasErrors={showErrors && hasErrors}
      />
    </div>
  );
};
