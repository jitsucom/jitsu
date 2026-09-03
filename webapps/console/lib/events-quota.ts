/**
 * Monthly destination-events quota of a plan, read from either spelling of the
 * key. The key was originally misspelt as `destinationEvensPerMonth` and that
 * spelling is what every stored plan uses; the billing service now also
 * accepts the correct `destinationEventsPerMonth` (JITSU-200) and emits both
 * keys with the same resolved value wherever it normalizes plan data. Raw
 * `plan_data` (the quote page reads it straight from the product) is NOT
 * normalized, so anything reading plan data directly must go through here.
 *
 * Mirrors the billing service's own resolution: the correct spelling wins when
 * it holds a real number, otherwise the legacy one, otherwise there is no
 * quota. Only a real JSON number counts — a quoted number, easy to produce
 * when hand-editing plan_data in Stripe, is skipped rather than coerced, so
 * the console never shows a quota the billing service is not metering. An
 * explicit 0 is a real (if misconfigured) quota and wins.
 */
export function monthlyEventsQuota(data: Record<string, unknown> | null | undefined): number | undefined {
  for (const raw of [data?.destinationEventsPerMonth, data?.destinationEvensPerMonth]) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return undefined;
}
