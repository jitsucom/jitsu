import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Input, Steps, Upload } from "antd";
import { ArrowLeft, FileJson, Loader2, PlayCircle, UploadCloud, Waypoints } from "lucide-react";
import { rpc } from "juava";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { feedbackError } from "../../lib/ui";
import { ErrorCard } from "../GlobalError/GlobalError";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import segmentIcon from "../../lib/schema/icons/segment";
import { MigrationProvider, MigrationReport } from "./types";
import { MigrationReportView } from "./MigrationReportView";
import { AnalysisProgress } from "./AnalysisProgress";

/**
 * Migration analyzer wizard (JITSU-131, backend JITSU-128): connect a
 * Segment / RudderStack workspace (or upload an OSS workspaceConfig.json),
 * watch the analysis progress, and view the migration report with per-item
 * verdicts and the savings estimate. All heavy lifting happens in ee-api
 * (`/api/migration/*`); the provider token passes through the browser to
 * ee-api and is never stored anywhere.
 */

const PROVIDERS: { id: MigrationProvider; title: string; icon: React.ReactNode; description: string }[] = [
  {
    id: "segment",
    title: "Segment",
    icon: segmentIcon,
    description: "Connect with a Public API token. Requires Workspace Owner access (Team or Business plan).",
  },
  {
    id: "rudderstack",
    title: "RudderStack Cloud",
    icon: <Waypoints className="w-full h-full text-blue-500" />,
    description: "Connect with a workspace Service Access Token — read-only by default.",
  },
  {
    id: "rudderstack-oss",
    title: "RudderStack Open-source",
    icon: <FileJson className="w-full h-full text-blue-500" />,
    description: "Self-hosted RudderStack has no API for us to read — upload your workspaceConfig.json instead.",
  },
];

const TOKEN_HELP: Record<string, React.ReactNode> = {
  segment: (
    <>
      Create a token in Segment under <b>Settings → Workspace settings → Access Management → Tokens</b> with{" "}
      <b>Workspace Owner</b> scope (Segment has no read-only scope; only Workspace Owners see the Tokens tab). We use it
      once, in memory, to read your workspace config — it is never stored or logged.
    </>
  ),
  rudderstack: (
    <>
      Create a token in RudderStack under <b>Settings → Access Management → Service access tokens</b> (workspace tokens
      are read-only by default). We use it once, in memory, to read your workspace config — it is never stored or
      logged.
    </>
  ),
};

export const ImportWizard: React.FC = () => {
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const router = useRouter();
  // Wizard position lives in the URL query and is read straight from the
  // router, so browser back/forward moves between steps (a local-state copy —
  // e.g. useQueryStringState — would not see popstate navigation).
  // Unknown ?provider= values (hand-edited URLs) fall back to the picker step.
  const provider =
    typeof router.query.provider === "string" && PROVIDERS.some(p => p.id === router.query.provider)
      ? router.query.provider
      : undefined;
  const reportId = typeof router.query.reportId === "string" ? router.query.reportId : undefined;
  const updateQuery = useCallback(
    async (patch: Record<string, string | undefined>) => {
      const query: Record<string, any> = { ...router.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
          delete query[k];
        } else {
          query[k] = v;
        }
      }
      await router.push({ query }, undefined, { shallow: true });
    },
    [router]
  );
  const setProvider = useCallback((p: string | undefined) => updateQuery({ provider: p }), [updateQuery]);
  const setReportId = useCallback((id: string | undefined) => updateQuery({ reportId: id }), [updateQuery]);
  const [token, setToken] = useState("");
  const [workspaceConfig, setWorkspaceConfig] = useState<{ name: string; content: string } | undefined>();
  const [starting, setStarting] = useState(false);
  const [report, setReport] = useState<MigrationReport | undefined>();
  const [reportError, setReportError] = useState<any>(undefined);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>();

  const fetchReport = useCallback(async () => {
    if (!reportId) {
      return;
    }
    try {
      // Report requests go through console's proxy (auth + IP rate limits) —
      // the browser never talks to ee-api directly for the migration wizard.
      const r = await rpc(`/api/migration/report`, { query: { workspaceId: workspace.id, id: reportId } });
      setReport(r);
      setReportError(undefined);
    } catch (e) {
      setReportError(e);
    }
  }, [reportId, workspace.id]);

  // Poll while the analysis is running; stop on any terminal status.
  useEffect(() => {
    if (!reportId) {
      setReport(undefined);
      return;
    }
    fetchReport();
    pollTimer.current = setInterval(fetchReport, 2500);
    return () => clearInterval(pollTimer.current);
  }, [reportId, fetchReport]);
  useEffect(() => {
    if (report && report.status !== "fetching" && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = undefined;
    }
  }, [report]);

  // Statically-optimized pages hydrate with an empty router.query — wait for
  // the real query so a shared/refreshed report URL doesn't flash step 0.
  if (!router.isReady) {
    return null;
  }
  // Route-level flag enforcement: hidden menu entries are not a gate — direct
  // navigation to /{workspace}/import must respect the kill switch too.
  if (!appConfig.ee?.available || !appConfig.migrationWizardEnabled) {
    return (
      <ErrorCard
        title="Not available"
        hideActions={true}
        error={{ message: "The migration analyzer is not enabled on this deployment" }}
      />
    );
  }

  const startAnalysis = async () => {
    setStarting(true);
    try {
      const { reportId: newId } = await rpc(`/api/migration/analyze`, {
        query: { workspaceId: workspace.id },
        body: {
          provider,
          // trim: pasted tokens routinely carry trailing whitespace/newlines
          ...(provider === "rudderstack-oss" ? { workspaceConfig: workspaceConfig?.content } : { token: token.trim() }),
        },
      });
      // Token leaves the page state as soon as ee-api has it.
      setToken("");
      setWorkspaceConfig(undefined);
      setReport(undefined);
      await setReportId(newId);
    } catch (e) {
      feedbackError("Failed to start the analysis", { error: e });
    } finally {
      setStarting(false);
    }
  };

  const startOver = async () => {
    setReport(undefined);
    setReportError(undefined);
    // Fully back to step 0: drop the sensitive inputs too, so a token or
    // uploaded config can't linger in memory and be reused accidentally.
    setToken("");
    setWorkspaceConfig(undefined);
    setStarting(false);
    await updateQuery({ provider: undefined, reportId: undefined });
  };

  const step = !reportId ? (provider ? 1 : 0) : !report || report.status === "fetching" ? 2 : 3;
  const canStart =
    !!provider && (provider === "rudderstack-oss" ? !!workspaceConfig : token.trim().length > 0) && !starting;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-4xl">Import from Segment / RudderStack</h1>
        {step > 0 && (
          <JitsuButton icon={<ArrowLeft className="w-4 h-4" />} onClick={startOver}>
            Start over
          </JitsuButton>
        )}
      </div>
      <div className="text pb-6 text-textLight">
        Connect your current provider and get a migration report: what moves to Jitsu automatically, what needs a small
        change, and how much you could save. Nothing is created or changed in either workspace.
      </div>
      <Steps
        current={step}
        className="mb-8"
        items={[{ title: "Provider" }, { title: "Connect" }, { title: "Analysis" }, { title: "Report" }]}
      />
      {step === 0 && (
        // py-3: the hover scale effect grows cards ~5px past their box — keep
        // that inside preallocated space so the page doesn't grow a scrollbar.
        <div className="flex flex-wrap gap-4 py-3">
          {PROVIDERS.map(p => (
            <div
              key={p.id}
              onClick={() => setProvider(p.id)}
              className="w-72 border border-neutral-200 rounded-lg px-4 py-5 cursor-pointer hover:border-primary hover:scale-105 transition-transform bg-backgroundLight"
            >
              <div className="w-10 h-10 mb-3">{p.icon}</div>
              <div className="text-lg font-semibold pb-2">{p.title}</div>
              <div className="text-textLight text-sm">{p.description}</div>
            </div>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="max-w-2xl">
          <div className="text-lg font-semibold pb-2">{PROVIDERS.find(p => p.id === provider)?.title ?? provider}</div>
          {provider === "rudderstack-oss" ? (
            <>
              <div className="text pb-4 text-textLight">
                Export your config from the control plane (or grab the <code>workspaceConfig.json</code> your
                rudder-server uses) and upload it here. The file is analyzed in memory and never stored.
              </div>
              <Upload.Dragger
                accept="application/json,.json"
                maxCount={1}
                beforeUpload={async file => {
                  setWorkspaceConfig({ name: file.name, content: await file.text() });
                  return false;
                }}
                onRemove={() => setWorkspaceConfig(undefined)}
              >
                <div className="flex flex-col items-center py-4">
                  <UploadCloud className="w-8 h-8 mb-2 text-textLight" />
                  <div>Click or drag workspaceConfig.json here</div>
                  {workspaceConfig && <div className="text-textLight pt-2">{workspaceConfig.name}</div>}
                </div>
              </Upload.Dragger>
            </>
          ) : (
            <>
              <div className="text pb-4 text-textLight">{TOKEN_HELP[provider ?? ""]}</div>
              <Input.Password
                placeholder="Paste the API token"
                value={token}
                size="large"
                onChange={e => setToken(e.target.value)}
                onPressEnter={() => canStart && startAnalysis()}
              />
            </>
          )}
          <div className="pt-6">
            <JitsuButton
              type="primary"
              size="large"
              icon={starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              disabled={!canStart}
              onClick={startAnalysis}
            >
              Analyze workspace
            </JitsuButton>
          </div>
        </div>
      )}
      {step === 2 &&
        (reportError && !report ? (
          <ErrorCard title="Failed to load the report" error={reportError} hideActions={true}>
            {String(reportError?.message ?? reportError)}
          </ErrorCard>
        ) : (
          <AnalysisProgress report={report} />
        ))}
      {step === 3 && report && <MigrationReportView report={report} refresh={fetchReport} onStartOver={startOver} />}
    </div>
  );
};
