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
        editor: "notice",
        name: "How delivery works",
        showIcon: true,
        title: "Rows are sent as JSON with POST requests",
        description:
          "Each request carries up to the records-per-request limit as {syncId, runId, sentAt, records:[{operation, key, idempotencyKey, data}]}. " +
          "Delivery is at least once: after a failure or a restart the same records are sent again with the same idempotency keys, so your endpoint must tolerate repeats. " +
          "If your endpoint rejects a record the run stops at that record, and the next run sends it again. " +
          `A request is at most ${maxRequestBytesLabel}; a single row larger than that is rejected. ` +
          "Values that are not plain JSON are converted: binary to base64, intervals to ISO 8601 durations, NaN and Infinity to strings. " +
          "Use https:// URLs: with http:// the rows and any header credentials travel unencrypted.",
      },
      {
        editor: "columns",
        name: "Payload",
        documentation:
          "Every column the model selects is sent under its own name. To rename or reshape a field, change the model's SQL (for example SELECT user_id AS id).",
      },
      {
        name: "Records per request",
        editor: "number",
        min: 1,
        max: 200,
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
        editor: "checkbox",
        label: "My endpoint tolerates receiving the same record more than once",
        value: settings.deliveryAttested === true,
        documentation: "Required. Use the idempotencyKey in each record to ignore repeats.",
        change: value => change({ deliveryAttested: value }),
      },
      {
        name: "Unencrypted HTTP",
        editor: "checkbox",
        label: "I accept sending data over unencrypted http://",
        value: settings.allowInsecureHttp === true,
        documentation: "Only needed when the destination's URL starts with http://. https:// URLs do not need it.",
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
