import type {
  ReverseEditorAlternative,
  ReverseEditorField,
  ReverseEditorOptions,
} from "@jitsu/protocols/reverse-etl-editor";
import { alternative, editorFieldKey, mappingKey, settingKey, withFieldRules } from "../../reverse-etl/editor";

const action = (o: ReverseEditorOptions) => o.streamOptions.actionSource ?? "website";
const fixedAction = (o: ReverseEditorOptions, value: string) => !o.mapping.actionSource && action(o) === value;
const possibleAction = (o: ReverseEditorOptions, value: string) => !!o.mapping.actionSource || action(o) === value;

export function metaMatchingAlternatives(fields: ReverseEditorField[], audience: boolean): ReverseEditorAlternative {
  const extras = audience
    ? ["externalId", "mobileAdvertisingId", "pageScopedUserId"]
    : [
        "clientIpAddress",
        "fbc",
        "fbp",
        "subscriptionId",
        "facebookLoginId",
        "leadId",
        "mobileAdvertisingId",
        "anonymousId",
        "pageScopedUserId",
        "ctwaClid",
        "instagramScopedId",
      ];
  return {
    key: "matching",
    title: "Customer matching",
    description:
      "Map at least one matching identifier. More identifiers can improve matching. Configured mappings do not guarantee non-empty or valid values in every row.",
    options: fields
      .filter(field => field.editor === "identifier" || (field.editor === "mapping" && extras.includes(field.field)))
      .map(field => ({ label: field.name!, fields: [editorFieldKey(field)] })),
  };
}

export function metaConversionAlternatives(
  options: ReverseEditorOptions,
  fields: ReverseEditorField[]
): ReverseEditorAlternative[] {
  return [
    {
      key: "action-source",
      title: "Action source",
      beforeRequired: true,
      description:
        "Choose a default for all events, or map a column to override it per row. Missing or null column values use the default. Each row must satisfy the requirements of its effective action source.",
      options: [
        { label: "Default action source", fields: [settingKey("Default action source")] },
        alternative("Action source column", "actionSource"),
      ],
    },
    {
      key: "channel",
      title: "Messaging channel",
      beforeRequired: true,
      when: o => possibleAction(o, "business_messaging"),
      condition: options.mapping.actionSource ? "For business_messaging rows" : undefined,
      description:
        "Choose a default or map a channel column. Messenger requires Facebook Page ID and Page-scoped user ID; WhatsApp requires WhatsApp Business Account ID and Click-to-WhatsApp ID; Instagram requires Instagram business account ID and Instagram-scoped user ID. With a fixed action source and channel, these fields appear in Required fields; mapped sources or channels are checked per row.",
      options: [
        { label: "Default messaging channel", fields: [settingKey("Default messaging channel")] },
        alternative("Messaging channel column", "messagingChannel"),
      ],
    },
    {
      key: "event",
      title: "Event name",
      beforeRequired: true,
      options: [
        { label: "Default event name", fields: [settingKey("eventName")] },
        alternative("Event name column", "eventName"),
      ],
    },
    metaMatchingAlternatives(fields, false),
    {
      key: "purchase",
      title: "Purchase value and currency",
      when: o => !!o.mapping.eventName || o.streamOptions.eventName === "Purchase",
      condition: options.mapping.eventName ? "For Purchase rows" : undefined,
      description:
        "Value and currency may come from explicit mappings, custom data, or a combination. Explicit non-null mappings override custom data; the JSON contents are checked during the run.",
      options: [
        alternative("Value AND currency columns", "value", "currency"),
        ...(options.objectMappings?.customData
          ? options.objectMappings.customData.value || options.objectMappings.customData.currency
            ? [
                alternative(
                  "Composed custom data and any remaining explicit fields",
                  "customData",
                  ...["value", "currency"].filter(key => !options.objectMappings?.customData?.[key])
                ),
              ]
            : []
          : [alternative("Custom data containing value and/or currency", "customData")]),
      ],
    },
  ];
}

export function metaConversionRules(fields: ReverseEditorField[]): ReverseEditorField[] {
  const channelRequired = (channel: string) => (o: ReverseEditorOptions) =>
    fixedAction(o, "business_messaging") && !o.mapping.messagingChannel && o.streamOptions.messagingChannel === channel;
  return withFieldRules(fields, {
    "setting:pixelId": { required: true },
    "setting:Default messaging channel": {
      requirement: "Used for business_messaging rows when no messaging channel is supplied by the model.",
    },
    "mapping:messagingChannel": {
      requirement: "Required for business_messaging rows unless a default messaging channel is selected.",
    },
    "mapping:eventSourceUrl": { required: o => fixedAction(o, "website"), requirement: "Required for website rows." },
    "mapping:clientUserAgent": {
      required: o => fixedAction(o, "website"),
      requirement: "Required for website rows; not sufficient as a matching identifier on its own.",
    },
    "mapping:appData": {
      required: o => fixedAction(o, "app"),
      requirement: "Required for app rows, including tracking flags and all 16 extinfo positions.",
    },
    ...Object.fromEntries(
      [
        ["messenger", "pageId", "pageScopedUserId"],
        ["whatsapp", "whatsappBusinessAccountId", "ctwaClid"],
        ["instagram", "instagramAccountId", "instagramScopedId"],
      ].flatMap(([channel, ...keys]) =>
        keys.map(key => [
          mappingKey(key),
          {
            required: channelRequired(channel),
            // These identifiers may also be useful outside messaging; don't hide them for other action sources.
            requirement: `Required for business_messaging / ${channel} rows, together with ${keys
              .filter(k => k !== key)
              .join(", ")}.`,
          },
        ])
      )
    ),
    "mapping:dataProcessingCountry": { requirement: "Required when a row's data processing options include LDU." },
    "mapping:dataProcessingState": {
      requirement: "Required for LDU rows unless country is 0 and a client IP address is supplied.",
    },
  });
}
