# OpenAI Ads Reverse ETL implementation contract

Verified against OpenAI's documentation and OpenAPI spec and Hightouch's documentation on 2026-10-21 and 2026-10-22.
Checked against a live OpenAI test account on 2026-10-22: the Conversions API with `validate_only: true` requests and one
approved write of two synthetic events (sent through the adapter, then resent once), and the Custom Audiences API on two
throwaway audiences with fake hashed identifiers. See "Unconfirmed" for what was not observed.

Destination ID `openai-ads`, registered as `builtin.reverse.openai-ads`. Reverse ETL only: there is no OpenAI event
destination. Two streams: `conversions` and `audience` (Custom Audiences).

## Authentication

Two API keys from Ads Manager, pasted into the destination and stored as secrets. Both are optional on the destination
and each stream requires only its own, checked when a sync is saved and again at run time. Both are sent as
`Authorization: Bearer <key>`.

- **Conversions API key** (Conversions): authorizes sending events to `bzr.openai.com` only. The **Pixel ID** is a
  stream setting (`pid` query parameter), not a credential.
- **Ads API key** (Settings): scoped to one ad account on `api.ads.openai.com`; it can manage more than audiences
  (campaigns, billing), so use a key made for Jitsu. The ad account id comes from `GET /ad_account` and is never
  entered by the user.

No OAuth: OpenAI's spec lists an OAuth scheme, but nothing documents third-party access to it. Both hosts sit behind
Cloudflare, which answers a blocked client with a plain-text `403 error code: 1010`. That is not an OpenAI answer and is
never treated as a refusal.

## `conversions` stream

|                 |                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------- |
| Endpoint        | `POST https://bzr.openai.com/v1/events?pid=<pixel>`                                          |
| Modes           | Insert only. No removals, no mirror, no delete column. Only new model primary keys are sent. |
| Batch           | At most 1,000 events per request (OpenAI's limit); one attempt per batch                     |
| Partner id      | `integration_source: "jitsu"` on every request                                               |
| Replay          | `reconcile-required`                                                                         |
| Target identity | `openai-conversions:<pixelId>`                                                               |

Events carry OpenAI's standard type (`order_created`, `lead_created`, ...) or `custom`. Jitsu derives `data.type`
from the event type: `customer_action`, `contents`, `plan_enrollment` or `custom`. Amounts are integers in the
currency's minor unit and need a currency. Contents are only allowed for non-`customer_action` events and plan IDs
only for plan and custom events. `source_url` is required for `web` events, and `app_installed` / `app_opened` need
`mobile_app`.

The event `id` is the mapped Event ID, or `jitsu-<sha256(sync id, source key)>`, so a retry after a failure reuses it.
OpenAI de-duplicates on Pixel ID + event name + `id` and keeps the first event.

### Customer data

Matching fields are optional. Email, phone, external ID and first/last name are hashed by Jitsu with OpenAI's rules,
or accepted pre-hashed (64 hex), never both, at most 3 distinct values per field and event. Rules (from the docs):

- email: trim, lowercase;
- phone: keep the country code, remove whitespace, parentheses, periods and hyphens, then a leading `+` and leading
  zeros; 8-15 digits. **OpenAI's audience API hashes the phone with the `+`; this stream must not share that code**;
- external ID: trim only; names: lowercase, remove whitespace and ASCII punctuation, keep non-ASCII characters.

Region, city, postal code and country are sent raw (lowercased, or uppercased for country). GAID, `obref`, IP address,
user agent and `oppref` are sent as supplied. Hashing happens once when a row is extracted; saved payloads and
recovery never normalize or hash again, and journaled payloads contain no raw email, phone, name or external-ID values.
The raw fields listed above (location, IP address, user agent, GAID, `obref`, `oppref`) are stored as supplied.

### Time window

`timestamp_ms` must be within the last 7 days and at most 10 minutes ahead, otherwise OpenAI fails the whole batch.
A row outside the window fails the run with a fixed message; rows are never skipped. Unmapped event time defaults to
the extraction time. Timestamps with an explicit timezone and Unix milliseconds are accepted: ISO 8601, and the text the
warehouse readers return (PostgreSQL and Redshift `2026-10-21 16:30:00.123456+05:30` with an offset of `+00`, `+05:30`
or `+0530`; Snowflake `2026-10-21 11:00:00.123456789 +00:00`). A timestamp without a timezone (a PostgreSQL `timestamp`,
a MySQL `DATETIME`, a ClickHouse `DateTime`) is refused rather than read in a guessed zone, as is a seconds-sized number.

## Acceptance and recovery

Accepted means OpenAI answered 2xx. It does **not** mean the events matched a person or were attributed to an ad.

- A definite refusal (HTTP 400, 401, 403, 404, 413 or 422 with OpenAI's error envelope) rejects the whole batch. The run
  stops; shown code is `OPENAI_<error code>` or `http_<status>`. OpenAI's `errors[]` names each failing event and field
  (for example `events[0].type`): only those enum codes and field paths are kept as rejection details, up to 3, never
  provider messages. A malformed `errors[]` does not downgrade the refusal.
- Anything else (429, 5xx, a timeout, a lost connection, an unreadable error body) leaves delivery unproven. The run
  stops and the batch needs manual reconciliation. There is no automatic retry or replay. OpenAI documents "reuse the
  same ID when retrying" but not how long it remembers an ID, so replay is only safe inside an unknown window.
- Recovery returns a saved receipt only when it is bound to the same sync, run, target, revision and batch. Without a
  receipt it never resubmits.
- Finish and abort perform no remote writes.

## `audience` stream

|                 |                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints       | `POST /custom_audiences` (create), `GET /custom_audiences` and `/{id}` (read, discover), `POST /{id}/add` and `/remove`, `GET /{id}/operations/{operation}` (poll), `POST .../resume`, all on `https://api.ads.openai.com/v1` |
| Modes           | Managed audience: mirror (`snapshot-diff`). Existing audience: additions and explicit removals via the model's delete column, no mirror                                                                                       |
| Batch           | At most 3,000 members, at most 9,000 identifiers (OpenAI's small-update path is up to 10,000; the body limit is 16 MiB)                                                                                                       |
| Replay          | `idempotency-key`                                                                                                                                                                                                             |
| Delivery        | `accepted`: the writer waits for each operation inside the call                                                                                                                                                               |
| Target identity | `openai-audience:<ad account id>:<audience id>`                                                                                                                                                                               |

### Members and identifiers

A row maps email, phone and Android advertising ID (GAID), one value each. Email and phone are raw or pre-hashed, never
both. Rules (OpenAI's audience guide):

- email: trim, lowercase, dots and plus tags kept, then SHA-256 as `email_sha256`;
- phone: E.164 **including the `+`**, then SHA-256 as `phone_number_sha256`. A raw value needs its country code (a
  leading `00` is read as `+`). This differs from the Conversions API, which hashes without the `+`; the two streams
  have separate functions, and tests assert OpenAI's own example digests for `jamie@example.com` and `+12025550124`;
- GAID: raw, hyphenated, non-zero UUID, lowercased. OpenAI hashes it; never pre-hash it.

Pre-hashed values must be 64 hex characters (lowercased). A malformed value fails the row, and a row with no identifier
fails the run; nothing is dropped. Hashing happens once when a row is extracted. Saved payloads hold hashes and the
GAID only.

**Identity.** The mirror identifies a member by one identifier: the first available of email, phone, GAID. A removal
sends only that identifier, so it depends on nothing else in the row. The Add sends every identifier the row has.
OpenAI matches people, not identifiers, so changing a member's identity identifier (for example their email) while they
remain in the model removes the old identity after the new one is added, and that can remove the person. Keep the
identity identifier stable.

### Provisioning (managed audience)

The first run creates the audience. The runner saves the creation intent and a random marker (`jitsu-retl-<64 hex>`,
placed in the description) in its target state before the request, claims the creation with a compare-and-set, and
records the audience id once it exists. OpenAI's create has no idempotency key. If the answer is lost, the next run does
not create a second audience: it scans the account's audiences newest first for the marker and adopts the single match,
or stops with "OpenAI audience creation is unconfirmed; retry discovery without resetting state". A definite refusal
returns the state to prepared so the same intent can be retried once the cause is fixed.

The saved state also records the ad account, so a key for another account cannot adopt the audience. Before every run
the audience is read and must carry the marker. Creation and every later run then wait for `ready` (about 17 s after
create; bounded at 5 minutes). An audience that is `failed` or `archived` stops the run; `too_small` is usable (small
audiences can exclude people).

### Delivery and recovery

Each batch is one Add or Remove with an `Idempotency-Key` of `jitsu-<batch binding>` (sync, run, target, revision,
action, batch id, records), so the same batch always carries the same key and identical bytes. The writer then polls the
operation until `succeeded` or `failed` (growing delays up to 10 s; bounded at 10 minutes). The mirror therefore sees a
batch accepted only after OpenAI finished it, and removals follow accepted additions. `expected_revision` is not sent:
the revision rises on every accepted operation, no-ops included, so it cannot detect change.

- `succeeded` is accepted. It does **not** mean the members matched anyone or that the audience can be targeted.
- A submit refused with OpenAI's error envelope (HTTP 400, 401, 403, 404, 413 or 422) rejects the whole batch with nothing
  applied: one malformed identifier fails all of it, so values are validated locally first. Shown code is
  `OPENAI_<error code>` or `http_<status>`; provider messages are never kept.
- An operation that reaches `failed` rejects the batch with `OPENAI_<failure code>` (or `OPENAI_OPERATION_FAILED`). OpenAI
  says a failed Add or Remove may have applied part of its change; the run stops, the snapshot is not promoted, and the next
  run recomputes the difference, which is safe because Add and Remove are idempotent in effect.
- A `503 custom_audience_operation_unavailable` on submit (seen when an Add reaches an audience that is not yet `ready`)
  and a 429 are retried with the same key inside a 5-minute budget, honoring `Retry-After`, with a floor of 0.5 s. A
  `409 custom_audience_mutation_conflict` is retried the same way. Statuses OpenAI does not define are treated as not
  finished.
- A lost response, a timeout or a wait that runs out throws. The core marks the batch unknown and recovery replays the
  **same request under the same key**: OpenAI returns the original operation, running or finished, so nothing is applied
  twice. A new key is never used for work that may already have been accepted. A saved receipt bound to the batch is
  returned without calling OpenAI.
- An interrupted operation (`409 ...operation_recovery_required` on a status call) is resumed by operation id, then
  polled.
- Finish and abort perform no remote writes.

### Eligibility

Empty and small audiences can only be used to **exclude** people; inclusion and bid adjustments need roughly 25,000
matched users, and OpenAI can refuse a membership change that would break the size requirement of a campaign using the
audience. Custom audiences are not available for campaigns targeting the EEA or Switzerland. Create may be disabled per
account ("when small audiences are enabled for the account" in OpenAI's spec); a refusal is shown, never retried.

## Parity

Hightouch offers an Events sync (conversions, insert) and a Segments sync (add and remove) to OpenAI. Its connector
source is not public; only its documentation was compared. Intentional differences: Jitsu hashes customer data itself,
refuses a stale event instead of letting the batch fail, and recovers an uncertain audience batch by replaying its key.

## Unconfirmed

Observed live on 2026-10-22:

- Conversions: success body `{"accepted_events": N}`; 400 `invalid_event` and 422 `event_timestamp_too_old` with an
  `errors[]` list; 403 `unknown pid` and 401 `Unauthorized` with `code: null`. Two events written and resent were both
  accepted and Event Stream listed four rows. 2xx is accepted without parsing the body.
- Audience: create 200 (`rockset_ingest_pending`, then `publishing`, then `ready` after about 17 s); Add before ready 503;
  an Add or Remove takes about 5-26 s regardless of size (a 10,000-identifier Add about 25 s including the submit); a
  second Add while the first runs is accepted and queued; the same key returns the same operation, while running and after
  it finished (still true 17 minutes later); a malformed hash is refused 422 for the whole batch and an unknown identifier
  type 400; the revision rises on every operation.

Not observed:

- The conversions 429 and 5xx shapes, how long OpenAI remembers an event ID, and whether a resent event is counted once in
  reporting (the Total events counter had not moved 5.5 hours after the write).
- How long OpenAI keeps an idempotency key and the operations list beyond 17 minutes; the 2-day recovery window assumes it
  holds.
- A real `failed` operation, `Retry-After` on a 429 or 503, and `409 custom_audience_mutation_conflict` (documented only).
- OpenAI's logo and brand rules: the console icon is a neutral placeholder.

## References

- https://developers.openai.com/ads/conversions-api
- https://developers.openai.com/ads/supported-events
- https://developers.openai.com/ads/api-partner-setup
- https://developers.openai.com/ads/custom-audiences
- https://developers.openai.com/ads/openapi.json
- https://hightouch.com/docs/destinations/open-ai

## Rollout

Deploy console and runner together; no schema migration, no `deploy:console` decision made yet. Unit tests use mocked HTTP,
including a fake of OpenAI's audience API built from the live observations above. A live test needs explicit approval of
the account, pixel or audience and the data sent: conversions cannot be undone and archiving an audience is permanent.
