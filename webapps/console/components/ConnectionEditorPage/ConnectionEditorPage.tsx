import { useWorkspace } from "../../lib/context";
import { get } from "../../lib/useApi";
import { DestinationConfig, FunctionConfig, StreamConfig } from "../../lib/schema";
import React, { useEffect, useState } from "react";
import { SomeZodObject, z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../prisma/schema";
import { useRouter } from "next/router";
import { assertTrue, getLog, requireDefined } from "juava";
import { Disable } from "../Disable/Disable";
import { Button, Input, InputNumber, Radio, Select, Switch } from "antd";
import { WLink } from "../Workspace/WLink";
import { FaExternalLinkAlt } from "react-icons/fa";
import { BaseBulkerConnectionOptions, getCoreDestinationType } from "../../lib/schema/destinations";
import { confirmOp, feedbackError, feedbackSuccess } from "../../lib/ui";
import FieldListEditorLayout, { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { DataLayoutType } from "@jitsu/protocols/analytics";
import { ChevronLeft } from "lucide-react";
import styles from "./ConnectionEditorPage.module.css";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { Htmlizer } from "../Htmlizer/Htmlizer";
import { FunctionsSelector } from "../FunctionsSelector/FunctionsSelector";
import { Expandable } from "../Expandable/Expandable";
import { useStoreReload } from "../../lib/store";

const log = getLog("ConnectionEditorPage");

type SelectorProps<T> = {
  enabled: boolean;
  selected: string;
  items: T[];
  onSelect: (value: string) => void;
};

type ConnectionOptionsType = Partial<BaseBulkerConnectionOptions> & { [key: string]: any };

function DestinationSelector(props: SelectorProps<DestinationConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new connection if you want to change the source">
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

function SourceSelector(props: SelectorProps<StreamConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason="Create a new connection if you want to change the source">
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(stream => (
            <Select.Option key={stream.id} value={stream.id}>
              <StreamTitle stream={stream} size={"small"} />
            </Select.Option>
          ))}
        </Select>
      </Disable>
      {!props.enabled && (
        <div className="text-lg px-6">
          <WLink href={`/streams?id=${props.selected}`}>
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

type EditorComponent<T, P = {}> = React.FC<EditorProps<T> & P>;

const DataLayoutEditor: EditorComponent<DataLayoutType, { fileStorage?: boolean }> = props => (
  <Radio.Group className={styles.radioGroup} value={props.value} onChange={val => props.onChange(val.target.value)}>
    <div className={"flex flex-col gap-2"}>
      {props.fileStorage && (
        <Radio value="passthrough">
          <div>
            <div className={``}>Original</div>
            <div className={`text-textLight text-sm`}>Keep original event structure.</div>
          </div>
        </Radio>
      )}
      <Radio value="segment-single-table">
        <div>
          <div className={``}>
            Single Table{!props.fileStorage ? <span className="text-textDark font-bold"> (recommended)</span> : <></>}
          </div>
          <div className={`max-w-2xl text-textLight text-sm`}>
            The data is written into a table <code>events</code>. Field names and naming convention are same as in
            Segment
          </div>
        </div>
      </Radio>
      <Radio value="segment">
        <div>
          <div className={``}>Segment</div>
          <div className={`text-textLight text-sm`}>
            This data layout emulates segment tables: <code>pages</code>, <code>identify</code>, etc
          </div>
        </div>
      </Radio>
      <Radio value="jitsu-legacy">
        <div>
          <div className={``}>Legacy Jitsu</div>
          <div className={`text-textLight text-sm`}>
            Table name <code>events</code>. Field names are as in Jitsu 1.0
          </div>
        </div>
      </Radio>
    </div>
  </Radio.Group>
);

export const BatchOrStreamEditor: EditorComponent<ConnectionOptionsType["mode"], { limitations?: any }> = ({
  value,
  disabled,
  onChange,
  limitations,
}) => {
  const [streamModeState, setStreamModeState] = useState<"locked" | "disabled" | "allowed">("allowed");
  const [streamModeCaveats, setStreamModeCaveats] = useState<string>();

  useEffect(() => {
    if (limitations?.streamModeLocked) {
      setStreamModeState(value !== "stream" ? "locked" : "allowed");
      setStreamModeCaveats(limitations?.streamModeLocked);
    } else if (limitations?.streamModeDisabled) {
      setStreamModeState("disabled");
      setStreamModeCaveats(limitations?.streamModeDisabled);
    } else {
      setStreamModeState("allowed");
      setStreamModeCaveats(undefined);
    }
  }, [limitations, value]);

  return (
    <Radio.Group
      className={styles.radioGroup}
      value={streamModeState === "disabled" ? "batch" : value || "batch"}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    >
      <div className={"flex flex-col gap-2"}>
        <Radio value="stream" disabled={streamModeState !== "allowed"}>
          <div>
            <div className={``}>
              Stream
              {streamModeState === "locked" && (
                <Button
                  className="m-0 p-0"
                  type="link"
                  size="small"
                  onClick={() => {
                    setStreamModeState("allowed");
                  }}
                >
                  🔒
                </Button>
              )}
            </div>
            <div className={`max-w-2xl text-textLight text-sm`}>
              <Htmlizer>{streamModeCaveats}</Htmlizer>
            </div>
          </div>
        </Radio>
        <Radio value="batch">Batch</Radio>
      </div>
    </Radio.Group>
  );
};

export const SyncFrequencyEditor: EditorComponent<ConnectionOptionsType["frequency"]> = ({
  value,
  disabled,
  onChange,
}) => (
  <InputNumber
    disabled={disabled}
    value={value || 60}
    size="small"
    addonAfter={"Minutes"}
    defaultValue={60}
    className="w-36"
    min={1}
    max={60 * 24}
    onChange={v => onChange(v as number)}
  />
);

type TextEditorComponent = EditorComponent<string, { className?: string; rows?: number }>;
type SwitchComponentType = EditorComponent<boolean, { className?: string }>;

const TextEditor: TextEditorComponent = ({ rows, value, onChange, disabled, className }) => {
  if (rows && rows > 1) {
    return (
      <Input.TextArea
        rows={rows}
        className={className}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  } else {
    return (
      <Input
        className={className}
        disabled={disabled}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
};

export const SwitchComponent: SwitchComponentType = ({ value, disabled, onChange, className }) => {
  return (
    <Switch
      className={className}
      disabled={disabled}
      checked={value}
      defaultChecked={value}
      onChange={checked => onChange(checked)}
    />
  );
};

function hasZodFields(zod: SomeZodObject, ...fields: (keyof ConnectionOptionsType)[]) {
  for (const f of fields) {
    if (!zod.shape.hasOwnProperty(f)) {
      return false;
    }
  }
  return true;
}

function ConnectionEditor({
  streams,
  destinations,
  links,
  functions,
}: {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  links: z.infer<typeof ConfigurationObjectLinkDbModel>[];
  functions: FunctionConfig[];
}) {
  const router = useRouter();
  const existingLink = router.query.id ? links.find(link => link.id === router.query.id) : undefined;

  assertTrue(streams.length > 0, `Streams list is empty`);
  assertTrue(destinations.length > 0, `Destinations list is empty`);

  const [loading, setLoading] = useState(false);
  const workspace = useWorkspace();
  const [dstId, setDstId] = useState(existingLink?.toId || destinations[0].id);
  const [srcId, setSrcId] = useState(existingLink?.fromId || streams[0].id);

  const destination = requireDefined(
    destinations.find(d => d.id === dstId),
    `Destination ${dstId} not found in ${destinations.map(d => d.id).join(", ")}`
  );
  const destinationType = getCoreDestinationType(destination.destinationType);
  const connectionOptionsZodType = destinationType.connectionOptions;

  const [connectionOptions, setConnectionOptions] = useState<ConnectionOptionsType>(
    connectionOptionsZodType.parse(existingLink?.data || {})
  );

  //Once destination is changed, we need to update default connection options
  const updateConnectionOptions = (selectedDestination: string) => {
    const destination = requireDefined(
      destinations.find(d => d.id === selectedDestination),
      `Destination ${selectedDestination} not found in ${destinations.map(d => d.id).join(", ")}`
    );
    const newConnectionOptions = getCoreDestinationType(destination.destinationType).connectionOptions.parse({});
    log.atDebug().log("Updating connection options to", newConnectionOptions);
    setConnectionOptions(newConnectionOptions);
  };

  const updateOptions: (patch: Partial<ConnectionOptionsType>) => void = patch => {
    log.atDebug().log("Patching connection options with", patch, " existing options", connectionOptions);
    setConnectionOptions({ ...connectionOptions, ...patch });
  };

  const [limitations, setLimitations] = useState<any>({});
  const reloadStore = useStoreReload();

  useEffect(() => {
    if (connectionOptionsZodType) {
      const description = connectionOptionsZodType.description;
      if (description) {
        try {
          const obj = JSON.parse(description);
          setLimitations(obj.limitations || {});
        } catch (e) {
          console.error(e);
        }
      } else {
        setLimitations({});
      }
    }
  }, [connectionOptionsZodType]);

  const configItems: EditorItem[] = [
    {
      name: existingLink ? "Select Source" : "Source",
      documentation: "Select destination to connect",
      component: <SourceSelector items={streams} selected={srcId} enabled={!existingLink} onSelect={setSrcId} />,
    },
    {
      name: existingLink ? "Select Destination" : "Destination",
      documentation: existingLink
        ? "You can't change destination of existing connection. Please create a new one"
        : "Select destination to connect",
      component: (
        <DestinationSelector
          items={destinations}
          selected={dstId}
          enabled={!existingLink}
          onSelect={id => {
            setDstId(id);
            updateConnectionOptions(id);
          }}
        />
      ),
    },
  ];
  if (hasZodFields(connectionOptionsZodType, "mode")) {
    configItems.push({
      name: "Sync Mode",
      documentation: (
        <>
          <p>
            <b>stream</b> mode sends data to destination as soon as it is received from source, however it's not
            scalable and not going to work for more that ~10 events per second. <br />
          </p>
          <p>
            <b>batch</b> mode sends data to destination in batches. It's scalable and recommended for most cases.
          </p>
        </>
      ),
      component: (
        <BatchOrStreamEditor
          value={connectionOptions.mode}
          limitations={limitations}
          onChange={mode => updateOptions({ mode })}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "mode") && connectionOptions.mode === "batch") {
    configItems.push({
      name: "Sync Frequency",
      component: (
        <SyncFrequencyEditor
          value={connectionOptions.frequency || 60}
          onChange={frequency => updateOptions({ frequency })}
        />
      ),
    });
    configItems.push({
      name: "Max Batch Size",
      documentation: (
        <>
          Maximum number of events to send in one batch. If there are more events in queue than 'Batch Size', events
          will be sent as a consequence of batches with provided size.
        </>
      ),
      component: (
        <InputNumber
          value={connectionOptions.batchSize || 10000}
          size="small"
          defaultValue={10000}
          className="w-36"
          min={100}
          max={destinationType.id === "mixpanel" ? 500 : 1000000}
          onChange={batchSize => updateOptions({ batchSize: batchSize ?? 10000 })}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "dataLayout")) {
    configItems.push({
      documentation: <>Data layout defines how data is written to database</>,
      name: "Data Layout",
      component: (
        <DataLayoutEditor
          fileStorage={destinationType.id === "gcs" || destinationType.id === "s3"}
          onChange={dataLayout => updateOptions({ dataLayout })}
          value={connectionOptions.dataLayout || "segment-single-table"}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "primaryKey")) {
    configItems.push({
      group: "Advanced",
      name: "Primary Key",
      documentation: (
        <>
          The unique field that should present in any event. In case of duplicated values, the new event will either
          replace the old one or be dropped as 'failed' event depending on 'Deduplicate' option. Don't change this field
          unless you know what you are doing.
          <br />
          <br />
          Keep in mind that for data warehouses, all field names get translated to <b>snake_case</b>. For example,{" "}
          <code>messageId</code> get translated to <code>message_id</code>.
        </>
      ),
      component: (
        <TextEditor
          className="max-w-xs"
          value={connectionOptions.primaryKey}
          onChange={primaryKey => {
            updateOptions({ primaryKey, ...(primaryKey === "" ? { deduplicate: false } : {}) });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "deduplicate")) {
    configItems.push({
      group: "Advanced",
      name: "Deduplicate",
      documentation: (
        <>
          Deduplicate events with repeated values of 'Primary Key'. If enabled, the new event with the same 'Primary
          Key' value will replace the old one. If disabled, the new event will be dropped as 'failed' event.
        </>
      ),
      component: (
        <SwitchComponent
          className="max-w-xs"
          disabled={connectionOptions.primaryKey === ""}
          value={connectionOptions.deduplicate}
          onChange={deduplicate => {
            let functions = connectionOptions.functions ?? [];
            if (!deduplicate) {
              // remove user recognition function when deduplication is disabled
              functions = functions.filter(f => f.functionId !== "builtin.transformation.user-recognition");
            }
            updateOptions({ deduplicate, functions });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "deduplicateWindow") && destinationType.id === "bigquery") {
    configItems.push({
      group: "Advanced",
      documentation: (
        <>
          Limits date range on which deduplication is performed by reducing lookup to historic data. In BigQuery that
          means that only data from partitions that are in that range will be processed for deduplication. That may
          significantly reduce cost of data processing during inserting batches with 'Deduplicate' option. 'Timestamp
          Column' is used as a parameter that defines date range.
        </>
      ),
      name: "Deduplicate Window",
      component: (
        <InputNumber
          value={connectionOptions.deduplicateWindow || 31}
          disabled={
            connectionOptions.primaryKey === "" ||
            !connectionOptions.deduplicate ||
            connectionOptions.timestampColumn === ""
          }
          size="small"
          defaultValue={31}
          className="w-36"
          min={1}
          max={1000000}
          onChange={deduplicateWindow => updateOptions({ deduplicateWindow: deduplicateWindow ?? 31 })}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "timestampColumn")) {
    configItems.push({
      group: "Advanced",
      documentation: (
        <>The field that represents timestamp. Depending on database, the field might be used to partition data</>
      ),
      name: "Timestamp Column",
      component: (
        <TextEditor
          className="max-w-xs"
          value={connectionOptions.timestampColumn}
          onChange={timestampColumn => {
            updateOptions({ timestampColumn });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "functions", "deduplicate") && !limitations?.identityStitchingDisabled) {
    configItems.push({
      group: "Advanced",
      documentation: (
        <>
          Identity Stitching Function retroactively updates data rows of anonymous user events with userId and traits as
          soon as user sings in. For correct work 'Deduplicate' option must be enabled.
        </>
      ),
      name: "Identity Stitching",
      component: (
        <SwitchComponent
          disabled={connectionOptions.primaryKey === "" || !connectionOptions.deduplicate}
          className="max-w-xs"
          value={
            typeof (connectionOptions.functions ?? []).find(
              f => f.functionId === "builtin.transformation.user-recognition"
            ) !== "undefined"
          }
          onChange={ur => {
            const f = (connectionOptions.functions ?? []).filter(
              f => f.functionId !== "builtin.transformation.user-recognition"
            );
            if (ur) {
              f.push({
                functionId: "builtin.transformation.user-recognition",
              });
            }
            updateOptions({ functions: f });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "schemaFreeze") && existingLink) {
    configItems.push({
      group: "Advanced",
      documentation: (
        <>
          By default, Jitsu automatically creates table columns for any new properties in events. If your table is
          already in desired state and you want to control further table schema changes you can enable{" "}
          <b>Schema Freeze</b>
          <br />
          With <b>Schema Freeze</b> enabled Jitsu will no longer apply changes to table schema, but incoming data for
          any properties that don't have corresponding columns will be stored in <code>_unmapped_data</code> column in
          JSON format.
        </>
      ),
      name: "Schema Freeze",
      component: (
        <SwitchComponent
          className="max-w-xs"
          value={connectionOptions.schemaFreeze}
          onChange={sf => {
            updateOptions({ schemaFreeze: sf });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "events")) {
    configItems.push({
      documentation: (
        <>
          Events that trigger tag insertion. Base events <code>page</code>, <code>identify</code>, <code>group</code>,{" "}
          <code>track</code>, and custom event names used with <code>track</code> call can be provided.
          <br />
          One per line
        </>
      ),
      name: "Events Allowlist",
      component: (
        <TextEditor
          className="max-w-xs"
          rows={5}
          value={connectionOptions.events}
          onChange={events => {
            updateOptions({ events });
          }}
        />
      ),
    });
  }
  if (hasZodFields(connectionOptionsZodType, "hosts")) {
    configItems.push({
      documentation: (
        <>
          Hosts on witch tag will be inserted. You can use a wildcard as in <code>*.domain.com</code>. To include domain
          and all subdomain add two entries: <code>*.domain.com</code> and <code>domain.com</code>
          <br />
          One per line
          <br />
          Use * for all hosts
        </>
      ),
      name: "Hosts Allowlist",
      component: (
        <TextEditor
          className="max-w-xs"
          rows={3}
          value={connectionOptions.hosts}
          onChange={hosts => {
            updateOptions({ hosts });
          }}
        />
      ),
    });
  }
  // if (hasZodFields(connectionOptionsZodType, "multithreading")) {
  //   configItems.push({
  //     group: "Advanced",
  //     documentation: (
  //       <>
  //         Use multiple threads to send data to the endpoint. Faster, but doesn't guarantee order of events. Recommended
  //         on high volumes of data.
  //       </>
  //     ),
  //     name: "Multithreading",
  //     component: (
  //       <SwitchComponent
  //         className="max-w-xs"
  //         value={connectionOptions.multithreading}
  //         onChange={m => {
  //           updateOptions({ multithreading: m });
  //         }}
  //       />
  //     ),
  //   });
  // }
  return (
    <div className="max-w-5xl grow">
      <div className="flex justify-between pt-6 pb-0 mb-0 items-center">
        <h1 className="text-3xl">{(existingLink ? "Edit" : "Create") + " connection"}</h1>
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
        <Expandable
          initiallyExpanded={!!connectionOptions.functions?.length}
          title={<h2 className="font-bold my-4 text-xl text-textDark">Functions</h2>}
          hideArrow={false}
          caretSize="1.5em"
          contentLeftPadding={false}
        >
          <FunctionsSelector
            functions={functions}
            stream={streams.find(s => s.id === srcId) || streams[0]}
            destination={destinations.find(d => d.id === dstId) || destinations[0]}
            selectedFunctions={connectionOptions.functions}
            onChange={enabledFunctions => {
              updateOptions({ functions: enabledFunctions.map(f => ({ functionId: `udf.${f.id}` })) });
            }}
          />
        </Expandable>
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
                if (await confirmOp("Are you sure you want to unlink this site from this destination?")) {
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
                    feedbackError("Failed to unlink site and destination", { error: e });
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
          <Button
            type="primary"
            ghost
            size="large"
            disabled={loading}
            onClick={() => {
              if (router.query.backTo) {
                router.push(`/${workspace.id}${router.query.backTo}`);
              } else {
                router.back();
              }
            }}
          >
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
                  body: {
                    ...(existingLink ? { id: existingLink.id } : {}),
                    fromId: srcId,
                    toId: dstId,
                    type: "push",
                    data: connectionOptions,
                  },
                });
                await reloadStore();
                if (router.query.backTo) {
                  router.push(`/${workspace.id}${router.query.backTo}`);
                } else {
                  router.back();
                }
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

export default ConnectionEditor;
