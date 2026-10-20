import React, { useRef, useState } from "react";
import { Alert, Button, Select, Switch } from "antd";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import timezones from "timezones-list";
import { ListMinusIcon } from "lucide-react";
import type { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import type { ReverseSyncView } from "../../lib/reverse-etl";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useConfigObjectList } from "../../lib/store";
import { confirmOp, useUnsavedChanges } from "../../lib/ui";
import FieldListEditorLayout, { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { DestinationSelector } from "../Selectors/DestinationSelector";
import { BackButton } from "../BackButton/BackButton";
import { EditorToolbar } from "../EditorToolbar/EditorToolbar";
import { Failure } from "./shared";
import { ScheduleEditor } from "./ScheduleEditor";
import { reverseStreamEditors, streamFieldGroups } from "./streams";
import { MetaTargetCheck } from "./MetaTargetCheck";
import { ModelTitle } from "./ModelTitle";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { MappingSuggestions } from "./MappingSuggestions";
import { streamRequirementErrors } from "@jitsu/destination-functions/src/reverse-etl/editor";

export function SyncEditor({ sync, reload }: { sync?: ReverseSyncView; reload: () => Promise<unknown> }) {
  const workspace = useWorkspace(),
    role = useWorkspaceRole(),
    router = useRouter();
  const appConfig = useAppConfig();
  const maintenance = appConfig.maintenance?.active;
  const models = useConfigObjectList("model");
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
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const [showValidation, setShowValidation] = useState(false);
  const errorBlock = useRef<HTMLDivElement>(null);
  const requestId = useRef<string>();
  const editable = role.editEntities && !maintenance && !busy,
    enabled = workspace.featuresEnabled.includes("reverse-etl");
  const locked = !!sync?.settingsLocked,
    disabled = !editable || !enabled || locked;
  const streams = reverseStreamEditors[destinations.find(d => d.id === toId)?.destinationType ?? ""] ?? [];
  const isMeta = destinations.find(d => d.id === toId)?.destinationType === "facebook-conversions";
  const stream = streams.find(s => s.id === options.stream);
  const streamDefinition = reverseDestinationMetadata
    .get(destinations.find(d => d.id === toId)?.destinationType ?? "")
    ?.streams.find(s => s.id === options.stream);
  const model = models.find(m => m.id === fromId);
  const columns = useQuery({
    queryKey: ["reverse-etl-model-columns", workspace.id, fromId, model?.warehouseId, model?.query],
    enabled: !!model && enabled && role.editEntities && !maintenance,
    queryFn: async ({ signal }) => {
      const result = await rpc(`/api/${workspace.id}/models/columns`, { query: { modelId: fromId }, signal });
      return WarehouseColumn.array().parse(result.columns);
    },
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  useUnsavedChanges(dirty && !busy);
  const update = (patch: Partial<ReverseSyncOptions>) => {
    setOptions(o => ({ ...o, ...patch }));
    setDirty(true);
  };
  const streamFields =
    stream?.fields(options, update, disabled, {
      columns: columns.data ?? [],
      loading: columns.isFetching,
      destinationId: toId,
      destinationProtocol: destinationProtocol(destinations.find(d => d.id === toId)?.url),
      showValidation,
    }) ?? [];
  if (streamDefinition && appConfig.reverseMappingSuggestionsEnabled) {
    // Keep stream guidance first, then suggestions, followed by the requirement cards.
    const firstCard = streamFields.findIndex(field => field.key?.includes(":section:"));
    streamFields.splice(firstCard < 0 ? 0 : firstCard, 0, {
      key: "mapping-suggestions",
      group: "Stream settings",
      rowClassName: "!border-0",
      itemClassName: "w-full",
      component: (
        <MappingSuggestions
          // Any change to the source or form invalidates both in-flight requests and reviewed suggestions.
          key={JSON.stringify([
            workspace.id,
            fromId,
            toId,
            model?.query,
            model?.warehouseId,
            columns.data,
            options.mode,
            options.stream,
            options.mapping,
            options.streamOptions,
          ])}
          workspaceId={workspace.id}
          modelId={fromId}
          destinationId={toId}
          stream={streamDefinition}
          options={options}
          columns={columns.data ?? []}
          disabled={disabled || columns.isFetching || !!columns.error}
          onApply={mapping => update({ mapping })}
        />
      ),
    });
  }
  // A "columns" field (the webhook payload) derives the mapping from the model's columns. The server never queries the
  // warehouse at save, so a mapping left over from another model would be accepted whenever the primary key matches and
  // the payload would silently carry the wrong fields: drop it when the model changes and hold Save until the new
  // columns have rebuilt it.
  const derivesMapping = stream?.derivesMapping(options) ?? false;
  const endpoint = `/api/${workspace.id}/reverse-etl/sync?syncId=${encodeURIComponent(sync?.id ?? "")}`;
  const run = async (id: string) => {
    const result = await rpc(`/api/${workspace.id}/reverse-etl/sync`, {
      method: "POST",
      query: { syncId: id },
      body: { action: "run" },
    });
    await router.push(`/${workspace.slugOrId}/reverse-syncs/logs?syncId=${id}&taskId=${result.taskId}&starting=1`);
  };
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e);
      // Wait for the error block to render, then keep long forms' errors visible near the Save action.
      requestAnimationFrame(() => errorBlock.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
    } finally {
      setBusy(false);
    }
  };
  const items: EditorItem[] = [
    {
      name: "Model",
      rowClassName: showValidation && !fromId ? "rounded border border-red-400 bg-red-50" : undefined,
      component: (
        <Select
          className="w-80"
          showSearch
          optionFilterProp="search"
          disabled={disabled}
          value={fromId || undefined}
          placeholder="Select model"
          options={models.map(m => ({
            value: m.id,
            title: m.name || m.id,
            search: `${m.name} ${m.id}`,
            label: <ModelTitle model={m} size="small" />,
          }))}
          onChange={id => {
            setFromId(id);
            if (derivesMapping && id !== fromId) update({ mapping: {} });
            else setDirty(true);
          }}
        />
      ),
    },
    {
      name: "Destination",
      rowClassName: showValidation && !toId ? "rounded border border-red-400 bg-red-50" : undefined,
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
      rowClassName: showValidation && !stream ? "rounded border border-red-400 bg-red-50" : undefined,
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
    ...streamFields,
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
            disabled={!editable || !enabled || options.disabled || dirty || sync.latestTask?.status === "RUNNING"}
            onClick={() => perform(() => run(sync.id))}
          >
            Run now
          </Button>
        </div>
      )}
      {!!columns.error && (
        <Alert
          className="mb-4"
          type="warning"
          title="Could not load model columns. Existing mappings are kept."
          action={
            <Button size="small" loading={columns.isFetching} onClick={() => columns.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {locked && (
        <Alert
          className="mb-4"
          type="info"
          title="Delivery settings are locked because this sync has runtime state. Name and scheduling remain editable."
          description="Deleting a mirror sync keeps its audience reserved. Pause it instead if you may need to resume it."
        />
      )}
      <FieldListEditorLayout items={items} groups={streamFieldGroups} />
      {isMeta && stream && (
        <MetaTargetCheck
          destinationId={toId}
          stream={options.stream}
          streamOptions={options.streamOptions}
          disabled={!editable || !enabled}
        />
      )}
      <div className="flex justify-between pt-6 gap-4">
        <div>
          {sync && (
            <Button
              danger
              size="large"
              disabled={!role.deleteEntities || !!maintenance || busy}
              onClick={() =>
                perform(async () => {
                  if (
                    await confirmOp(
                      "Delete this paused sync? Its audience, runtime state and any exclusive audience ownership will be retained. Deleting does not allow a replacement sync to take over the audience."
                    )
                  ) {
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
          <Button size="large" disabled={busy} onClick={() => router.push(`/${workspace.slugOrId}/reverse-syncs`)}>
            Cancel
          </Button>
          <Button
            type="primary"
            size="large"
            loading={busy}
            disabled={!editable || (!enabled && (!sync || !options.disabled)) || (derivesMapping && columns.isFetching)}
            onClick={() =>
              perform(async () => {
                // Pausing with the rollout disabled and scheduling-only edits on locked syncs must remain available.
                if (enabled && !locked) {
                  setShowValidation(true);
                  const errors = [
                    ...(!fromId ? ["Choose a model."] : []),
                    ...(!toId ? ["Choose a destination."] : []),
                    ...(!streamDefinition
                      ? ["Choose a stream."]
                      : streamRequirementErrors(streamDefinition, {
                          ...options,
                          destination: { protocol: destinationProtocol(destinations.find(d => d.id === toId)?.url) },
                        })),
                  ];
                  if (errors.length) throw new Error(errors.join("\n"));
                }
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
                // Read-only Meta preflight catches target setup mistakes before the first delivery.
                // Pauses and schedule/mapping-only edits stay available if Meta is unavailable.
                if (
                  isMeta &&
                  !locked &&
                  enabled &&
                  !options.disabled &&
                  (!sync ||
                    sync.options.disabled ||
                    toId !== sync.toId ||
                    options.stream !== sync.options.stream ||
                    JSON.stringify(options.streamOptions) !== JSON.stringify(sync.options.streamOptions))
                )
                  await rpc(`/api/${workspace.id}/reverse-etl/meta-check`, {
                    method: "POST",
                    body: { destinationId: toId, stream: options.stream, streamOptions: options.streamOptions },
                  });
                await (sync
                  ? rpc(endpoint, { method: "PUT", body: !enabled ? { disabled: true } : body })
                  : rpc(`/api/${workspace.id}/reverse-etl/syncs`, {
                      method: "POST",
                      body: { requestId: requestId.current, sync: body },
                    }));
                setDirty(false);
                await reload();
                await router.push(`/${workspace.slugOrId}/reverse-syncs`);
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
      <div ref={errorBlock} className="whitespace-pre-line" aria-live="polite" data-testid="reverse-sync-save-error">
        <Failure error={error} />
      </div>
    </div>
  );
}

function destinationProtocol(url: unknown): string | undefined {
  try {
    return typeof url === "string" ? new URL(url).protocol : undefined;
  } catch {
    return undefined;
  }
}
