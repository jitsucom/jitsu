import React from "react";

export type DiffEntry = { field: string; description: string };

export type AuditLogDiffProps = {
  diff: DiffEntry[];
  title?: string;
};

/**
 * Renders the per-field change list for an audit-log entry.
 *
 * Visual model: outer card with header + summary, then a list of rows with
 * thin separators (no per-cell borders, no row hover, no header bar).
 * Field column is monospace; the change column wraps and fills remaining
 * width — works edge-to-edge inside any parent.
 */
export const AuditLogDiff: React.FC<AuditLogDiffProps> = ({ diff, title = "Changes" }) => {
  if (!diff || diff.length === 0) return null;
  const summary = `${diff.length} ${diff.length === 1 ? "field" : "fields"} changed`;
  return (
    <div className="w-full rounded-md border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
        <div className="text-sm font-semibold text-text">{title}</div>
        <div className="text-xs text-text-light">{summary}</div>
      </div>
      <div className="divide-y divide-neutral-100">
        {diff.map(d => (
          <div
            key={d.field}
            className="grid grid-cols-1 md:grid-cols-[minmax(160px,_28%)_1fr] gap-x-4 gap-y-1 px-4 py-2.5"
          >
            <div className="font-mono text-xs text-neutral-600 break-all">{d.field}</div>
            <div className="text-xs text-text break-all whitespace-pre-wrap">{d.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AuditLogDiff;
