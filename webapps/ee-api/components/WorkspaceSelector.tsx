import React, { useEffect, useMemo, useState } from "react";
import { Button, Select, Spin } from "antd";
import { useAuth } from "./AuthProvider";

export type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string | null;
};

/** Searchable label for a workspace: `Name - slug (id)`, slug omitted when absent. */
function workspaceLabel(w: WorkspaceListItem): string {
  return w.slug ? `${w.name} - ${w.slug} (${w.id})` : `${w.name} (${w.id})`;
}

/** Fixed height keeps the box from jumping between picker and identity views. */
const boxClass = "flex h-16 items-center rounded-xl border border-neutral-200 bg-white px-4";

/**
 * Workspace picker rendered as a bordered box of constant height. With nothing
 * chosen it shows a searchable AntD Select; once chosen it shows the workspace
 * identity (name, slug, id) with a "Switch" button to pick another.
 */
export const WorkspaceSelector: React.FC<{
  value?: string;
  onChange: (workspaceId: string | undefined) => void;
}> = ({ value, onChange }) => {
  const { authFetch } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await authFetch("/api/admin/workspaces");
        if (!resp.ok) {
          throw new Error(`Failed to load workspaces (${resp.status})`);
        }
        const { workspaces } = await resp.json();
        if (!cancelled) {
          setWorkspaces(workspaces || []);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load workspaces");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  const options = useMemo(() => workspaces.map(w => ({ value: w.id, label: workspaceLabel(w) })), [workspaces]);
  const selected = useMemo(() => workspaces.find(w => w.id === value), [workspaces, value]);

  // A workspace is set but the list hasn't resolved it yet.
  if (value && !selected && loading) {
    return (
      <div className={`${boxClass} gap-3 text-sm text-neutral-400`}>
        <Spin size="small" /> Loading workspace…
      </div>
    );
  }

  // Identity view — a workspace is chosen and we're not switching.
  if (selected && !picking) {
    return (
      <div className={`${boxClass} gap-4`}>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-semibold text-neutral-900">{selected.name}</span>
          {selected.slug && (
            <>
              <span className="text-neutral-300">—</span>
              <span className="truncate font-medium text-indigo-600">{selected.slug}</span>
            </>
          )}
          <span className="font-mono text-xs text-neutral-400">{selected.id}</span>
        </div>
        <Button onClick={() => setPicking(true)}>Switch</Button>
      </div>
    );
  }

  // Picker view — first selection, or switching workspaces.
  return (
    <div className={`${boxClass} gap-2`}>
      <Select
        autoFocus={picking}
        defaultOpen={picking}
        showSearch
        allowClear
        loading={loading}
        status={error ? "error" : undefined}
        placeholder={error || "Search workspaces by name, slug or id…"}
        value={value}
        onChange={v => {
          onChange(v || undefined);
          setPicking(false);
        }}
        options={options}
        optionFilterProp="label"
        filterOption={(input, option) => ((option?.label as string) || "").toLowerCase().includes(input.toLowerCase())}
        notFoundContent={loading ? "Loading…" : "No workspaces"}
        className="min-w-0 flex-1"
      />
      {selected && (
        <Button type="text" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      )}
    </div>
  );
};
