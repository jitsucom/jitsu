import { z } from "zod";
import { openAiHashes } from "./identifiers";
import { invalidOpenAiConversion } from "./validation-errors";

// Event-time and customer-object mapping shared by Reverse ETL rows and event-stream events.
const dayMs = 24 * 60 * 60 * 1000;
const isoEventTime = z.string().datetime({ offset: true });
// Warehouse readers keep timestamps as text: PostgreSQL and Redshift `2026-10-21 16:30:00.123456+05:30` (offset may be
// `+00` or `+0530`), Snowflake `2026-10-21 11:00:00.123456789 +00:00`. Only a text with an explicit offset is taken.
const zonedEventTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?) ?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Rewrites a reader's zoned timestamp text as ISO 8601; any other text is returned unchanged. */
function isoFromZoned(value: string): string {
  const m = zonedEventTime.exec(value.trim());
  if (!m) return value;
  const [, date, time, zone] = m;
  const offset = zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(3).replace(":", "") || "00"}`;
  return `${date}T${time}${offset}`;
}

/** OpenAI wants Unix milliseconds within the last 7 days and at most 10 minutes ahead; anything else fails the batch. */
export function eventTimeMs(value: unknown, now: number): number {
  if (value == null) return now;
  let ms: number;
  let numeric = false;
  if (typeof value === "number") {
    ms = value;
    numeric = true;
  } else if (typeof value === "string" && /^\d{1,16}$/.test(value.trim())) {
    ms = Number(value.trim());
    numeric = true;
  } else if (typeof value === "string" && isoEventTime.safeParse(isoFromZoned(value)).success) {
    ms = Date.parse(isoFromZoned(value));
  } else return invalidOpenAiConversion("eventTime");
  if (!Number.isSafeInteger(ms)) invalidOpenAiConversion("eventTime");
  // A seconds-sized number would silently become January 1970: refuse it instead of guessing the unit.
  if (numeric && ms < 1e11) invalidOpenAiConversion("eventTime");
  if (ms < now - 7 * dayMs || ms > now + 10 * 60 * 1000) invalidOpenAiConversion("eventTime");
  return ms;
}

function list(values: string[], max = 3): string[] {
  const unique = [...new Set(values)];
  if (unique.length > max) invalidOpenAiConversion("userList");
  return unique;
}
function words(value: unknown, transform: (v: string) => string, max = 128): string[] {
  if (value == null || value === "") return [];
  return list(
    (Array.isArray(value) ? value : [value])
      .filter(v => v != null && v !== "")
      .map(v => transform(String(v)))
      .filter(v => {
        if (v.length > max) invalidOpenAiConversion("location");
        return v.length > 0;
      })
      .sort()
  );
}
export function userObject(row: Record<string, any>): Record<string, unknown> {
  const user: Record<string, unknown> = {};
  const put = (key: string, values: string[]) => {
    if (values.length) user[key] = list(values);
  };
  put("emails_sha256", openAiHashes(row, "email", "hashedEmail"));
  put("phone_numbers_sha256", openAiHashes(row, "phone", "hashedPhone"));
  put("external_ids_sha256", openAiHashes(row, "externalId", "hashedExternalId"));
  put("first_names_sha256", openAiHashes(row, "firstName", "hashedFirstName"));
  put("last_names_sha256", openAiHashes(row, "lastName", "hashedLastName"));
  put(
    "regions",
    words(row.region, v => v.trim().toLowerCase())
  );
  put(
    "cities",
    words(row.city, v => v.trim().toLowerCase())
  );
  put(
    "postal_codes",
    words(
      row.postalCode,
      v => {
        const postal = v.trim();
        if (postal && !/^[A-Za-z0-9 -]{1,32}$/.test(postal)) invalidOpenAiConversion("location");
        return postal;
      },
      32
    )
  );
  put(
    "countries",
    words(row.country, v => {
      const country = v.trim().toUpperCase();
      if (country && !/^[A-Z]{2}$/.test(country)) invalidOpenAiConversion("location");
      return country;
    })
  );
  if (row.androidAdvertisingId) user.android_advertising_id = row.androidAdvertisingId;
  if (row.obref) user.obref = row.obref;
  if (row.ipAddress) user.ip_address = row.ipAddress;
  if (row.userAgent) user.user_agent = row.userAgent;
  return user;
}
