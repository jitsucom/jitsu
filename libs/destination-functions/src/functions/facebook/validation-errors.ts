// Fixed, value-free messages shared with the runner's failure allowlist. Never interpolate row data or schema issues.
export const metaConversionValidationErrors = {
  userData: "Map at least one customer identifier, such as Email, Phone or External / CRM ID.",
  sourceUrl: 'Event source URL is required when Action source is "website". Map a column to Event source URL.',
  userAgent: 'Client user agent is required when Action source is "website". Map a column to Client user agent.',
  eventName: "Provide a Default event name or map Event name; it must contain at most 256 characters.",
  eventTime:
    "Event time must be Unix seconds or an ISO timestamp with a timezone, not milliseconds or a local timestamp.",
  purchaseValue: "Purchase events require Value. Map a column to Value or include value in Custom data.",
  purchaseCurrency: "Purchase events require Currency. Map a column to Currency or include currency in Custom data.",
  messagingChannel: "Business messaging events require Messaging channel: messenger, whatsapp or instagram.",
  messenger: "Messenger events require Facebook Page ID and Page-scoped user ID mappings.",
  whatsapp: "WhatsApp events require WhatsApp Business Account ID and Click-to-WhatsApp ID mappings.",
  instagram: "Instagram messaging events require Instagram business account ID and Instagram-scoped user ID mappings.",
  privacy:
    "LDU requires Data processing country and, unless Meta can infer it from the client IP, Data processing state.",
  appData:
    "App events require App data with advertiser_tracking_enabled and application_tracking_enabled (0 or 1), and 16 extinfo entries starting with i2 or a2.",
} as const;

export function invalidMetaConversion(reason: keyof typeof metaConversionValidationErrors): never {
  throw new Error(`Invalid Meta conversion: ${metaConversionValidationErrors[reason]}`);
}
