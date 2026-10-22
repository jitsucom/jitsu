// Fixed, value-free messages shared with the runner's failure allowlist. Never interpolate row data or schema issues.
export const openAiConversionValidationErrors = {
  identifier:
    "A customer identifier is invalid. Check email, phone (8-15 digits including the country code), external ID and name values, and the raw versus SHA-256 columns.",
  userList: "Each customer identifier can have at most 3 distinct values per event.",
  eventType: "Provide a Default event type or map Event type.",
  customEventName:
    "Custom events need a custom event name of 1-64 letters, digits, _ or -, starting and ending with a letter or digit and not matching a standard event name.",
  eventTime:
    "Event time must be a timestamp with a timezone (for example 2026-10-21T11:00:00Z or a PostgreSQL timestamptz) or Unix milliseconds, within the last 7 days and no more than 10 minutes ahead. OpenAI rejects a whole batch otherwise.",
  sourceUrl:
    'Source URL must include a scheme and host, for example https://shop.example.com/checkout, and is required when Action source is "web".',
  actionSource: "App events require the mobile_app action source.",
  amount:
    "Amount must be a whole number in the currency's minor unit (for example 4200 for $42.00) and needs a three-letter Currency.",
  contents: "Contents are not allowed for customer_action events.",
  planId: "Plan ID is only allowed for subscription_created, trial_started and custom events.",
  location: "Country must be a two-letter code and postal code at most 32 letters, digits, spaces or hyphens.",
} as const;

export function invalidOpenAiConversion(reason: keyof typeof openAiConversionValidationErrors): never {
  throw new Error(`Invalid OpenAI conversion: ${openAiConversionValidationErrors[reason]}`);
}

// Audience rows. Same rule: fixed, value-free text shared with the runner's failure allowlist.
export const openAiAudienceValidationErrors = {
  identifier:
    "A member identifier is invalid. Check email, phone (E.164 with the country code, 8-15 digits) and Android advertising ID (a hyphenated UUID), and the raw versus SHA-256 columns.",
  noIdentifier: "Each member needs at least one identifier: map Email, Phone or Android advertising ID.",
} as const;

export function invalidOpenAiAudience(reason: keyof typeof openAiAudienceValidationErrors): never {
  throw new Error(`Invalid OpenAI audience member: ${openAiAudienceValidationErrors[reason]}`);
}
