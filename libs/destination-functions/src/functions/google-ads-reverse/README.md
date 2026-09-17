# Google Data Manager Reverse ETL — implementation contract

JITSU-227, adapter/OAuth and managed-audience provisioning. UI enablement follows.

- Existing Google Ads Customer Match audiences: additions and explicit tombstone removals.
- Email and phone, raw or SHA-256 hex. Normalize/hash once before journal preparation;
  recovery sends no raw identifiers and never re-hashes persisted payloads.
- Ingest requires explicitly mapped GRANTED ad-user-data and ad-personalization consent,
  plus explicit Customer Match terms acceptance in stream options. No inferred consent.
- Removal needs identifiers only; denied consent must not prevent removing a member.
- One target and at most 1,000 source records per independent API request. Core rejects
  overlapping member identifiers within an extraction before submitting the overlap.
- A submission receipt is staged, not accepted. Poll the saved request ID; accept only
  unambiguous, warning-free SUCCESS for the exact target/action and record count.
- FAILED rejects the whole batch immediately. Partial success/unknown diagnostics or
  missing request IDs stop recovery without replay or fabricated per-row outcomes.
- No remote init/session/finish/abort operations. Core settles independent jobs before
  finalization or incomplete-extraction cleanup. Pending jobs remain durable between runs.
- OAuth stays in Nango; console issues only the exact sync/revision's short-lived access
  token. Runner caches briefly in memory. No token/refresh token in provider receipts.
- Mirror requires a Jitsu-created audience reserved to one sync. Console supplies
  server-recorded evidence; runtime verifies the current remote identity, ownership,
  contact-list type and marker. An empty reported audience is not a baseline.
- Managed lists use 540-day membership. Core refreshes unchanged members after 30 days
  during normal syncs, before removals, using a durable per-generation cutoff and
  per-member acceptance time. Paused/failed/infrequent syncs can still expire members.

## Setup / recovery

Create a Google Cloud OAuth app with Data Manager API enabled and the
`https://www.googleapis.com/auth/datamanager` scope on the existing
`jitsu-cloud-dst-google-ads` Nango integration. Existing event integrations also use
`https://www.googleapis.com/auth/adwords`; retain that scope when sharing the app.
Reconnect the destination after adding scopes. No legacy Google Ads developer token
is used for this adapter. The account must be eligible for Customer Match.
Account-level EU political advertising declaration may also be required for user-list
creation; resolve this in Google Ads before provisioning.

### Managed audience provisioning (before delivery)

POST `/api/:workspaceId/reverse-etl/google-audiences` with `destinationId`, the intended
`syncId`, a stable UUID `requestId`, `displayName`, `exclusiveManagementConfirmed: true`
and `customerMatchTermsAccepted: true`. Workspace edit access and the `reverse-etl`
rollout flag are required. Save the returned internal `id` as `managedAudienceId`
alongside `audienceId` in stream options. The upcoming editor owns this flow.

The console durably records intent before creation and only one request may submit
it. Reuse the **same requestId and input** after a timeout or `pending` response:
retries only discover the audience by its saved correlation marker. An absent or
ambiguous match remains unresolved, never authorizing another POST. There is no
automatic reset, delete or arbitrary existing-audience adoption. The creation record
is internal configuration, not editable destination JSON.

Exclusivity is an operational agreement, not a Google API lock: do not upload via
other tools or the Google UI. Changing remote identity/marker/type/ownership/duration
blocks delivery. Google account ownership and estimated audience size alone cannot
prove Jitsu exclusivity. Each managed audience is bound to its intended sync.

Stream `audience`: `audienceId` (numeric user-list ID), `customerMatchTermsAccepted: true`.
Destination: authorized Google Ads OAuth connection, customer ID and optional manager
login customer ID. Mapping: at least one of email/hashedEmail/phone/hashedPhone; additions
also map adUserData/adPersonalization, both `GRANTED`. Pre-hashed inputs must already
follow Google's normalization rules. Raw phone numbers require an explicit country code.

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

## Evidence (reviewed 2026-09-16)

- [Ingest](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/ingest),
  [remove](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/remove),
  [status](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve).
- [Normalization](https://developers.google.com/data-manager/api/devguides/concepts/formatting),
  [diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics).
- [Creation](https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/create-audience),
  [list discovery](https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists/list)
  and [membership expiry](https://support.google.com/google-ads/answer/6334160) rechecked 2026-09-17.
- [Hightouch documentation](https://hightouch.com/docs/destinations/google-data-manager)
  describes audience creation/existing audiences, consent, normalization, additions and
  removals. No public native connector implementation was found; this is independent
  implementation, not a source port. Syncmaven provides no Google Ads adapter to reuse.

Tests use mocked HTTP only. No live audience writes or cloud setup are performed.
