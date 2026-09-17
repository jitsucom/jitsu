# Google Data Manager Reverse ETL — implementation contract

JITSU-227, adapter/OAuth slice. No audience provisioning or UI enablement yet.

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
- Mirror stays disabled until verified managed-audience provisioning and unchanged-member
  refresh (Google membership expiry) land. An empty reported audience is not a baseline.

## Setup / recovery

Create a Google Cloud OAuth app with Data Manager API enabled and the
`https://www.googleapis.com/auth/datamanager` scope on the existing
`jitsu-cloud-dst-google-ads` Nango integration. Existing event integrations also use
`https://www.googleapis.com/auth/adwords`; retain that scope when sharing the app.
Reconnect the destination after adding scopes. No legacy Google Ads developer token
is used for this adapter. The account must be eligible for Customer Match.

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
- [Hightouch documentation](https://hightouch.com/docs/destinations/google-data-manager)
  describes audience creation/existing audiences, consent, normalization, additions and
  removals. No public native connector implementation was found; this is independent
  implementation, not a source port. Syncmaven provides no Google Ads adapter to reuse.

Tests use mocked HTTP only. No live audience writes or cloud setup are performed.
