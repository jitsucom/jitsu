# OpenAI Ads Reverse ETL implementation contract

Verified against OpenAI's documentation and OpenAPI spec and Hightouch's documentation on 2026-10-21.
Checked against a live OpenAI account on 2026-10-22 with `validate_only: true` requests only (success, 400, 401, 403, 422).
**No event has been written to a real pixel**; delivery, dedup and 429/5xx behavior are unconfirmed. See "Unconfirmed".

Destination ID `openai-ads`, registered as `builtin.reverse.openai-ads`. Reverse ETL only: there is no OpenAI event
destination. This contract covers the `conversions` stream. An `audience` stream (Custom Audiences) is planned
separately and is not implemented here.

## Authentication

A **Conversions API key** from Ads Manager (Conversions), pasted into the destination and stored as a secret. It is
sent as `Authorization: Bearer <key>` and only authorizes sending events. The **Pixel ID** is a stream setting
(`pid` query parameter), not a credential. No OAuth: OpenAI's spec lists an OAuth scheme, but nothing documents
third-party access to it.

## `conversions` stream

| | |
| --- | --- |
| Endpoint | `POST https://bzr.openai.com/v1/events?pid=<pixel>` |
| Modes | Insert only. No removals, no mirror, no delete column. Only new model primary keys are sent. |
| Batch | At most 1,000 events per request (OpenAI's limit); one attempt per batch |
| Partner id | `integration_source: "jitsu"` on every request |
| Replay | `reconcile-required` |
| Target identity | `openai-conversions:<pixelId>` |

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
the extraction time. ISO timestamps with a timezone and Unix milliseconds are accepted; a seconds-sized number is
refused rather than interpreted.

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

## Parity

Hightouch offers an Events sync (conversions, insert) to OpenAI. Its connector source is not public; only its
documentation was compared. Intentional differences: Jitsu hashes customer data itself and refuses a stale event
instead of letting the batch fail.

## Unconfirmed

- The 429 and 5xx response shapes. Recorded with `validate_only` on 2026-10-22: success `{"accepted_events": N}`; 400
  `invalid_event` and 422 `event_timestamp_too_old` with an `errors[]` list; 403 `unknown pid` and 401 `Unauthorized`
  with `code: null`. 2xx is still accepted without parsing the body.
- How long OpenAI remembers an event ID.
- Writes: no event has been stored by this code against a real pixel, so delivery and dedup behavior are unobserved.
- OpenAI's logo and brand rules: the console icon is a neutral placeholder.

## References

- https://developers.openai.com/ads/conversions-api
- https://developers.openai.com/ads/supported-events
- https://developers.openai.com/ads/api-partner-setup
- https://hightouch.com/docs/destinations/open-ai

## Rollout

Deploy console and runner together; no schema migration, no `deploy:console` decision made yet. Tests use mocked HTTP
only. A live test needs explicit approval of the account, pixel and events; conversions cannot be undone.
