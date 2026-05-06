import React from "react";
import { Tooltip } from "antd";

export type DiffEntry = { field: string; description: string };

export type AuditLogDiffProps = {
  diff: DiffEntry[];
  title?: string;
  /** Character cap before middle-truncation kicks in. Default 100. */
  truncateAt?: number;
};

/**
 * Truncate a string in the middle, preserving the start and the tail. Useful
 * for long IDs / hashes / JSON blobs where the end is just as informative as
 * the beginning. Returns the original string if it's shorter than `max`.
 */
function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve one char for the ellipsis. Bias slightly toward the head.
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/**
 * Renders the per-field change list for an audit-log entry.
 *
 * Visual model: outer card with header + summary, then a list of rows with
 * thin separators (no per-cell borders, no row hover, no header bar).
 * Field column is monospace; the change column middle-truncates long values
 * and surfaces the full text in a tooltip on hover.
 */
export const AuditLogDiff: React.FC<AuditLogDiffProps> = ({ diff, title = "Changes", truncateAt = 100 }) => {
  if (!diff || diff.length === 0) return null;
  const summary = `${diff.length} ${diff.length === 1 ? "field" : "fields"} changed`;
  return (
    <div className="w-full rounded-md border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
        <div className="text-sm font-semibold text-text">{title}</div>
        <div className="text-xs text-text-light">{summary}</div>
      </div>
      <div className="divide-y divide-neutral-100">
        {diff.map(d => {
          const display = middleTruncate(d.description, truncateAt);
          const truncated = display !== d.description;
          const valueNode = (
            <div className={`text-xs text-text whitespace-nowrap overflow-hidden ${truncated ? "cursor-help" : ""}`}>
              {display}
            </div>
          );
          return (
            <div
              key={d.field}
              className="grid grid-cols-1 md:grid-cols-[minmax(160px,_28%)_minmax(0,_1fr)] gap-x-4 gap-y-1 px-4 py-2.5"
            >
              <div className="font-mono text-xs text-neutral-600 break-all">{d.field}</div>
              {truncated ? (
                <Tooltip
                  title={
                    <div className="font-mono text-xs whitespace-pre-wrap break-all" style={{ maxWidth: 560 }}>
                      {d.description}
                    </div>
                  }
                  placement="topLeft"
                  overlayStyle={{ maxWidth: 600 }}
                >
                  {valueNode}
                </Tooltip>
              ) : (
                valueNode
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AuditLogDiff;
