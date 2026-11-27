import { z } from "zod";

/**
 * An ISO 8601 datetime string, accepted exactly as zod 3's `z.string().datetime()` accepted it.
 *
 * zod 4's native `datetime()` is stricter and rejects values that zod 3 took and that the destination code goes on to
 * parse (`Date.parse`) and normalize without trouble: minute precision (`2026-11-27T14:30Z`) and offsets without a
 * colon (`+0000`, `-0530`). A source row with such a value would have started to fail a Reverse ETL run, and an MCP
 * client sending one would have started to get an error. This is zod 3's own regex, copied from its source.
 *
 * `offset: true` also allows a `+hh:mm` / `+hhmm` offset; without it only `Z` is accepted. The result carries
 * `format: "date-time"` so generated JSON schemas keep describing it as a date-time.
 */
export function isoDateTime(options: { offset?: boolean } = {}) {
  return z
    .string()
    .regex(options.offset ? datetimeWithOffset : datetimeUtc, "Invalid datetime")
    .meta({ format: "date-time" });
}

// zod 3 (v3/types.js): a calendar-aware date, `T`, time with optional seconds and fraction, then `Z` or an offset
const dateSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
const timeSource = `([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?`;
const datetimeUtc = new RegExp(`^${dateSource}T${timeSource}(Z)$`);
const datetimeWithOffset = new RegExp(`^${dateSource}T${timeSource}(Z|([+-]\\d{2}:?\\d{2}))$`);
