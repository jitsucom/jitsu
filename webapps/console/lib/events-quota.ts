/**
 * Monthly destination-events quota of a plan, read from either spelling of the
 * key. The key was originally misspelt as `destinationEvensPerMonth` and that
 * spelling is what every stored plan uses; the billing service now also
 * accepts the correct `destinationEventsPerMonth` (JITSU-200) and emits both
 * keys with the same value wherever it normalizes plan data. Raw `plan_data`
 * (the quote page reads it straight from the product) is NOT normalized, so
 * anything reading plan data directly must go through this helper.
 *
 * The correct spelling wins when both are present. Only a real JSON number
 * counts, matching the billing service: a quoted number (easy to produce when
 * hand-editing plan_data in Stripe) is a misconfiguration the billing service
 * treats as "no quota", and rendering it as a quota here would hide that.
 */
export function monthlyEventsQuota(data: Record<string, unknown> | null | undefined): number | undefined {
  const raw = data?.destinationEventsPerMonth ?? data?.destinationEvensPerMonth;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}
