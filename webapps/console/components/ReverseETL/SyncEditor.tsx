import React, { useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Select, Switch } from "antd";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import timezones from "timezones-list";
import { ListMinusIcon } from "lucide-react";
import type { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import type { ReverseSyncView } from "../../lib/reverse-etl";
import type { ModelConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useConfigApi } from "../../lib/useApi";
import { useConfigObjectList } from "../../lib/store";
import { confirmOp, useUnsavedChanges } from "../../lib/ui";
import FieldListEditorLayout, { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { DestinationSelector } from "../Selectors/DestinationSelector";
import { BackButton } from "../BackButton/BackButton";
import { EditorToolbar } from "../EditorToolbar/EditorToolbar";
import { Failure } from "./shared";
import { ScheduleEditor } from "./ScheduleEditor";
import { reverseStreamEditors } from "./streams";

export function SyncEditor({ sync, reload }: { sync?: ReverseSyncView; reload: () => Promise<unknown> }) {
  const workspace = useWorkspace(),
    role = useWorkspaceRole(),
    router = useRouter();
  const maintenance = useAppConfig().maintenance?.active;
  const api = useConfigApi<ModelConfig>("model");
  const models = useQuery({ queryKey: ["reverse-etl-models", workspace.id], queryFn: () => api.list() });
  const destinations = useConfigObjectList("destination").filter(d => reverseStreamEditors[d.destinationType]?.length);
  const [fromId, setFromId] = useState(sync?.fromId ?? String(router.query.modelId ?? ""));
  const [toId, setToId] = useState(sync?.toId ?? String(router.query.destinationId ?? ""));
  const [options, setOptions] = useState<ReverseSyncOptions>(() => {
    if (sync) {
      const data = sync.options;
      if (
        !sync.settingsLocked &&
        !data.streamOptions.audience &&
        !data.streamOptions.managedAudienceId &&
        data.streamOptions.audienceId
      ) {
        const { audienceId, ...rest } = data.streamOptions;
        return { ...data, streamOptions: { ...rest, audience: { kind: "existing", audienceId } } };
      }
      return data;
    }
    return {
      version: 2,
      name: "",
      stream: "",
      mode: "mirror",
      mapping: {},
      streamOptions: {},
      schedule: "",
      timezone: "Etc/UTC",
      checkpointEvery: 50000,
      errorPolicy: "fail",
      disabled: false,
    };
  });
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [runAfterSave, setRunAfterSave] = useState(false);
  const [error, setError] = useState<unknown>();
  const requestId = useRef<string>();
  const editable = role.editEntities && !maintenance && !busy,
    enabled = workspace.featuresEnabled.includes("reverse-etl");
  const locked = !!sync?.settingsLocked,
    disabled = !editable || !enabled || locked;
  const streams = reverseStreamEditors[destinations.find(d => d.id === toId)?.destinationType ?? ""] ?? [];
  const stream = streams.find(s => s.id === options.stream);
  useUnsavedChanges(dirty && !busy);
  const update = (patch: Partial<ReverseSyncOptions>) => {
    setOptions(o => ({ ...o, ...patch }));
    setDirty(true);
  };
  const endpoint = `/api/${workspace.id}/reverse-etl/sync?syncId=${encodeURIComponent(sync?.id ?? "")}`;
  const run = async (id: string) => {
    const result = await rpc(`/api/${workspace.id}/reverse-etl/sync`, {
      method: "POST",
      query: { syncId: id },
      body: { action: "run" },
    });
    await router.push(`/${workspace.slugOrId}/reverse-syncs/logs?syncId=${id}&taskId=${result.taskId}`);
  };
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const items: EditorItem[] = [
    {
      name: "Name",
      component: (
        <Input
          className="w-80"
          disabled={!editable || !enabled}
          value={options.name}
          onChange={e => update({ name: e.target.value })}
        />
      ),
    },
    {
      name: "Model",
      component: (
        <Select
          className="w-80"
          showSearch
          optionFilterProp="label"
          disabled={disabled}
          loading={models.isLoading}
          value={fromId || undefined}
          placeholder="Select model"
          options={models.data?.map(m => ({ value: m.id, label: m.name || m.id }))}
          onChange={id => {
            setFromId(id);
            setDirty(true);
          }}
        />
      ),
    },
    {
      name: "Destination",
      component: (
        <DestinationSelector
          items={destinations}
          selected={toId}
          enabled={!disabled}
          showLink
          onSelect={id => {
            setToId(id);
            update({ stream: "", mapping: {}, streamOptions: {} });
          }}
        />
      ),
    },
    {
      name: "Schedule",
      documentation: "Manual runs are available even without a schedule.",
      component: (
        <div className="w-80">
          <ScheduleEditor
            disabled={!editable || !enabled}
            value={options.schedule}
            onChange={schedule => update({ schedule })}
          />
        </div>
      ),
    },
    {
      name: "Scheduler timezone",
      component: (
        <Select
          className="w-80"
          showSearch
          optionFilterProp="label"
          disabled={!editable || !enabled}
          value={options.timezone}
          options={[{ value: "Etc/UTC", label: "UTC" }, ...timezones.map(t => ({ value: t.tzCode, label: t.label }))]}
          onChange={timezone => update({ timezone })}
        />
      ),
    },
    {
      name: "Enabled",
      documentation: "Pausing stops new runs and automatic status checks, not Google requests already submitted.",
      component: (
        <Switch
          disabled={!editable || (!enabled && options.disabled)}
          checked={!options.disabled}
          onChange={value => update({ disabled: !value })}
        />
      ),
    },
    {
      name: "Stream",
      documentation: "Choose the destination stream to configure below.",
      component: (
        <Select
          className="w-80"
          disabled={disabled || !toId}
          value={options.stream || undefined}
          placeholder="Select stream"
          options={streams.map(s => ({ value: s.id, label: s.label }))}
          onChange={id => {
            const selected = streams.find(s => s.id === id)!;
            update({ stream: id, ...selected.defaults() });
          }}
        />
      ),
    },
    ...(stream?.fields(options, update, disabled) ?? []),
  ];
  return (
    <div className="max-w-5xl grow">
      <div className="flex justify-between pb-4 items-center">
        <h1 className="text-3xl">{sync ? "Edit" : "Create"} reverse sync</h1>
        <BackButton href={`/${workspace.slugOrId}/reverse-syncs`} />
      </div>
      {sync && (
        <div className="flex justify-between items-center mb-4">
          <EditorToolbar
            items={[
              {
                title: "Logs",
                icon: <ListMinusIcon className="w-full h-full" />,
                href: `/${workspace.slugOrId}/reverse-syncs/tasks?syncId=${sync.id}`,
              },
            ]}
          />
          <Button
            loading={busy}
            disabled={
              !editable ||
              !enabled ||
              options.disabled ||
              dirty ||
              ["RUNNING", "WAITING"].includes(sync.latestTask?.status ?? "")
            }
            onClick={() => perform(() => run(sync.id))}
          >
            Run now
          </Button>
        </div>
      )}
      <Failure error={error || models.error} />
      {sync && router.query.runStartUnconfirmed === "1" && (
        <Alert
          className="mb-4"
          type="warning"
          title="Sync saved, but the run could not be confirmed. Check Logs before trying again."
        />
      )}
      {locked && (
        <Alert
          className="mb-4"
          type="info"
          title="Delivery settings are locked because this sync has runtime state. Name and scheduling remain editable."
        />
      )}
      <FieldListEditorLayout items={items} />
      <div className="flex justify-between pt-6 gap-4">
        <div>
          {sync && (
            <Button
              danger
              size="large"
              disabled={!role.deleteEntities || !!maintenance || busy}
              onClick={() =>
                perform(async () => {
                  if (await confirmOp("Delete this paused sync? Its audience and runtime state will be retained.")) {
                    await rpc(endpoint, { method: "DELETE" });
                    setDirty(false);
                    await reload();
                    await router.push(`/${workspace.slugOrId}/reverse-syncs`);
                  }
                })
              }
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-4 items-center">
          <Checkbox
            disabled={!editable || !enabled || options.disabled}
            checked={runAfterSave}
            onChange={e => setRunAfterSave(e.target.checked)}
          >
            Run sync after save
          </Checkbox>
          <Button size="large" disabled={busy} onClick={() => router.push(`/${workspace.slugOrId}/reverse-syncs`)}>
            Cancel
          </Button>
          <Button
            type="primary"
            size="large"
            loading={busy}
            disabled={!editable || (!enabled && (!sync || !options.disabled))}
            onClick={() =>
              perform(async () => {
                if (!sync) {
                  const pending = router.query.requestId;
                  requestId.current ??=
                    typeof pending === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(pending)
                      ? pending
                      : crypto.randomUUID();
                  // Keep only the opaque idempotency key across reloads; no intermediate setup object.
                  await router.replace(
                    {
                      pathname: `/${workspace.slugOrId}/reverse-syncs`,
                      query: { ...router.query, requestId: requestId.current },
                    },
                    undefined,
                    { shallow: true, scroll: false }
                  );
                }
                const body = { fromId, toId, data: options };
                // No preview, validation request or intermediate save. The API checks the submitted settings.
                const result = sync
                  ? await rpc(endpoint, { method: "PUT", body: !enabled ? { disabled: true } : body })
                  : await rpc(`/api/${workspace.id}/reverse-etl/syncs`, {
                      method: "POST",
                      body: { requestId: requestId.current, sync: body },
                    });
                setDirty(false);
                await reload();
                if (runAfterSave && !options.disabled) {
                  try {
                    await run(result.id);
                  } catch {
                    // Creation committed even if controller admission/response failed.
                    // Open the saved sync rather than trapping edits behind its create request ID.
                    await router.push(`/${workspace.slugOrId}/reverse-syncs?id=${result.id}&runStartUnconfirmed=1`);
                  }
                } else await router.push(`/${workspace.slugOrId}/reverse-syncs?id=${result.id}`);
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
