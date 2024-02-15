import { useAppConfig, useWorkspace } from "../../lib/context";
import { get } from "../../lib/useApi";
import { DestinationConfig, ServiceConfig } from "../../lib/schema";
import React, { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../prisma/schema";
import { useRouter } from "next/router";
import { assertTrue, getLog, hash as juavaHash, requireDefined, rpc } from "juava";
import { Disable } from "../Disable/Disable";
import { Button, Checkbox, Input, Select, Switch, Tooltip } from "antd";
import { getCoreDestinationType } from "../../lib/schema/destinations";
import { confirmOp, feedbackError, feedbackSuccess } from "../../lib/ui";
import FieldListEditorLayout, { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import hash from "stable-hash";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { ServiceTitle } from "../../pages/[workspaceId]/services";
import { SwitchComponent } from "../ConnectionEditorPage/ConnectionEditorPage";
import { ErrorCard } from "../GlobalError/GlobalError";
import { LabelEllipsis } from "../LabelEllipsis/LabelEllipsis";
import { createDisplayName } from "../../lib/zod";
import xor from "lodash/xor";
import timezones from "timezones-list";
import { useBilling } from "../Billing/BillingProvider";
import { WLink } from "../Workspace/WLink";
import { useStoreReload } from "../../lib/store";

const log = getLog("SyncEditorPage");

const scheduleOptions = [
  {
    label: "Disabled",
    value: "",
    minuteFrequency: Number.MAX_VALUE,
  },
  {
    label: "Every day",
    value: "0 0 * * *",
    minuteFrequency: 60 * 24,
  },
  {
    label: "Every hour",
    value: "0 * * * *",
    minuteFrequency: 60,
  },
  {
    label: "Every 15 minutes",
    value: "*/15 * * * *",
    minuteFrequency: 15,
  },
  {
    label: "Every 5 minutes",
    value: "*/5 * * * *",
    minuteFrequency: 5,
  },
  {
    label: "Every minute",
    value: "* * * * *",
    minuteFrequency: 1,
  },
  {
    label: "Custom",
    value: "custom",
    minuteFrequency: 0,
  },
];

type SelectorProps<T> = {
  enabled: boolean;
  selected: string;
  items: T[];
  onSelect: (value: string) => void;
};

type SyncOptionsType = {
  storageKey?: string;
  streams?: SelectedStreams;
  tableNamePrefix?: string;
  schedule?: string;
  timezone?: string;
};

type SelectedStreamSettings = {
  sync_mode: "full_refresh" | "incremental";
  cursor_field?: string[];
};

type SelectedStreams = Record<string, SelectedStreamSettings>;

function DestinationSelector(props: SelectorProps<DestinationConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new sync if you want to change the source">
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(destination => {
            const destinationType = getCoreDestinationType(destination.destinationType);
            return (
              <Select.Option dropdownMatchSelectWidth={false} value={destination.id} key={destination.id}>
                <DestinationTitle
                  destination={destination}
                  size={"small"}
                  title={(d, t) => {
                    return (
                      <div className={"flex flex-row items-center"}>
                        <div className="whitespace-nowrap">{destination.name}</div>
                        <div className="text-xxs text-gray-500 ml-1">({destinationType.title})</div>
                      </div>
                    );
                  }}
                />
              </Select.Option>
            );
          })}
        </Select>
      </Disable>
      {/*{!props.enabled && (*/}
      {/*  <div className="text-lg px-6">*/}
      {/*    <WLink href={`/destinations?id=${props.selected}`}>*/}
      {/*      <FaExternalLinkAlt />*/}
      {/*    </WLink>*/}
      {/*  </div>*/}
      {/*)}*/}
    </div>
  );
}

function ServiceSelector(props: SelectorProps<ServiceConfig> & { refreshCatalogCb?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new sync if you want to change the service">
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(service => (
            <Select.Option dropdownMatchSelectWidth={false} key={service.id} value={service.id}>
              <ServiceTitle
                service={service}
                size={"small"}
                title={s => {
                  return (
                    <div className={"flex flex-row items-center"}>
                      <div className="whitespace-nowrap">{s.name}</div>
                      <div className="text-xxs text-gray-500 ml-1">({s.package.replaceAll(s.protocol + "/", "")})</div>
                    </div>
                  );
                }}
              />
            </Select.Option>
          ))}
        </Select>
      </Disable>
      {props.refreshCatalogCb && (
        <Button
          className={"mb-2"}
          type={"primary"}
          ghost={true}
          onClick={() => {
            props.refreshCatalogCb?.();
          }}
        >
          Refresh Catalog
        </Button>
      )}
    </div>
  );
}

function SyncEditor({
  services,
  destinations,
  links,
}: {
  services: ServiceConfig[];
  destinations: DestinationConfig[];
  links: z.infer<typeof ConfigurationObjectLinkDbModel>[];
}) {
  const router = useRouter();
  const billing = useBilling();
  const appConfig = useAppConfig();
  const existingLink = router.query.id ? links.find(link => link.id === router.query.id) : undefined;

  assertTrue(services.length > 0, `Services list is empty`);
  assertTrue(destinations.length > 0, `Destinations list is empty`);

  const [loading, setLoading] = useState(false);
  const workspace = useWorkspace();
  const [dstId, setDstId] = useState(
    existingLink?.toId || (router.query.destinationId as string) || destinations[0].id
  );
  const [srvId, setSrvId] = useState(existingLink?.fromId || (router.query.serviceId as string) || services[0].id);

  const service = services.find(s => s.id === srvId);
  const destination = requireDefined(
    destinations.find(d => d.id === dstId),
    `Destination ${dstId} not found`
  );
  const destinationType = getCoreDestinationType(destination.destinationType);

  const [syncOptions, setSyncOptions] = useState<SyncOptionsType | undefined>(existingLink?.data as SyncOptionsType);
  const [catalog, setCatalog] = useState<any>(undefined);
  const [catalogError, setCatalogError] = useState<any>(undefined);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [refreshCatalog, setRefreshCatalog] = useState(0);
  const reloadStore = useStoreReload();

  const [showCustomSchedule, setShowCustomSchedule] = useState(
    syncOptions?.schedule && !scheduleOptions.find(o => o.value === syncOptions?.schedule)
  );

  const updateOptions = useCallback(
    (patch: Partial<SyncOptionsType>) => {
      log.atInfo().log("Patching sync options with", patch, " existing options", syncOptions);
      setSyncOptions({ ...syncOptions, ...patch });
    },
    [syncOptions]
  );

  const updateSelectedStream = useCallback(
    <K extends keyof SelectedStreamSettings>(streamName: string, propName: K, value: SelectedStreamSettings[K]) => {
      if (syncOptions) {
        setSyncOptions({
          ...syncOptions,
          streams: {
            ...syncOptions.streams,
            [streamName]: { ...syncOptions.streams?.[streamName], [propName]: value } as SelectedStreamSettings,
          },
        });
      }
    },
    [syncOptions]
  );

  const deleteSelectedStream = useCallback(
    <K extends keyof SelectedStreamSettings>(streamName: string) => {
      if (syncOptions) {
        const streams = { ...syncOptions.streams };
        delete streams[streamName];
        setSyncOptions({
          ...syncOptions,
          streams: streams,
        });
      }
    },
    [syncOptions]
  );

  const addStream = useCallback(
    (streamName: string) => {
      if (syncOptions) {
        const stream = catalog.streams.find((s: any) =>
          streamName === s.namespace ? s.namespace + "." + s.name : s.name
        );
        if (!stream) {
          log.atError().log("Stream not found in catalog", streamName);
          return;
        }
        const initedStream = initStream(stream);
        setSyncOptions({
          ...syncOptions,
          streams: {
            ...syncOptions.streams,
            [streamName]: initedStream,
          },
        });
      }
    },
    [syncOptions, catalog]
  );

  const initStream = (stream: any): SelectedStreamSettings => {
    const supportedModes = stream.supported_sync_modes;
    let sync_mode: "full_refresh" | "incremental" = "full_refresh";
    let cursor_field: string[] | undefined = undefined;
    if (supportedModes.includes("incremental")) {
      if (stream.source_defined_cursor) {
        sync_mode = "incremental";
      }
      if (stream.default_cursor_field?.length > 0) {
        sync_mode = "incremental";
        cursor_field = stream.default_cursor_field;
      } else {
        const props = Object.entries(stream.json_schema.properties as Record<string, any>);
        const dateProps = props.filter(([_, p]) => p.format === "date-time");
        const cursorField =
          dateProps.find(([name, _]) => name.startsWith("updated")) ||
          dateProps.find(([name, _]) => name.startsWith("created")) ||
          dateProps.find(([name, _]) => name === "timestamp") ||
          props.find(
            ([name, p]) =>
              name === "id" && (p.type === "integer" || (Array.isArray(p.type) && p.type.includes("integer")))
          );
        if (cursorField) {
          sync_mode = "incremental";
          cursor_field = [cursorField[0]];
        }
      }
    }
    return {
      sync_mode,
      cursor_field,
    };
  };

  const initSyncOptions = useCallback(
    (storageKey: string, catalog: any, force?: boolean) => {
      const streams: SelectedStreams = {};
      const currentStreams = force ? {} : syncOptions?.streams || {};
      const newSync = typeof syncOptions?.streams === "undefined" || force;
      for (const stream of catalog?.streams ?? []) {
        const name = stream.namespace ? `${stream.namespace}.${stream.name}` : stream.name;
        const currentStream = currentStreams[name];
        if (currentStream) {
          streams[name] = currentStream;
        } else if (newSync) {
          streams[name] = initStream(stream);
        }
      }
      if (xor(Object.keys(streams), Object.keys(currentStreams)).length > 0) {
        updateOptions({ streams, storageKey });
      }
    },
    [syncOptions?.streams, updateOptions]
  );

  const [runSyncAfterSave, setRunSyncAfterSave] = useState(!existingLink);

  const deleteAllStreams = useCallback(() => {
    if (syncOptions) {
      setSyncOptions({ ...syncOptions, streams: {} });
    }
  }, [syncOptions]);

  const addAllStreams = useCallback(() => {
    if (syncOptions?.storageKey && catalog) {
      initSyncOptions(syncOptions?.storageKey, catalog, true);
    }
  }, [initSyncOptions, catalog, syncOptions?.storageKey]);

  useEffect(() => {
    if (!service) {
      console.log("No service.");
      return;
    }
    if (catalog) {
      return;
    }
    let cancelled = false;
    (async () => {
      console.log("Loading catalog for:", service.package, service.version);
      setLoadingCatalog(true);
      try {
        const force = refreshCatalog > 0;
        const h = juavaHash("md5", hash(service.credentials));
        const storageKey = `${workspace.id}_${service.id}_${h}`;
        const firstRes = await rpc(
          `/api/${workspace.id}/sources/discover?package=${service.package}&version=${
            service.version
          }&storageKey=${storageKey}${force ? "&refresh=true" : ""}`,
          {
            body: service,
          }
        );
        if (cancelled) {
          return;
        }
        if (typeof firstRes.error !== "undefined") {
          setCatalogError(firstRes.error);
        } else if (firstRes.ok) {
          console.log("Loaded cached catalog:", JSON.stringify(firstRes, null, 2));
          setCatalog(firstRes.catalog);
          initSyncOptions(storageKey, firstRes.catalog);
        } else {
          for (let i = 0; i < 60; i++) {
            if (cancelled) {
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resp = await rpc(
              `/api/${workspace.id}/sources/discover?package=${service.package}&version=${service.version}&storageKey=${storageKey}`
            );
            if (!resp.pending) {
              if (typeof resp.error !== "undefined") {
                setCatalogError(resp.error);
                return;
              } else {
                console.log("Loaded catalog:", JSON.stringify(resp, null, 2));
                setCatalog(resp.catalog);
                initSyncOptions(storageKey, resp.catalog);
                return;
              }
            }
          }
          setCatalogError(`Cannot load catalog for ${service.package}:${service.version} error: Timeout`);
        }
      } catch (error) {
        setCatalogError(error);
      } finally {
        if (!cancelled) {
          setLoadingCatalog(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.id, service, initSyncOptions, updateOptions, refreshCatalog, catalog]);

  const configItems: EditorItem[] = [
    {
      name: existingLink ? "Select Service" : "Service",
      documentation: "Select service to connect",
      component: (
        <ServiceSelector
          items={services}
          selected={srvId}
          enabled={!existingLink}
          onSelect={v => {
            setLoadingCatalog(true);
            setSrvId(v);
            setRefreshCatalog(0);
            setCatalog(undefined);
            updateOptions({ streams: undefined });
          }}
          refreshCatalogCb={destinationType.usesBulker ? () => {
            setLoadingCatalog(true);
            setCatalog(undefined);
            setRefreshCatalog(refreshCatalog + 1);
          } : undefined}
        />
      ),
    },
    {
      name: existingLink ? "Select Destination" : "Destination",
      documentation: existingLink
        ? "You can't change destination of existing sync. Please create a new one"
        : "Select destination to connect",
      component: (
        <DestinationSelector
          items={destinations}
          selected={dstId}
          enabled={!existingLink}
          onSelect={id => {
            setDstId(id);
          }}
        />
      ),
    },
    destinationType.usesBulker
      ? {
          name: "Table Name Prefix",
          documentation:
            "Prefix to add to all table names resulting from this sync. E.g. 'mysrc_'. Useful to avoid table names collisions with other syncs.",
          component: (
            <div className={"w-80"}>
              <Input
                disabled={!!existingLink}
                style={{ color: "black" }}
                value={syncOptions?.tableNamePrefix}
                onChange={e => updateOptions({ tableNamePrefix: e.target.value })}
              />
            </div>
          ),
        }
      : undefined,
  ].filter(Boolean) as EditorItem[];
  if (appConfig.syncs.scheduler.enabled) {
    const disableScheduling = billing.enabled && !billing.loading && !billing.settings.maximumSyncFrequency;
    configItems.push({
      name: "Schedule",
      documentation: "Select schedule to run sync",
      component: disableScheduling ? (
        <div className="text-xs font-normal text-textLight">
          <div>Your plan allows to only manual runs.</div>
          <WLink className="underline flex space-x-3 items-center" href="/settings/billing">
            Please upgrade to any paid plan to enable scheduled runs
            <ExternalLink className="w-4 h-4" />
          </WLink>
        </div>
      ) : (
        <Select
          disabled={disableScheduling}
          className={"w-80"}
          options={scheduleOptions.map(({ minuteFrequency, ...rest }) => {
            const optionDisabled =
              billing.enabled &&
              !billing.loading &&
              billing.settings.maximumSyncFrequency &&
              minuteFrequency < billing.settings.maximumSyncFrequency;
            return {
              ...rest,
              label: `${rest.label} ${optionDisabled ? "(Plan upgrade required)" : ""}`,
              disabled: !!optionDisabled,
            };
          })}
          value={showCustomSchedule ? "custom" : syncOptions?.schedule || ""}
          onSelect={id => {
            if (id === "custom") {
              setShowCustomSchedule(true);
            } else {
              setShowCustomSchedule(false);
              updateOptions({ schedule: id });
            }
          }}
        />
      ),
    });
    if (showCustomSchedule) {
      configItems.push({
        name: "Schedule (Cron)",
        documentation: (
          <>
            Schedules are specified using unix-cron format. E.g. every 3 hours: <code>0 */3 * * *</code>, every Monday
            at 9:00: <code>0 9 * * 1</code>
          </>
        ),
        component: (
          <div className={"w-80"}>
            <Input value={syncOptions?.schedule} onChange={e => updateOptions({ schedule: e.target.value })} />
          </div>
        ),
      });
    }
    if (syncOptions?.schedule) {
      configItems.push({
        name: "Scheduler Timezone",
        documentation:
          "Select timezone for scheduler. E.g. 'Every day' setting runs sync at 00:00 in selected timezone",
        component: (
          <Select
            showSearch={true}
            dropdownMatchSelectWidth={false}
            className={"w-80"}
            options={[
              { value: "Etc/UTC", label: "UTC" },
              ...timezones.map(tz => ({ value: tz.tzCode, label: tz.label })),
            ]}
            value={syncOptions?.timezone || "Etc/UTC"}
            onSelect={tz => {
              updateOptions({ timezone: tz });
            }}
          />
        ),
      });
    }
  }
  if (service && !destinationType.usesBulker && destinationType.syncs) {
    const syncOptions = destinationType.syncs[service.package];
    if (destinationType.syncs && syncOptions) {
      configItems.push({
        group: "Options",
        key: "options",
        component: <div className="prose max-w-none text-sm pl-3">
          {syncOptions.description}
        </div>
      })
    }
  }

  if (service && destinationType.usesBulker) {
    if (loadingCatalog) {
      configItems.push({
        group: "Streams",
        key: "streams",
        component: (
          <>
            <LoadingAnimation
              className={"h-96"}
              title={"Loading connector catalog..."}
              longLoadingThresholdSeconds={4}
              longLoadingTitle={"It may take a little longer if it happens for the first time or catalog is too big."}
            />
          </>
        ),
      });
    } else if (catalog) {
      for (const stream of catalog.streams ?? []) {
        const name = stream.namespace ? `${stream.namespace}.${stream.name}` : stream.name;
        const syncModeOptions = stream.supported_sync_modes.map(m => ({
          value: m,
          label: createDisplayName(m),
        }));
        let cursorFieldOptions: { value: string; label: string }[] = [];
        if (stream.supported_sync_modes.includes("incremental") && !stream.source_defined_cursor) {
          const props = Object.entries(stream.json_schema.properties as Record<string, any>);
          cursorFieldOptions = props
            // .filter(
            //   ([_, p]) =>
            //     p.format === "date-time" ||
            //     p.type === "integer" ||
            //     (Array.isArray(p.type) && p.type.includes("integer")) ||
            //     true
            // )
            .map(([name, _]) => ({ value: name, label: name }));
        }

        configItems.push({
          group: "Streams",
          key: name,
          name: (
            <LabelEllipsis maxLen={34} trim={"middle"}>
              {name}
            </LabelEllipsis>
          ),
          component: (
            <div className={"flex flex-row justify-end gap-8 items-center"}>
              <div>
                Mode:{" "}
                <Select
                  disabled={!syncOptions?.streams?.[name] || syncModeOptions.length === 1}
                  className={"w-32"}
                  options={syncModeOptions}
                  value={syncOptions?.streams?.[name]?.sync_mode}
                  onChange={v => updateSelectedStream(name, "sync_mode", v)}
                />
              </div>
              <div className={"w-72"}>
                {stream.supported_sync_modes.includes("incremental") &&
                  syncOptions?.streams?.[name]?.sync_mode === "incremental" && (
                    <>
                      Cursor field:{" "}
                      <Tooltip title={stream.source_defined_cursor ? "Cursor field is defined by source" : undefined}>
                        <Select
                          className={"w-44"}
                          dropdownMatchSelectWidth={false}
                          disabled={!syncOptions?.streams?.[name] || stream.source_defined_cursor}
                          options={!stream.source_defined_cursor ? cursorFieldOptions : []}
                          value={
                            !stream.source_defined_cursor ? syncOptions?.streams?.[name]?.cursor_field?.[0] : undefined
                          }
                          onChange={v => {
                            updateSelectedStream(name, "cursor_field", v ? [v] : undefined);
                          }}
                        />
                      </Tooltip>
                    </>
                  )}
              </div>
              <SwitchComponent
                className="max-w-xs"
                value={!!syncOptions?.streams?.[name]}
                onChange={enabled => {
                  if (enabled) {
                    addStream(name);
                  } else {
                    deleteSelectedStream(name);
                  }
                }}
              />
            </div>
          ),
        });
      }
    } else {
      configItems.push({
        group: "Streams",
        key: "streams",
        component: (
          <div className={"pl-4 pr-2"}>
            <ErrorCard
              title={"Failed to load catalog"}
              hideActions={true}
              error={{ message: catalogError || "Unknown error. Please contact support." }}
            />
          </div>
        ),
      });
    }
  }
  return (
    <div className="max-w-5xl grow">
      <div className="flex justify-between pt-6 pb-0 mb-0 items-center">
        <h1 className="text-3xl">{(existingLink ? "Edit" : "Create") + " sync"}</h1>
        <JitsuButton icon={<ChevronLeft className="w-6 h-6" />} type="link" size="small" onClick={() => router.back()}>
          Back
        </JitsuButton>
      </div>
      <div className="w-full">
        <FieldListEditorLayout
          groups={{
            Streams: {
              expandable: false,
              title: (
                <div className="flex flex-row items-center justify-between gap-2 mt-4 mb-3">
                  <div className={"text-xl"}>Streams {destinationType.usesBulker}</div>
                  <div className={"flex gap-2 pr-2"}>
                    Switch All1
                    <Switch
                      checked={Object.keys(syncOptions?.streams || {}).length > 0}
                      onChange={ch => {
                        if (ch) {
                          addAllStreams();
                        } else {
                          deleteAllStreams();
                        }
                      }}
                    />
                  </div>
                </div>
              ),
            },
          }}
          items={configItems}
        />
      </div>
      <div className="flex justify-between pt-6">
        <div>
          {existingLink && (
            <Button
              loading={loading}
              type="primary"
              ghost
              danger
              size="large"
              onClick={async () => {
                if (await confirmOp("Are you sure you want to unlink this service from this destination?")) {
                  setLoading(true);
                  try {
                    await get(`/api/${workspace.id}/config/link`, {
                      method: "DELETE",
                      query: { fromId: existingLink.fromId, toId: existingLink.toId },
                    });
                    await reloadStore();
                    feedbackSuccess("Successfully unliked");
                    router.back();
                  } catch (e) {
                    feedbackError("Failed to unlink service and destination", { error: e });
                  } finally {
                    setLoading(false);
                  }
                }
              }}
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex justify-end space-x-5 items-center">
          <Checkbox checked={runSyncAfterSave} onChange={() => setRunSyncAfterSave(!runSyncAfterSave)}>
            Run{!existingLink ? " first" : ""} sync after save
          </Checkbox>
          <Button type="primary" ghost size="large" disabled={loading} onClick={() => router.back()}>
            Cancel
          </Button>
          <Button
            type="primary"
            size="large"
            loading={loading}
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await get(`/api/${workspace.id}/config/link?runSync=${runSyncAfterSave}`, {
                  body: {
                    ...(existingLink ? { id: existingLink.id } : {}),
                    fromId: srvId,
                    toId: dstId,
                    type: "sync",
                    data: syncOptions,
                  },
                });
                await reloadStore();
                router.back();
              } catch (error) {
                feedbackError(`Can't link destinations`, { error });
              } finally {
                setLoading(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function CursorFieldSelector(props: { onAdd: (value: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className={"flex flex-row px-1 pt-1.5 gap-2"}>
      <Input placeholder="Set custom cursor field" value={name} onChange={e => setName(e.target.value)} />
      <Button
        type="primary"
        onClick={() => {
          props.onAdd(name);
          setName("");
        }}
      >
        Set
      </Button>
    </div>
  );
}

export default SyncEditor;
