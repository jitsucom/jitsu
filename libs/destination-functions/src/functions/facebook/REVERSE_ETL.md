# Meta Ads Reverse ETL implementation contract

Verified against provider and competitor documentation on 2026-09-24. The existing
`facebook-conversions` destination ID and event function remain compatible; the
display name becomes **Meta Ads (Facebook & Instagram)**.

## Shared authentication

Use a system-user access token, supplied in destination credentials. The token
must have access to the selected ad account (audiences, `ads_management`) or
pixel/dataset (Conversions API). Accept Meta's Custom Audience terms in the ad
account before uploading. No OAuth application or new database tables are added.
Reverse ETL uses Graph API **v26.0**; the existing event function retains v24.0.

## Streams

| Stream | Modes and target | Delivery |
| --- | --- | --- |
| `audience` | First-run managed creation with snapshot-diff mirror; existing customer-list audience additions and explicit removals | POST/DELETE `/{audience}/users`, at most 1,000 records per Jitsu batch (Meta permits 10,000). Each batch has a deterministic, single-batch upload session. |
| `conversions` | Insert-only, pixel/dataset ID; no removals or mirroring | POST `/{pixel}/events`, at most 1,000 events. Stable source keys become default event IDs. |

Audience identifiers support raw/SHA-256 contacts, demographic matching fields,
external IDs, mobile advertising IDs and page-scoped IDs. Hash only at extraction;
saved wire payloads are never normalized again. A stable primary matching key
(external ID, email, phone, mobile ID, page ID, then demographic tuple) identifies
membership. Removal excludes values/privacy settings and other mutable matching
attributes. Different source rows with the same key and conflicting payloads fail
instead of choosing arbitrarily. A model should use a consistent identifier for
each person; Jitsu cannot infer that unrelated identifiers match the same Meta user.

Conversions support raw/hashed customer information, browser identifiers,
event name/time/ID/source, custom data, app data and limited-data-use parameters.
Only conditional provider requirements are enforced (for example website URL and
user agent, or app tracking flags and extended info). Unmapped event time defaults
to extraction time and is then journaled. **Test event codes do not prevent real
targeting/measurement** according to Meta; they are not a sandbox.
Business-messaging events support Messenger, WhatsApp and Instagram with a
preconfigured channel-associated dataset. Map the channel and its account/user
identifier pair (Page + PSID; WhatsApp Business Account + CTWA click ID; Instagram
business account + Instagram-scoped ID). Dataset provisioning is not included.

## Acceptance and recovery

Accepted means the API acknowledged all submitted records without reported invalid
entries, **not matched people, targetable audience size or attributed conversions**.
Meta matching and audience-size reporting are asynchronous and approximate.
Jitsu does not infer a per-row result from partial/invalid aggregate counts.
Unexpected or partial responses retain uncertain delivery for reconciliation.
Permanent request rejection stops the run; no bad-row skipping or automatic write
retries. The core persists payloads before any write.

Audience recovery looks up the exact deterministic session and requires complete
receipt evidence; missing or ambiguous evidence never authorizes re-upload.
Conversions have no equivalent durable status lookup: an uncertain submission
requires manual reconciliation, even with event-ID deduplication (which is not an
indefinite replay guarantee). Finish/abort perform no remote writes.

Managed creation saves a random discovery marker and a CAS submission claim in
runner `source_state` before POST. After a crash, discover by that exact marker;
never create again because a lookup returned no result. Mirror is permitted only
for this verified, exclusively managed baseline. The core owns snapshots,
deduplication, accepted-membership state and addition-before-removal ordering.
An empty full model removes tracked membership. No native replacement/clear-and-fill.
Normal mirror runs refresh unchanged members after 30 days because Meta retains
external-ID mappings for 90 days. Run the sync regularly; a long pause can outlive
Meta's retention and Jitsu cannot recover expired remote identifier mappings.
Matching is asynchronous, so diff mirroring is not an atomic audience swap.
Destination credentials remain revision-bound by the current core; coordinate
token rotation with the existing state-preserving configuration-change workflow.

## Parity and intentional limits

Hightouch and Segment offer creation, existing audiences and add/remove mirroring.
This implements those workflows, restricting mirror to a Jitsu-created baseline.
Hightouch also documents optional clear-and-fill; it is deliberately excluded.
No account-sharing UI, audience-ID picker, audience identifier-array fan-out,
lookalike audience creation or event-match-quality reporting in this PR.
Value-based customer lists are supported; Meta still owns matching/eligibility.
Hightouch's native connector source was not found in its official public repos.
Segment and Syncmaven were inspected as references; no source was copied.

## References

- https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences/
- https://developers.facebook.com/docs/marketing-api/reference/custom-audience/users/
- https://developers.facebook.com/docs/marketing-api/reference/custom-audience/sessions/
- https://developers.facebook.com/docs/marketing-api/reference/custom-audience-session/
- https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/
- https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/
- https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters/
- https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
- https://github.com/facebook/facebook-nodejs-business-sdk
- https://hightouch.com/docs/destinations/meta
- https://hightouch.com/docs/destinations/meta-conversions
- https://www.twilio.com/docs/segment/connections/destinations/catalog/actions-facebook-custom-audiences
- https://github.com/segmentio/action-destinations/tree/main/packages/destination-actions/src/destinations/facebook-custom-audiences

## Rollout

Deploy console and runner manually together; no `deploy:console` label. No schema
migration. Tests use mocked HTTP only. A live test needs explicit approval of the
account, audience/dataset and allowed writes; conversion delivery cannot be undone.
