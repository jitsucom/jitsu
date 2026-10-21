import type {
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";
import { maxRequestBytesLabel, webhookDestinationType, WebhookRowsOptions, webhookStreamId } from "./reverse-meta";

/** A failed run re-sends up to this many rows, so the default is lower than the platform's 50,000. */
export const webhookCheckpointEvery = 5000;

export const webhookRowsEditor: ReverseStreamEditor = {
  id: webhookStreamId,
  label: "Rows",
  settings: WebhookRowsOptions,
  checkpointEvery: webhookCheckpointEvery,
  defaults: () => ({
    mode: "upsert",
    mapping: {},
    streamOptions: { recordsPerRequest: 50, concurrency: 2, deliveryAttested: false },
  }),
  fields(options: ReverseEditorOptions) {
    const settings = options.streamOptions;
    const change = (patch: Record<string, unknown>) => ({ streamOptions: { ...settings, ...patch } });
    const fields: ReverseEditorField[] = [
      {
        editor: "columns",
        required: true,
        name: "Payload",
        documentation:
          "JSON POST body: {syncId, runId, sentAt, records:[{operation, key, idempotencyKey, data}]}. Every selected model column is included in data; rename or reshape fields in SQL. Binary becomes base64, intervals become ISO 8601 durations, and NaN/Infinity become strings.",
      },
      {
        name: "Records per request",
        editor: "number",
        min: 1,
        max: 200,
        documentation: `Each request is at most ${maxRequestBytesLabel}; a single row larger than that is rejected.`,
        value: Number(settings.recordsPerRequest ?? 50),
        change: value => change({ recordsPerRequest: value ?? 50 }),
      },
      {
        name: "Concurrent requests",
        editor: "number",
        min: 1,
        max: 10,
        value: Number(settings.concurrency ?? 2),
        change: value => change({ concurrency: value ?? 2 }),
      },
      {
        name: "Repeated delivery",
        required: true,
        editor: "checkbox",
        label: "My endpoint tolerates receiving the same record more than once",
        value: settings.deliveryAttested === true,
        documentation:
          "Delivery is at least once. Use each record's idempotencyKey to ignore repeats after failures or restarts. A rejected record stops the run and is sent again on the next run.",
        change: value => change({ deliveryAttested: value }),
      },
      {
        name: "Unencrypted HTTP",
        required: options => options.destination?.protocol === "http:",
        hidden: options => options.destination?.protocol === "https:",
        editor: "checkbox",
        label: "I accept sending data over unencrypted http://",
        value: settings.allowInsecureHttp === true,
        documentation:
          "With http://, rows and header credentials travel unencrypted. Use https:// whenever possible; HTTPS does not need this acknowledgment.",
        change: value => change({ allowInsecureHttp: value }),
      },
    ];
    return fields;
  },
};

export const webhookMetadata = {
  id: webhookDestinationType,
  displayName: "Webhook",
  streams: [webhookRowsEditor],
};
