import React, { useRef, useState } from "react";
import { Alert, Button, Modal, Progress, Radio } from "antd";
import { DatabaseOutlined } from "@ant-design/icons";
import { useAuth } from "./AuthProvider";

type Mode = "incremental" | "full";
type Phase = "idle" | "running" | "done" | "error";

/** One line of newline-delimited JSON streamed by `/api/admin/sync-cache`. */
type ProgressEvent =
  | { type: "start"; total: number }
  | { type: "period"; index: number; total: number; start: string; rows: number; ms: number }
  | { type: "done"; total: number; ms: number }
  | { type: "error"; message: string };

function formatPeriod(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Header control that refreshes `newjitsuee.stat_cache` on demand. Opens a modal
 * to pick the scope (current month or a full 12-month rebuild) and renders live
 * progress streamed from `/api/admin/sync-cache`.
 */
export const UpdateStatCacheButton: React.FC = () => {
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("incremental");
  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetState = () => {
    setPhase("idle");
    setTotal(0);
    setCompleted(0);
    setLogLines([]);
    setError(null);
  };

  const openModal = () => {
    resetState();
    setMode("incremental");
    setOpen(true);
  };

  const closeModal = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
  };

  const handleEvent = (event: ProgressEvent) => {
    switch (event.type) {
      case "start":
        setTotal(event.total);
        break;
      case "period":
        setCompleted(event.index + 1);
        setLogLines(lines => [
          ...lines,
          `${formatPeriod(event.start)} — ${event.rows} rows (${(event.ms / 1000).toFixed(1)}s)`,
        ]);
        break;
      case "done":
        setPhase("done");
        break;
      case "error":
        setError(event.message);
        setPhase("error");
        break;
    }
  };

  const run = async () => {
    resetState();
    setPhase("running");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await authFetch(`/api/admin/sync-cache?full=${mode === "full"}`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        let message = `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body?.error) {
            message = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
          }
        } catch {
          // keep the HTTP status as the message
        }
        throw new Error(message);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminal = false;
      const handle = (event: ProgressEvent) => {
        if (event.type === "done" || event.type === "error") {
          sawTerminal = true;
        }
        handleEvent(event);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            handle(JSON.parse(line) as ProgressEvent);
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        handle(JSON.parse(tail) as ProgressEvent);
      }
      // A finished refresh always ends with a `done` (or `error`) event. A stream
      // that closes while still running means the server was cut off mid-run
      // (e.g. a platform timeout) — surface it as a failure, not a false success.
      if (!sawTerminal) {
        setError("The update stopped before it finished — the cache may be partially updated.");
        setPhase("error");
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return;
      }
      setError(e?.message || "Failed to update stat cache");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  };

  const running = phase === "running";
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const footer =
    phase === "idle"
      ? [
          <Button key="cancel" onClick={closeModal}>
            Cancel
          </Button>,
          <Button key="start" type="primary" onClick={run}>
            Start update
          </Button>,
        ]
      : phase === "running"
      ? [
          <Button key="cancel" onClick={closeModal}>
            Cancel
          </Button>,
        ]
      : phase === "error"
      ? [
          <Button key="close" onClick={closeModal}>
            Close
          </Button>,
          <Button key="retry" type="primary" onClick={run}>
            Retry
          </Button>,
        ]
      : [
          <Button key="close" type="primary" onClick={closeModal}>
            Close
          </Button>,
        ];

  return (
    <>
      <Button size="small" icon={<DatabaseOutlined />} onClick={openModal}>
        Update stat cache
      </Button>
      <Modal
        title="Update stat cache"
        open={open}
        onCancel={closeModal}
        footer={footer}
        maskClosable={!running}
        keyboard={!running}
      >
        {phase === "idle" ? (
          <div className="flex flex-col gap-3 py-1">
            <p className="text-sm text-neutral-500">
              Refreshes <code>stat_cache</code> from ClickHouse. The hourly cron keeps the current month up to date —
              run a full rebuild after a gap or for a first-time backfill.
            </p>
            <Radio.Group value={mode} onChange={e => setMode(e.target.value)}>
              <div className="flex flex-col gap-2">
                <Radio value="incremental">
                  <span className="font-medium">Current month</span>
                  <span className="text-neutral-400"> — fast, refreshes the latest period</span>
                </Radio>
                <Radio value="full">
                  <span className="font-medium">Full rebuild</span>
                  <span className="text-neutral-400"> — last 12 months, slower</span>
                </Radio>
              </div>
            </Radio.Group>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-1">
            <Progress
              percent={percent}
              status={phase === "error" ? "exception" : phase === "done" ? "success" : "active"}
            />
            <div className="text-sm text-neutral-500">
              {phase === "done"
                ? `Done — ${total} period(s) updated.`
                : phase === "error"
                ? "Update failed."
                : total > 0
                ? `Updating period ${Math.min(completed + 1, total)} of ${total}…`
                : "Starting…"}
            </div>
            {logLines.length > 0 && (
              <div className="flex max-h-48 flex-col gap-0.5 overflow-auto rounded-md bg-neutral-50 p-3 font-mono text-xs text-neutral-600">
                {logLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            {error && <Alert type="error" showIcon message="Update failed" description={error} />}
          </div>
        )}
      </Modal>
    </>
  );
};
