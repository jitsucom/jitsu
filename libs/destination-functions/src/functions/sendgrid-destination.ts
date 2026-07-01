import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { SendgridCredentials } from "../meta";
import { RetryError } from "@jitsu/functions-lib";
import { jsonFetcher, JsonFetcher, JsonFetchError } from "@jitsu/core-functions-lib";
import {
  classifyError,
  decodeManagedIds,
  desiredTargetNames,
  encodeManagedIds,
  getTraits,
  resolveEmail,
  splitName,
  stringifyValue,
  userEmailCacheKey,
} from "./lib/contacts";

const DEFAULT_SENDGRID_API = "https://api.sendgrid.com";
const SENDGRID_EU_API = "https://api.eu.sendgrid.com";

// Custom field that records which lists the connector added the contact to — the source of truth for
// reconciliation, so we only remove lists we added ourselves. Stored on the contact in SendGrid.
const MANAGED_LISTS_FIELD = "jitsu_managed_lists";
// Per-event trait that overrides the configured lists (comma-separated names).
const LISTS_TRAIT = "sendgridLists";
const FIELD_MAP_KEY = "sendgrid:field-map";
const LIST_NAME_MAP_KEY = "sendgrid:list-name-map";

type ExtendedCtx = FullContext<SendgridCredentials> & {
  jsonFetch: JsonFetcher;
};

// SendGrid field definitions (reserved + custom) cached in the store; refreshed when a new custom field
// has to be created or after the TTL expires.
type FieldMap = { reservedWritable: string[]; custom: Record<string, string> };

// Trait keys handled explicitly and never turned into SendGrid custom fields.
const reservedTraitKeys = new Set(["email", "name", "firstname", "lastname", LISTS_TRAIT.toLowerCase()]);

function apiBase(props: SendgridCredentials): string {
  return props.apiBase || (props.region === "EU" ? SENDGRID_EU_API : DEFAULT_SENDGRID_API);
}

function authHeaders(props: SendgridCredentials): Record<string, string> {
  return { Authorization: `Bearer ${props.apiKey}` };
}

async function loadFieldMap(ctx: ExtendedCtx): Promise<FieldMap> {
  const cached = (await ctx.store.get(FIELD_MAP_KEY)) as FieldMap | undefined;
  if (cached) {
    return cached;
  }
  let resp: any;
  try {
    resp = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/field_definitions`, {
      method: "GET",
      headers: authHeaders(ctx.props),
    });
  } catch (e) {
    // Wrap so a transient 429/5xx becomes a RetryError (only RetryError participates in Rotor's retry).
    throw classifyError("SendGrid: failed to load field definitions", e);
  }
  const map: FieldMap = {
    reservedWritable: (resp?.reserved_fields || []).filter((f: any) => !f.read_only).map((f: any) => f.name),
    custom: Object.fromEntries((resp?.custom_fields || []).map((f: any) => [f.name, f.id])),
  };
  await ctx.store.set(FIELD_MAP_KEY, map, "1h");
  return map;
}

// Ensure a custom field definition exists and return its id (or undefined if it couldn't be created,
// e.g. the name collides with a reserved field). Custom fields are created as Text; values are strings.
// `report.created` is set true when a brand-new definition was POSTed this call (the caller then defers
// the contact write — a just-created field isn't immediately usable, failing the PUT sync or async).
async function ensureCustomField(
  name: string,
  map: FieldMap,
  ctx: ExtendedCtx,
  report: { created: boolean }
): Promise<string | undefined> {
  if (map.custom[name]) {
    return map.custom[name];
  }
  try {
    const created = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/field_definitions`, {
      method: "POST",
      headers: authHeaders(ctx.props),
      body: { name, field_type: "Text" },
    });
    if (created?.id) {
      map.custom[name] = created.id;
      await ctx.store.set(FIELD_MAP_KEY, map, "1h");
      report.created = true;
      return created.id;
    }
  } catch (e) {
    // Permanent 4xx (e.g. the field already exists from a concurrent create) — refetch once to pick up
    // its id; if still not found, skip this one key rather than fail the whole write. 429/5xx fall
    // through to retry, so a transient failure never silently drops a field (incl. jitsu_managed_lists).
    if (e instanceof JsonFetchError && e.responseStatus < 500 && e.responseStatus !== 429) {
      const fresh = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/field_definitions`, {
        method: "GET",
        headers: authHeaders(ctx.props),
      });
      const found = (fresh?.custom_fields || []).find((f: any) => f.name === name);
      if (found?.id) {
        map.custom[name] = found.id;
        await ctx.store.set(FIELD_MAP_KEY, map, "1h");
        return found.id;
      }
      ctx.log.warn(`SendGrid: could not define custom field "${name}", skipping it: ${e.message}`);
      return undefined;
    }
    throw classifyError(`SendGrid: failed to create custom field "${name}"`, e);
  }
  return undefined;
}

// Resolve list names to ids, creating any that don't exist. The name→id map is a lookup cache (not
// membership state) refreshed from the API on a miss.
async function resolveListIds(names: string[], ctx: ExtendedCtx): Promise<string[]> {
  if (names.length === 0) {
    return [];
  }
  let map: Record<string, string> = (await ctx.store.get(LIST_NAME_MAP_KEY)) || {};
  if (names.some(n => !map[n])) {
    try {
      const resp = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/lists`, {
        method: "GET",
        headers: authHeaders(ctx.props),
      });
      map = {};
      for (const l of resp?.result || []) {
        if (l?.name) {
          map[l.name] = l.id;
        }
      }
    } catch (e) {
      throw classifyError("SendGrid: failed to list marketing lists", e);
    }
  }
  const ids: string[] = [];
  for (const name of names) {
    let id = map[name];
    if (!id) {
      try {
        const created = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/lists`, {
          method: "POST",
          headers: authHeaders(ctx.props),
          body: { name },
        });
        id = created?.id;
        if (id) {
          map[name] = id;
        }
      } catch (e) {
        // Don't swallow: a partial id set would make upsertContact's reconciliation remove memberships
        // that should stay. Transient errors retry the event; permanent ones surface.
        throw classifyError(`SendGrid: failed to resolve/create list "${name}"`, e);
      }
    }
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  await ctx.store.set(LIST_NAME_MAP_KEY, map, "1h");
  return ids;
}

// Look up a contact by email. Returns the SendGrid contact object (with id and custom_fields) or
// undefined if there's no match.
async function searchContact(email: string, ctx: ExtendedCtx): Promise<any | undefined> {
  try {
    const resp = await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/contacts/search/emails`, {
      method: "POST",
      headers: authHeaders(ctx.props),
      body: { emails: [email.toLowerCase()] },
    });
    return resp?.result?.[email.toLowerCase()]?.contact;
  } catch (e) {
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      return undefined;
    }
    throw classifyError(`SendGrid: failed to search for contact ${email}`, e);
  }
}

// Read the connector-managed list ids from a searched contact. NOTE: the search endpoint returns
// custom_fields keyed by field NAME (the PUT endpoint, by contrast, expects them keyed by field id).
function readManagedLists(contact: any): string[] {
  return decodeManagedIds(contact?.custom_fields?.[MANAGED_LISTS_FIELD]);
}

// Build a SendGrid contact object from the given trait bag. Reserved writable fields (first_name,
// city, …) are set top-level; everything else becomes a custom field (definitions auto-created).
async function buildContact(
  event: AnalyticsServerEvent,
  traits: Record<string, any>,
  map: FieldMap,
  ctx: ExtendedCtx
): Promise<{ contact: Record<string, any>; createdNewField: boolean }> {
  const report = { created: false };
  const email = resolveEmail(event);
  const contact: Record<string, any> = {
    ...(email ? { email } : {}),
    ...splitName(traits),
  };

  // Store the Jitsu userId/anonymousId as CUSTOM FIELDS, not SendGrid identifiers (external_id /
  // anonymous_id). Email is kept as the sole identifier: SendGrid rejects an upsert that omits any
  // identifier a matched contact already has ("provide all identifiers"), and Jitsu events don't
  // reliably carry the same anonymousId every time — so using them as identifiers breaks updates.
  const withIds: Record<string, any> = { ...traits };
  if (event.userId) {
    withIds.jitsu_user_id = String(event.userId);
  }
  if (event.anonymousId) {
    withIds.jitsu_anonymous_id = String(event.anonymousId);
  }

  const reserved = new Set(map.reservedWritable);
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(withIds)) {
    if (reservedTraitKeys.has(key.toLowerCase())) {
      continue;
    }
    const str = stringifyValue(value);
    if (str === undefined) {
      continue;
    }
    if (reserved.has(key)) {
      contact[key] = value;
    } else {
      const id = await ensureCustomField(key, map, ctx, report);
      if (id) {
        customFields[id] = str;
      }
    }
  }
  if (Object.keys(customFields).length > 0) {
    contact.custom_fields = customFields;
  }
  return { contact, createdNewField: report.created };
}

// PUT /v3/marketing/contacts upserts by email and (optionally) adds to lists — asynchronous, returns 202.
async function putContact(contact: Record<string, any>, listIds: string[], ctx: ExtendedCtx): Promise<void> {
  const body: Record<string, any> = { contacts: [contact] };
  if (listIds.length > 0) {
    body.list_ids = listIds;
  }
  try {
    await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/contacts`, {
      method: "PUT",
      headers: authHeaders(ctx.props),
      body,
    });
  } catch (e) {
    // A custom field definition created moments earlier isn't always immediately usable in a contacts
    // PUT (SendGrid propagates it asynchronously). Treat that specific 400 as transient so the event is
    // retried — by then the field has settled. Only bites the first event that introduces a new field.
    if (e instanceof JsonFetchError && e.responseStatus === 400 && /custom field/i.test(e.message)) {
      throw new RetryError(`SendGrid: newly created custom field not yet usable, will retry: ${e.message}`);
    }
    throw classifyError(`SendGrid: failed to upsert contact ${contact.email}`, e);
  }
}

async function removeFromList(listId: string, contactId: string, ctx: ExtendedCtx): Promise<void> {
  try {
    await ctx.jsonFetch(`${apiBase(ctx.props)}/v3/marketing/lists/${listId}/contacts?contact_ids=${contactId}`, {
      method: "DELETE",
      headers: authHeaders(ctx.props),
    });
  } catch (e) {
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      return;
    }
    throw classifyError(`SendGrid: failed to remove contact ${contactId} from list ${listId}`, e);
  }
}

// identify: upsert the contact and reconcile list membership to the desired set (adding new lists,
// removing previously-managed ones that are no longer listed).
async function upsertContact(event: AnalyticsServerEvent, ctx: ExtendedCtx): Promise<void> {
  const { log, props } = ctx;
  const email = resolveEmail(event);
  if (!email) {
    log.debug(`SendGrid: identify with userId=${event.userId} has no email, skipping (SendGrid requires an email)`);
    return;
  }

  const map = await loadFieldMap(ctx);
  const traits = { ...getTraits(event) };

  const desiredNames = desiredTargetNames(event, LISTS_TRAIT, props.lists);
  let desiredIds: string[] = [];
  let toRemove: string[] = [];
  let existing: any;
  if (desiredNames !== undefined) {
    desiredIds = await resolveListIds(desiredNames, ctx);
    // Read the contact to learn which lists we previously managed and to get its id for removals.
    existing = await searchContact(email, ctx);
    const managedBefore = readManagedLists(existing);
    toRemove = managedBefore.filter(id => !desiredIds.includes(id));
  }

  // The jitsu_managed_lists marker must only advance AFTER removals succeed — otherwise a transient
  // removal failure + retry would read the advanced marker, compute an empty toRemove, and never retry
  // the removal (leaving stale memberships). Include it in the initial PUT only when there's nothing to
  // remove; otherwise persist it in a follow-up PUT after the removals below.
  const deferMarker = desiredNames !== undefined && toRemove.length > 0;
  if (desiredNames !== undefined && !deferMarker) {
    traits[MANAGED_LISTS_FIELD] = encodeManagedIds(desiredIds);
  }

  const { contact, createdNewField } = await buildContact(event, traits, map, ctx);
  if (createdNewField) {
    // The definition was just created and isn't usable in this PUT yet — defer so it can propagate.
    // The retry finds the field cached (no re-create) and succeeds. Nothing has been written yet.
    throw new RetryError(`SendGrid: created a new custom field for ${email}, deferring upsert so it can propagate`);
  }
  await putContact(contact, desiredIds, ctx);
  log.debug(`SendGrid: upserted contact ${email}${desiredIds.length ? ` in lists ${desiredIds.join(",")}` : ""}`);

  if (toRemove.length && existing?.id) {
    for (const listId of toRemove) {
      await removeFromList(listId, existing.id, ctx);
    }
    log.debug(`SendGrid: removed contact ${email} from lists ${toRemove.join(",")}`);
    // Removals succeeded — only now advance the managed marker (a follow-up upsert with just the field).
    const { contact: markerContact, createdNewField: markerCreated } = await buildContact(
      { ...event, traits: {} } as AnalyticsServerEvent,
      { [MANAGED_LISTS_FIELD]: encodeManagedIds(desiredIds) },
      map,
      ctx
    );
    if (markerCreated) {
      throw new RetryError(`SendGrid: created jitsu_managed_lists field for ${email}, deferring marker write to retry`);
    }
    markerContact.email = email;
    await putContact(markerContact, [], ctx);
  }

  if (props.resolveEmailFromUserId && event.userId) {
    await ctx.store.set(userEmailCacheKey("sendgrid", String(event.userId)), email, "90d");
  }
}

// track/page/screen/group: update an existing contact only. Never creates (SendGrid PUT would upsert,
// so we search first and skip if the contact isn't there) and never touches list membership (managed
// by identify). Driven by fields explicitly set on the event.
async function updateContactFromEvent(event: AnalyticsServerEvent, ctx: ExtendedCtx): Promise<void> {
  const { log, props } = ctx;
  // For group events, event.traits are company attributes (which may include a company email), so the
  // contact must be resolved from the user's email (context.traits) or the userId cache — never from the
  // group's own traits.
  let email = event.type === "group" ? (event.context?.traits?.email as string | undefined) : resolveEmail(event);
  if (!email && props.resolveEmailFromUserId && event.userId) {
    email = await ctx.store.get(userEmailCacheKey("sendgrid", String(event.userId)));
  }
  if (!email) {
    log.debug(`SendGrid: ${event.type} event can't be linked to a contact (no email, no cached userId), skipping`);
    return;
  }

  // For group events fold the group id + traits into namespaced fields; otherwise use explicit event traits.
  const traits =
    event.type === "group"
      ? {
          ...(event.groupId ? { group_id: String(event.groupId) } : {}),
          ...Object.fromEntries(Object.entries(event.traits || {}).map(([k, v]) => [`group_${k}`, v])),
        }
      : event.traits || {};

  // Only fields explicitly set on the event drive an update — the ambient context.traits are ignored so
  // we don't re-write the contact on every event. Bail before any API call if there's nothing to update.
  const hasUsableField =
    !!(traits.name || traits.firstName || traits.lastName) ||
    Object.keys(traits).some(k => !reservedTraitKeys.has(k.toLowerCase()));
  if (!hasUsableField) {
    log.debug(`SendGrid: ${event.type} event for ${email} has no contact fields to update, skipping`);
    return;
  }

  if (!(await searchContact(email, ctx))) {
    log.debug(`SendGrid: contact ${email} not found; ${event.type} events don't create contacts, skipping`);
    return;
  }

  const map = await loadFieldMap(ctx);
  const { contact, createdNewField } = await buildContact(
    { ...event, traits: {} } as AnalyticsServerEvent,
    traits,
    map,
    ctx
  );
  if (createdNewField) {
    throw new RetryError(`SendGrid: created a new custom field for ${email}, deferring update so it can propagate`);
  }
  contact.email = email;
  await putContact(contact, [], ctx);
  log.debug(`SendGrid: updated contact ${email} from ${event.type} event`);
}

const SendgridDestination: JitsuFunction<AnalyticsServerEvent, SendgridCredentials> = async (event, ctx) => {
  const jsonFetch = jsonFetcher(ctx.fetch, { log: ctx.log, debug: true });
  const extendedCtx: ExtendedCtx = { ...ctx, jsonFetch };

  if (event.type === "identify") {
    await upsertContact(event, extendedCtx);
  } else if (event.type === "track" || event.type === "page" || event.type === "screen" || event.type === "group") {
    await updateContactFromEvent(event, extendedCtx);
  }
};

SendgridDestination.displayName = "sendgrid-destination";
SendgridDestination.description =
  "Sends Jitsu users to SendGrid as marketing contacts: identify() upserts a contact and reconciles its list membership, other events update the contact's fields";

export default SendgridDestination;
export { SendgridDestination };
