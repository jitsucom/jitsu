import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { ResendCredentials } from "../meta";
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

const DEFAULT_RESEND_API = "https://api.resend.com";

// Contact property that records which audiences the connector added the contact to — the source of
// truth for reconciliation, so we only remove audiences we added ourselves. Stored on the contact in
// Resend (no Jitsu-side membership cache).
const MANAGED_AUDIENCES_PROP = "jitsu_managed_audiences";
// Per-event trait that overrides the configured audiences (comma-separated names).
const AUDIENCES_TRAIT = "resendAudiences";
const KNOWN_PROPS_KEY = "resend:known-props";
const AUDIENCE_NAME_MAP_KEY = "resend:audience-name-map";

type ExtendedCtx = FullContext<ResendCredentials> & {
  jsonFetch: JsonFetcher;
};

function apiBase(props: ResendCredentials): string {
  return props.apiBase || DEFAULT_RESEND_API;
}

function authHeaders(props: ResendCredentials): Record<string, string> {
  return { Authorization: `Bearer ${props.apiKey}` };
}

// Traits mapped to first-class contact fields (or internal) — excluded from the free-form properties map.
const reservedTraitKeys = new Set([
  "email",
  "name",
  "firstname",
  "lastname",
  "first_name",
  "last_name",
  "unsubscribed",
  AUDIENCES_TRAIT.toLowerCase(),
]);

// All non-reserved traits, coerced to strings.
function traitProperties(traits: Record<string, any>): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (reservedTraitKeys.has(key.toLowerCase())) {
      continue;
    }
    const str = stringifyValue(value);
    if (str !== undefined) {
      properties[key] = str;
    }
  }
  return properties;
}

// The managed-audiences bookkeeping value read back from a fetched contact (Resend returns properties
// as { key: { value, type } }).
function readManagedAudiences(existing: any): string[] {
  const p = existing?.properties?.[MANAGED_AUDIENCES_PROP];
  return decodeManagedIds(p && typeof p === "object" ? p.value : p);
}

// Resend rejects a contact write referencing a property key that isn't defined, so we create a
// (string-typed) definition for each key first. Definitions are cached in the store; a key we can't
// define is dropped from the payload so one bad key can't fail the whole write.
async function ensureProperties(properties: Record<string, string>, ctx: ExtendedCtx): Promise<Record<string, string>> {
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    return properties;
  }
  const known = new Set<string>((await ctx.store.get(KNOWN_PROPS_KEY)) || []);
  const result: Record<string, string> = {};
  let changed = false;
  for (const key of keys) {
    if (known.has(key)) {
      result[key] = properties[key];
      continue;
    }
    try {
      await ctx.jsonFetch(`${apiBase(ctx.props)}/contact-properties`, {
        method: "POST",
        headers: authHeaders(ctx.props),
        body: { key, type: "string" },
      });
      known.add(key);
      result[key] = properties[key];
      changed = true;
    } catch (e) {
      if (e instanceof JsonFetchError && e.responseStatus === 409) {
        // definition already exists
        known.add(key);
        result[key] = properties[key];
        changed = true;
      } else if (
        e instanceof JsonFetchError &&
        e.responseStatus < 500 &&
        e.responseStatus !== 429 &&
        key !== MANAGED_AUDIENCES_PROP
      ) {
        // permanent client error (e.g. an invalid key name) on a user-supplied key — skip this one key
        // rather than fail the whole write; a single bad user-supplied key shouldn't drop the event.
        // The internal jitsu_managed_audiences marker is never skipped (falls through to throw below):
        // proceeding without it lets audience membership mutate while reconciliation bookkeeping is lost.
        ctx.log.warn(`Resend: could not define contact property "${key}", skipping it: ${e.message}`);
      } else {
        // transient (429/5xx/network) — retry the event so we don't lose data or leave the
        // jitsu_managed_audiences bookkeeping stale (which would break later reconciliation).
        if (changed) {
          await ctx.store.set(KNOWN_PROPS_KEY, Array.from(known));
        }
        throw classifyError(`Resend: failed to define contact property "${key}"`, e);
      }
    }
  }
  if (changed) {
    await ctx.store.set(KNOWN_PROPS_KEY, Array.from(known));
  }
  return result;
}

// Resolve audience names to ids, creating any that don't exist. The name→id map is a lookup cache (not
// membership state) refreshed from the API on a miss.
async function resolveAudienceIds(names: string[], ctx: ExtendedCtx): Promise<string[]> {
  if (names.length === 0) {
    return [];
  }
  let map: Record<string, string> = (await ctx.store.get(AUDIENCE_NAME_MAP_KEY)) || {};
  if (names.some(n => !map[n])) {
    try {
      const list = await ctx.jsonFetch(`${apiBase(ctx.props)}/audiences`, {
        method: "GET",
        headers: authHeaders(ctx.props),
      });
      map = {};
      for (const a of list?.data || []) {
        if (a?.name) {
          map[a.name] = a.id;
        }
      }
    } catch (e) {
      throw classifyError("Resend: failed to list audiences", e);
    }
  }
  const ids: string[] = [];
  for (const name of names) {
    let id = map[name];
    if (!id) {
      try {
        const created = await ctx.jsonFetch(`${apiBase(ctx.props)}/audiences`, {
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
        throw classifyError(`Resend: failed to resolve/create audience "${name}"`, e);
      }
    }
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  await ctx.store.set(AUDIENCE_NAME_MAP_KEY, map, "1h");
  return ids;
}

async function getContact(email: string, ctx: ExtendedCtx): Promise<any | undefined> {
  try {
    return await ctx.jsonFetch(`${apiBase(ctx.props)}/contacts/${encodeURIComponent(email)}`, {
      method: "GET",
      headers: authHeaders(ctx.props),
    });
  } catch (e) {
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      return undefined;
    }
    throw classifyError(`Resend: failed to look up contact ${email}`, e);
  }
}

async function addToAudience(email: string, audienceId: string, ctx: ExtendedCtx): Promise<void> {
  try {
    await ctx.jsonFetch(`${apiBase(ctx.props)}/contacts/${encodeURIComponent(email)}/segments/${audienceId}`, {
      method: "POST",
      headers: authHeaders(ctx.props),
      body: {},
    });
  } catch (e) {
    throw classifyError(`Resend: failed to add contact ${email} to audience ${audienceId}`, e);
  }
}

async function removeFromAudience(email: string, audienceId: string, ctx: ExtendedCtx): Promise<void> {
  try {
    await ctx.jsonFetch(`${apiBase(ctx.props)}/contacts/${encodeURIComponent(email)}/segments/${audienceId}`, {
      method: "DELETE",
      headers: authHeaders(ctx.props),
    });
  } catch (e) {
    // Contact wasn't a member, or the audience is gone — nothing to remove.
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      return;
    }
    throw classifyError(`Resend: failed to remove contact ${email} from audience ${audienceId}`, e);
  }
}

// identify: create the contact if it's new, update it otherwise. Stores email, name, unsubscribed state
// and every other trait as a custom property, and reconciles audience membership to the desired set
// (adding new ones, removing previously-managed ones that are no longer listed).
async function upsertContact(event: AnalyticsServerEvent, ctx: ExtendedCtx): Promise<void> {
  const { log, props } = ctx;
  const email = resolveEmail(event);
  if (!email) {
    log.debug(`Resend: identify with userId=${event.userId} has no email, skipping (Resend requires an email)`);
    return;
  }
  const traits = getTraits(event);
  const properties = traitProperties(traits);
  if (event.userId) {
    properties.jitsu_user_id = String(event.userId);
  }
  if (event.anonymousId) {
    properties.jitsu_anonymous_id = String(event.anonymousId);
  }

  const existing = await getContact(email, ctx);

  // Reconcile audience membership only when a desired set was specified for this event.
  const desiredNames = desiredTargetNames(event, AUDIENCES_TRAIT, props.audiences);
  let desiredIds: string[] = [];
  let toRemove: string[] = [];
  if (desiredNames !== undefined) {
    desiredIds = await resolveAudienceIds(desiredNames, ctx);
    const managedBefore = readManagedAudiences(existing);
    toRemove = managedBefore.filter(id => !desiredIds.includes(id));
  }

  // The jitsu_managed_audiences marker must only advance AFTER removals succeed. If we persisted it up
  // front and a later removeFromAudience failed transiently, the retry would read the advanced marker,
  // compute an empty toRemove, and never retry the removal — leaving stale memberships. So the marker is
  // written in the initial upsert only when there's nothing to remove (always true for a new contact);
  // otherwise it's persisted in a final PATCH after the removals below.
  const markerValue = desiredNames !== undefined ? encodeManagedIds(desiredIds) : undefined;
  const deferMarker = markerValue !== undefined && toRemove.length > 0;
  const initialProperties = { ...properties };
  if (markerValue !== undefined && !deferMarker) {
    initialProperties[MANAGED_AUDIENCES_PROP] = markerValue;
  }

  const fields = {
    ...splitName(traits),
    unsubscribed: typeof traits.unsubscribed === "boolean" ? traits.unsubscribed : undefined,
    properties: await ensureProperties(initialProperties, ctx),
  };

  if (!existing) {
    try {
      await ctx.jsonFetch(`${apiBase(props)}/contacts`, {
        method: "POST",
        headers: authHeaders(props),
        body: { email, ...fields, segments: desiredIds.length ? desiredIds.map(id => ({ id })) : undefined },
      });
      log.debug(`Resend: created contact ${email}${desiredIds.length ? ` in audiences ${desiredIds.join(",")}` : ""}`);
    } catch (e) {
      throw classifyError(`Resend: failed to create contact ${email}`, e);
    }
  } else {
    try {
      await ctx.jsonFetch(`${apiBase(props)}/contacts/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: authHeaders(props),
        body: fields,
      });
      log.debug(`Resend: updated contact ${email}`);
    } catch (e) {
      throw classifyError(`Resend: failed to update contact ${email}`, e);
    }
    // Audiences can't be set via PATCH — add desired (idempotent) and remove the ones we no longer manage.
    for (const id of desiredIds) {
      await addToAudience(email, id, ctx);
    }
    for (const id of toRemove) {
      await removeFromAudience(email, id, ctx);
    }
    if (toRemove.length) {
      log.debug(`Resend: removed contact ${email} from audiences ${toRemove.join(",")}`);
    }
    // Removals succeeded — only now advance the managed marker.
    if (deferMarker) {
      try {
        await ctx.jsonFetch(`${apiBase(props)}/contacts/${encodeURIComponent(email)}`, {
          method: "PATCH",
          headers: authHeaders(props),
          body: { properties: await ensureProperties({ [MANAGED_AUDIENCES_PROP]: markerValue as string }, ctx) },
        });
      } catch (e) {
        throw classifyError(`Resend: failed to persist managed audiences for ${email}`, e);
      }
    }
  }

  if (props.resolveEmailFromUserId && event.userId) {
    await ctx.store.set(userEmailCacheKey("resend", String(event.userId)), email, "90d");
  }
}

// track/page/screen: never create a contact and never touch audience membership (managed by identify).
// If the event carries custom traits (typically added by a transformation function) and we can resolve
// an email, update the existing contact's properties.
async function updateContactFromEvent(event: AnalyticsServerEvent, ctx: ExtendedCtx): Promise<void> {
  const { log, props } = ctx;
  let email = resolveEmail(event);
  if (!email && props.resolveEmailFromUserId && event.userId) {
    email = await ctx.store.get(userEmailCacheKey("resend", String(event.userId)));
  }
  if (!email) {
    log.debug(`Resend: ${event.type} event can't be linked to a contact (no email, no cached userId), skipping`);
    return;
  }

  // Only fields explicitly set on the event (typically by a transformation function) drive an update.
  // context.traits carries the ambient identify traits on every event, so using them here would re-write
  // the contact on each track/page event — we deliberately ignore them for updates.
  const traits = event.traits || {};
  const properties = traitProperties(traits);
  const unsubscribed = typeof traits.unsubscribed === "boolean" ? traits.unsubscribed : undefined;
  if (Object.keys(properties).length === 0 && unsubscribed === undefined) {
    log.debug(`Resend: ${event.type} event for ${email} has no contact fields to update, skipping`);
    return;
  }

  try {
    await ctx.jsonFetch(`${apiBase(props)}/contacts/${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: authHeaders(props),
      body: { unsubscribed, properties: await ensureProperties(properties, ctx) },
    });
    log.debug(`Resend: updated contact ${email} from ${event.type} event`);
  } catch (e) {
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      log.debug(`Resend: contact ${email} not found; ${event.type} events don't create contacts, skipping`);
      return;
    }
    throw classifyError(`Resend: failed to update contact ${email}`, e);
  }
}

// group: fold the group id and group traits into the contact's properties (namespaced) so a user's
// company attributes are queryable in Resend.
async function updateContactFromGroup(event: AnalyticsServerEvent, ctx: ExtendedCtx): Promise<void> {
  const { log, props } = ctx;
  if (!event.groupId) {
    log.debug(`Resend: group event without groupId, skipping`);
    return;
  }
  let email = event.context?.traits?.email as string | undefined;
  if (!email && props.resolveEmailFromUserId && event.userId) {
    email = await ctx.store.get(userEmailCacheKey("resend", String(event.userId)));
  }
  if (!email) {
    log.debug(`Resend: group event can't be linked to a contact (no email, no cached userId), skipping`);
    return;
  }

  const properties: Record<string, string> = { group_id: String(event.groupId) };
  for (const [key, value] of Object.entries(event.traits || {})) {
    const str = stringifyValue(value);
    if (str !== undefined) {
      properties[`group_${key}`] = str;
    }
  }

  try {
    await ctx.jsonFetch(`${apiBase(props)}/contacts/${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: authHeaders(props),
      body: { properties: await ensureProperties(properties, ctx) },
    });
    log.debug(`Resend: updated contact ${email} with group ${event.groupId}`);
  } catch (e) {
    if (e instanceof JsonFetchError && e.responseStatus === 404) {
      log.debug(`Resend: contact ${email} not found; group events don't create contacts, skipping`);
      return;
    }
    throw classifyError(`Resend: failed to update contact ${email} from group event`, e);
  }
}

const ResendDestination: JitsuFunction<AnalyticsServerEvent, ResendCredentials> = async (event, ctx) => {
  const jsonFetch = jsonFetcher(ctx.fetch, { log: ctx.log, debug: true });
  const extendedCtx: ExtendedCtx = { ...ctx, jsonFetch };

  if (event.type === "identify") {
    await upsertContact(event, extendedCtx);
  } else if (event.type === "group") {
    await updateContactFromGroup(event, extendedCtx);
  } else if (event.type === "track" || event.type === "page" || event.type === "screen") {
    await updateContactFromEvent(event, extendedCtx);
  }
};

ResendDestination.displayName = "resend-destination";
ResendDestination.description =
  "Sends Jitsu users to Resend as contacts: identify() upserts a contact and reconciles its audience membership, other events update the contact's properties";

export default ResendDestination;
export { ResendDestination };
