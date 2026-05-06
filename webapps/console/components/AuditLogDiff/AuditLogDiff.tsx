import React from "react";
import { Tooltip } from "antd";
import { Plus, Minus, ArrowRight, KeyRound, MinusCircle } from "lucide-react";

export type DiffEntry = {
  field: string;
  kind: "added" | "removed" | "changed" | "secret-changed" | "noop";
  prev?: string;
  next?: string;
};

export type AuditLogDiffProps = {
  diff: DiffEntry[];
  title?: string;
  /** Character cap before middle-truncation kicks in. Default 100. */
  truncateAt?: number;
};

function middleTruncate(s: string, max: number): string {
  if (!s || s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

const ValueText: React.FC<{ value: string; truncateAt: number; className?: string }> = ({
  value,
  truncateAt,
  className,
}) => {
  const display = middleTruncate(value, truncateAt);
  const truncated = display !== value;
  const node = (
    <span className={`font-mono whitespace-nowrap ${truncated ? "cursor-help" : ""} ${className || ""}`}>
      {display}
    </span>
  );
  if (!truncated) return node;
  return (
    <Tooltip
      placement="topLeft"
      overlayStyle={{ maxWidth: 600 }}
      title={
        <div className="font-mono text-xs whitespace-pre-wrap break-all" style={{ maxWidth: 560 }}>
          {value}
        </div>
      }
    >
      {node}
    </Tooltip>
  );
};

const Icon: React.FC<{ kind: DiffEntry["kind"] }> = ({ kind }) => {
  const common = "w-3.5 h-3.5 shrink-0";
  switch (kind) {
    case "added":
      return (
        <Tooltip title="Added">
          <Plus className={`${common} text-emerald-600`} />
        </Tooltip>
      );
    case "removed":
      return (
        <Tooltip title="Removed">
          <Minus className={`${common} text-rose-600`} />
        </Tooltip>
      );
    case "changed":
      return (
        <Tooltip title="Changed">
          <ArrowRight className={`${common} text-amber-600`} />
        </Tooltip>
      );
    case "secret-changed":
      return (
        <Tooltip title="Secret value changed">
          <KeyRound className={`${common} text-amber-600`} />
        </Tooltip>
      );
    case "noop":
      return (
        <Tooltip title="No field-level changes">
          <MinusCircle className={`${common} text-neutral-400`} />
        </Tooltip>
      );
  }
};

const ChangeCell: React.FC<{ entry: DiffEntry; truncateAt: number }> = ({ entry, truncateAt }) => {
  switch (entry.kind) {
    case "added":
      return <ValueText value={entry.next || ""} truncateAt={truncateAt} className="text-emerald-700" />;
    case "removed":
      return <ValueText value={entry.prev || ""} truncateAt={truncateAt} className="text-rose-700 line-through" />;
    case "changed":
      return (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <ValueText value={entry.prev || ""} truncateAt={truncateAt} className="text-rose-700 line-through" />
          <ArrowRight className="w-3 h-3 shrink-0 text-neutral-400" />
          <ValueText value={entry.next || ""} truncateAt={truncateAt} className="text-emerald-700" />
        </span>
      );
    case "secret-changed":
      return <span className="text-text-light italic">secret value changed</span>;
    case "noop":
      return <span className="text-text-light italic">No field-level changes</span>;
  }
};

/**
 * Renders the per-field change list for an audit-log entry.
 *
 * Visual model: outer card with header + summary, then a list of rows with
 * thin separators (no per-cell borders, no row hover, no header bar). Each
 * row has a kind icon (+, −, →, key, no-change), a monospace field path,
 * and a change cell with middle-truncated values + tooltip.
 */
export const AuditLogDiff: React.FC<AuditLogDiffProps> = ({ diff, title = "Changes", truncateAt = 100 }) => {
  if (!diff || diff.length === 0) return null;
  const realCount = diff.filter(d => d.kind !== "noop").length;
  const summary =
    realCount === 0 ? "no field-level changes" : `${realCount} ${realCount === 1 ? "field" : "fields"} changed`;
  return (
    <div className="w-full rounded-md border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
        <div className="text-sm font-semibold text-text">{title}</div>
        <div className="text-xs text-text-light">{summary}</div>
      </div>
      <div className="divide-y divide-neutral-100">
        {diff.map((d, i) => (
          <div
            key={`${d.field}-${i}`}
            className="grid grid-cols-[20px_minmax(160px,_28%)_minmax(0,_1fr)] gap-x-3 items-center px-4 py-2"
          >
            <div className="flex items-center justify-center">
              <Icon kind={d.kind} />
            </div>
            <div className="font-mono text-xs text-neutral-600 break-all">{d.field}</div>
            <div className="text-xs text-text overflow-hidden">
              <ChangeCell entry={d} truncateAt={truncateAt} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AuditLogDiff;
