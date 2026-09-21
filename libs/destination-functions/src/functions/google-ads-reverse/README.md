# Google Ads Reverse ETL — implementation contract

JITSU-227, adapter/OAuth, audience provisioning and console setup.

- Existing Google Ads Customer Match audiences: additions and explicit tombstone removals,
  or opt-in full replacement with explicit exclusive-management/takeover confirmation.
- Contact audiences: email/phone (string or arrays, raw or SHA-256), and address matching
  with first/last name (raw or SHA-256), country and postal code. Mobile-advertising-ID
  and CRM-ID audiences are separate types; mobile audiences also specify app ID/platform.
  Hash contact identifiers once before journal preparation. Mobile/CRM IDs stay unhashed.
- Consent mappings are optional: each unmapped ad-user-data/ad-personalization field
  assumes GRANTED for ingestion. Mapped fields must contain GRANTED; null, missing values
  and DENIED fail validation. Customer Match terms still require explicit acceptance.
- Removal needs identifiers only; denied consent must not prevent removing a member.
- One target and at most 1,000 source records per independent API request. Core rejects
  overlapping member identifiers within an extraction before submitting the overlap.
- A submission receipt is staged, not accepted. Poll the saved request ID; accept only
  unambiguous, warning-free SUCCESS for the exact target/action and record count.
- FAILED rejects the whole batch immediately. Partial success/unknown diagnostics or
  missing request IDs stop recovery without replay or fabricated per-row outcomes.
- Snapshot-diff/upsert finish and abort are local. Full replacement performs a read-only
  initialization and submits remote cleanup at finish. Core settles independent upload
  jobs first. Pending jobs remain durable between runs.
- OAuth stays in Nango; console issues only the exact sync/revision's short-lived access
  token. Runner caches briefly in memory. No token/refresh token in provider receipts.
- Snapshot-diff mirror requires a Jitsu-created audience reserved to one sync. Console supplies
  server-recorded evidence; runtime verifies the current remote identity, ownership,
  contact-list type and marker. An empty reported audience is not a baseline.
- Managed lists default to 540-day membership (configurable 1–540). Snapshot-diff refreshes unchanged members after 30 days, or half the membership duration if shorter,
  during normal syncs, before removals, using a durable per-generation cutoff and
  per-member acceptance time. Paused/failed/infrequent syncs can still expire members.

## Full replacement (opt-in)

Select **Mirror · full replacement** while creating a sync, for a new managed audience
or an existing owned Customer Match audience. Use a full-query model without a cursor
or delete column. Stream options add `mirrorStrategy: "full-replace"` and
`exclusiveManagementConfirmed: true`; existing configs default to their previous behavior.
Existing sync delivery settings are immutable: this does not convert saved diff runs.

1. Read the audience and capture Google's HTTP Date as the cutoff before any uploads.
   Persist it in the run's buffered store, bound to sync, logical run, revision and target.
   A missing clock or mismatched audience stops initialization; worker time is not used.
2. Extract and seal the complete snapshot. Upload every unique member, including unchanged
   members, then wait for all upload requests to be accepted.
3. At finish, POST `audienceMembers:removeAll` with the original `removeAsOfTime` cutoff.
   Google removes members last added before that cutoff, retaining refreshed members.
4. Persist the cleanup request receipt and poll it on subsequent status-check jobs.
   Promote the snapshot only after clean, target/action-verified SUCCESS. Google exposes
   no removed-member count for this operation; logs report cleanup status, not a guessed count.

This is asynchronous, **not an atomic swap**. An empty successful snapshot clears the
audience. Other tools/users must not upload to the audience; Google does not enforce the
exclusive-management agreement. Existing-audience confirmation authorizes removal of
members uploaded outside Jitsu. Failed extraction or rejected uploads never authorize cleanup.
If cleanup's response/receipt is lost, Jitsu stops for operator reconciliation and never
blindly replays the destructive call. A status check never chooses a new cutoff or
re-extracts the warehouse. No additional database schema or cloud credentials are needed.

## Setup / recovery

Create a Google Cloud OAuth app with Data Manager API enabled and the
`https://www.googleapis.com/auth/datamanager` scope on the existing
`jitsu-cloud-dst-google-ads` Nango integration. Existing event integrations also use
`https://www.googleapis.com/auth/adwords`; retain that scope when sharing the app.
Reconnect the destination after adding scopes. Audience delivery and default click delivery
do not require a Google Ads developer token. Calls, adjustments and optional legacy click
delivery require the `adwords` scope and a developer token, supplied on the destination or
via the runner's `GOOGLE_ADS_DEVELOPER_TOKEN`. The optional conversion-action picker also
uses Ads API and needs that token on the destination or console. Audience accounts must be eligible for Customer Match.
Account-level EU political advertising declaration may also be required for user-list
creation; resolve this in Google Ads before provisioning.

### Managed audience provisioning (first run)

The editor saves `GoogleAudienceSettings` directly in link data: an `audience`
union of `{kind: "managed", displayName}` or `{kind: "existing", audienceId}`,
Customer Match terms, optional mirror strategy and exclusive-management confirmation.
There is no console provisioning endpoint or separate setup entity.

Under its Kubernetes lease, the runner saves a random correlation marker and
creation intent in `source_state` stream `_REVERSE_ETL_GOOGLE_AUDIENCE_` before
calling Google. The audience ID is saved there after creation. It resolves settings
to provider-ready `GoogleAudienceOptions` in memory without changing the link revision.
An uncertain creation fails the attempt; subsequent runs only discover the same
saved request, never submit a second create. An absent or ambiguous match remains
unresolved and requires investigation; do not reset or create another sync.

Existing console-provisioned audiences require the explicit settings migration in
the console Reverse ETL README. It preserves ready links, audience identity and
delivery revisions while moving the old proof into runtime state.

Exclusivity is an operational agreement, not a Google API lock: do not upload via
other tools or the Google UI. Changing remote identity/marker/type/ownership/duration
blocks delivery. Google account ownership and estimated audience size alone cannot
prove Jitsu exclusivity. Each managed audience is bound to its intended sync.

Stream `audience`: `audienceId` (numeric user-list ID), `customerMatchTermsAccepted: true`.
Destination: authorized Google Ads OAuth connection, customer ID and optional manager
login customer ID. Mapping: at least one identifier matching the audience type; additions
may map adUserData/adPersonalization, both `GRANTED` when mapped. Unmapped consent
defaults to `GRANTED`. Pre-hashed inputs must already
follow Google's normalization rules. Raw phone numbers require an explicit country code.

## Conversion streams and mapping coverage

| Stream | Mappings | Delivery |
| --- | --- | --- |
| Click / offline conversions | GCLID/GBRAID/WBRAID, email/phone arrays, conversion time, order ID, value/currency, consent, custom variables, session attributes, IP/user agent, event source, cart/items/discount. Address matching via Data Manager; merchant feed country/language via Ads API. | Data Manager by default; optional Ads API for eligible existing integrations. |
| Phone-call conversions | Caller ID, call start and conversion time, value/currency, consent, custom variables. | Google Ads API. |
| Conversion adjustments | Retraction/restatement/enhancement; original order ID or GCLID+time, adjustment time, restatement amount/currency, first-/third-party enhanced email/phone/address identifiers and user agent. | Google Ads API. |

These complement the existing Audience stream. Offline **store sales** is not implemented.
The editor exposes optional mappings without requiring irrelevant fields. Runtime enforces
Google-required combinations: click identifier and time, call caller/time fields, complete
address identifiers only when using address matching, order ID and identifiers for enhancement,
and a value for restatement. Retractions need no contact fields. All conversion streams
require an existing conversion-action ID; target discovery is read-only and manual IDs work.

Object mappings accept a warehouse JSON object or JSON string. `customVariables` maps
Google variable names to values; `items` contains `{productId, quantity, price}` entries.
Session objects use `gadSource`, `gadCampaignId`, `landingPageUrl`, `sessionStartTime`,
`landingPageReferrer`, `landingPageUserAgent`; alternatively map pre-encoded session attributes.
Contact identifiers are normalized/hashed before persistence. **Call caller ID, mobile/CRM IDs,
IP addresses and other non-hashed API fields remain in durable payloads**: protect object storage accordingly.

Conversion syncs insert new model primary keys only. Existing accepted or pending keys are
omitted using the local SQLite membership index, even if their payload changes. Corrections
are new events in an adjustment model with a unique primary key for each adjustment.
Default click transaction IDs include sync ID and primary key; map your own order ID to
coordinate deduplication across tools or later adjustments. Pending/uncertain keys remain
suppressed until reconciled; resetting state is not a safe retry mechanism.

Data Manager receipts reuse the normal logical task/status-refresh path. Google Ads responses
persist per-row success/failure before failing on a permanent rejection. Missing responses
are not replayed. Final partial/unverified Data Manager results stop status refresh and retain
the receipt for manual reconciliation; they never fabricate row-level success.

Mapping coverage was compared with [Segment Google Ads Conversions](https://segment.com/docs/connections/destinations/catalog/actions-google-enhanced-conversions/)
and [Hightouch Google Ads](https://hightouch.com/docs/destinations/google).
Wire formats follow Google's [Data Manager events](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest),
[calls](https://developers.google.com/google-ads/api/docs/conversions/upload-calls), and
[adjustments](https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments) APIs.

Poll once per recovery attempt; schedule/manual execution resumes durable requests.
Google recommends allowing processing time (often 30 minutes, up to 24 hours).
POST is never automatically retried, including on 401, timeout or 5xx. If the response
or durable request receipt is lost, operator reconciliation is required; this slice
does not implement an override/reset UI. Partial results and warnings likewise require
investigation, not a force-success action. Request IDs/hashed payloads remain in the
journal. Disabling a sync prevents token issuance and therefore pauses recovery too.

An OAuth failure before any Google call is a definite non-submission, not an ambiguous
request: its batch receives rejected outcomes and the attempt fails. Repair OAuth and
retry after core cleanup; no operator override of an unknown request is necessary.

## Evidence

- [Ingest](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/ingest),
  [remove](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/remove),
  [status](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve).
- [Normalization](https://developers.google.com/data-manager/api/devguides/concepts/formatting),
  [diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics).
- Full replacement: [remove-all guide](https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/remove-all-members)
  and [removeAll reference](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/removeAll),
  reviewed 2026-09-21.
- [Creation](https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/create-audience),
  [list discovery](https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists/list)
  and [membership expiry](https://support.google.com/google-ads/answer/6334160) rechecked 2026-09-17.
- [Hightouch documentation](https://hightouch.com/docs/destinations/google-data-manager)
  describes audience creation/existing audiences, consent, normalization, additions and
  removals. No public native connector implementation was found; this is independent
  implementation, not a source port. Syncmaven provides no Google Ads adapter to reuse.

Tests use mocked HTTP only. No live audience writes or cloud setup are performed.
