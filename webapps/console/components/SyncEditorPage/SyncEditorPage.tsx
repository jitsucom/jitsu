import { useWorkspace } from "../../lib/context";
import { get } from "../../lib/useApi";
import { DestinationConfig, ServiceConfig } from "../../lib/schema";
import React, { PropsWithChildren, useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../prisma/schema";
import { useRouter } from "next/router";
import { assertTrue, getLog, hash as juavaHash, rpc } from "juava";
import { Disable } from "../Disable/Disable";
import { Button, Select } from "antd";
import { WLink } from "../Workspace/WLink";
import { FaExternalLinkAlt } from "react-icons/fa";
import { getCoreDestinationType } from "../../lib/schema/destinations";
import { confirmOp, feedbackError, feedbackSuccess } from "../../lib/ui";
import FieldListEditorLayout, { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { ChevronLeft } from "lucide-react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { SnippedEditor } from "../CodeEditor/SnippedEditor";
import hash from "stable-hash";

const log = getLog("SyncEditorPage");

type SelectorProps<T> = {
  enabled: boolean;
  selected: string;
  items: T[];
  onSelect: (value: string) => void;
};

const Htmlizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  return typeof children === "string" ? <span dangerouslySetInnerHTML={{ __html: children }} /> : <>{children}</>;
};

type SyncOptionsType = any;

function DestinationSelector(props: SelectorProps<DestinationConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new sync if you want to change the source">
        <Select className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(destination => {
            const destinationType = getCoreDestinationType(destination.destinationType);
            return (
              <Select.Option dropdownMatchSelectWidth={false} value={destination.id} key={destination.id}>
                <div className="flex items-center">
                  <div className="w-5 h-5 mr-2 shrink-0">{destinationType.icon}</div>
                  <div className="whitespace-nowrap">{destination.name}</div>
                  <div className="text-xxs text-gray-500 ml-1">({destinationType.title})</div>
                </div>
              </Select.Option>
            );
          })}
        </Select>
      </Disable>
      {!props.enabled && (
        <div className="text-lg px-6">
          <WLink href={`/destinations?id=${props.selected}`}>
            <FaExternalLinkAlt />
          </WLink>
        </div>
      )}
    </div>
  );
}

function ServiceSelector(props: SelectorProps<ServiceConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new sync if you want to change the service">
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(service => (
            <Select.Option dropdownMatchSelectWidth={false} key={service.id} value={service.id}>
              <div className="flex items-center">
                <div className="w-5 h-5 mr-2 shrink-0">
                  <img
                    alt={service.package}
                    src={`/api/sources/logo?type=${service.protocol}&package=${encodeURIComponent(service.package)}`}
                  />
                </div>
                <div className="whitespace-nowrap">{service.name}</div>
                <div className="text-xxs text-gray-500 ml-1">
                  ({service.package.replaceAll(service.protocol + "/", "")})
                </div>
              </div>
            </Select.Option>
          ))}
        </Select>
      </Disable>
      {!props.enabled && (
        <div className="text-lg px-6">
          <WLink href={`/service?id=${props.selected}`}>
            <FaExternalLinkAlt />
          </WLink>
        </div>
      )}
    </div>
  );
}

type EditorProps<T> = {
  value?: T;
  disabled?: boolean;
  onChange: (value: T) => void;
};

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
  const existingLink = router.query.id ? links.find(link => link.id === router.query.id) : undefined;

  assertTrue(services.length > 0, `Services list is empty`);
  assertTrue(destinations.length > 0, `Destinations list is empty`);

  const [loading, setLoading] = useState(false);
  const workspace = useWorkspace();
  const [dstId, setDstId] = useState(existingLink?.toId || destinations[0].id);
  const [srvId, setSrvId] = useState(existingLink?.fromId || services[0].id);

  const service = services.find(s => s.id === srvId);

  const [syncOptions, setSyncOptions] = useState<SyncOptionsType>(existingLink?.data || {});
  const [streamsProvided, setStreamsProvided] = useState(!!syncOptions.streams && syncOptions.streams !== "{}");
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const updateOptions: (patch: Partial<SyncOptionsType>) => void = useCallback(
    patch => {
      log.atDebug().log("Patching sync options with", patch, " existing options", syncOptions);
      setSyncOptions({ ...syncOptions, ...patch });
    },
    [syncOptions]
  );

  const updateCatalog: (catalog: any) => void = useCallback(
    catalog => {
      updateOptions({ streams: catalog });
      setStreamsProvided(true);
    },
    [updateOptions]
  );

  useEffect(() => {
    if (!service) {
      console.log("No service.");
      return;
    }
    if (streamsProvided) {
      console.log("No need to load catalog. Specs are already filled.");
      return;
    }
    (async () => {
      console.log("Loading catalog");
      setLoadingCatalog(true);
      try {
        const h = juavaHash("md5", hash(JSON.parse(service.credentials)));
        const storageKey = `${workspace.id}_${service.id}_${h}`;
        const firstRes = await rpc(
          `/api/${workspace.id}/sources/discover?package=${service.package}&version=${service.version}&storageKey=${storageKey}`,
          {
            body: service,
          }
        );
        if (firstRes.error) {
          updateCatalog(firstRes.error);
        } else if (firstRes.ok) {
          console.log("Loaded cached catalog:", JSON.stringify(firstRes, null, 2));
          updateCatalog(JSON.stringify(firstRes.catalog, null, 2));
        } else {
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resp = await rpc(
              `/api/${workspace.id}/sources/discover?package=${service.package}&version=${service.version}&storageKey=${storageKey}`
            );
            if (!resp.pending) {
              if (resp.error) {
                updateCatalog(resp.error);
                return;
              } else {
                console.log("Loaded catalog:", JSON.stringify(resp, null, 2));
                updateCatalog(JSON.stringify(resp.catalog, null, 2));
                return;
              }
            }
          }
          updateCatalog(`Cannot load specs for ${service.package}:${service.version} error: Timeout`);
        }
      } catch (error) {
        updateCatalog(error);
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [workspace.id, service, updateOptions, streamsProvided]);

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
            setSrvId(v);
            updateOptions({ streams: "{}" });
            setStreamsProvided(false);
          }}
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
  ];
  if (service) {
    configItems.push({
      name: "Selected Streams",
      component: (
        <>
          {loadingCatalog ? (
            <LoadingAnimation className={"h-96"} title={"Loading connector catalog..."} />
          ) : (
            <div className={"flex flex-col items-end"}>
              <Button
                className={"mb-2"}
                type={"primary"}
                ghost={true}
                size={"small"}
                onClick={() => {
                  setStreamsProvided(false);
                }}
              >
                Refresh
              </Button>
              <div className={"w-full"}>
                <SnippedEditor
                  value={syncOptions.streams ?? "{}"}
                  onChange={streams => {
                    updateOptions({ streams });
                  }}
                  languages={["json"]}
                  height={382}
                  foldLevel={5}
                  options={{
                    folding: true,
                    foldingHighlight: false,
                    showFoldingControls: "always",
                  }}
                />
              </div>
            </div>
          )}
        </>
      ),
    });
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
            Advanced: { expandable: true },
            Functions: { expandable: true },
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
        <div className="flex justify-end space-x-5">
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
                await get(`/api/${workspace.id}/config/link`, {
                  body: { fromId: srvId, toId: dstId, type: "sync", data: syncOptions },
                });
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

export default SyncEditor;
