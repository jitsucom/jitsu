# Microsoft Advertising (Bing Ads) Reverse ETL

Implementation contract, verified 2026-10-09. Deployment remains manual.

## Shared authentication

One destination, `microsoft-ads`, with `audience` and `offline-conversions` streams.
Use the existing Nango OAuth infrastructure: integration `jitsu-cloud-dst-microsoft-ads`,
Microsoft identity v2, scopes `https://ads.microsoft.com/msads.manage offline_access`.
Provision the OAuth application/integration separately before enabling this destination.
Credentials contain customer ID, account ID and the destination-bound OAuth connection,
not access/refresh tokens. `MICROSOFT_ADS_DEVELOPER_TOKEN` on the runner is the cloud
default; self-hosted installations may supply a destination developer token. Configure
the same environment variable on console to hide the token field. Microsoft must grant
the OAuth user access to the account and issue an API developer token.

## Streams

| Stream | API v13 | Modes and identity | Mappings |
| --- | --- | --- | --- |
| `audience` | Campaign Management `ApplyCustomerListUserData` | Existing list: additions/explicit removals. Jitsu-created list: core snapshot diff. Target: audience ID (including across accounts sharing access); member: hashed email. | Email or SHA-256 email. Raw email is trimmed/lowercased then SHA-256 hashed; no provider-unrelated Gmail rewriting. Removal uses the same hash. |
| `offline-conversions` | Campaign Management `ApplyOfflineConversions` | Insert-only, source primary-key deduplication. Target: account/goal name. No mirror or remove. | Required mapped conversion time and click ID and/or raw/hashed email or phone; optional value/currency and external attribution credit/model. Goal name is sync configuration. Phone is E.164 before hashing. |

Both operations use at most 1,000 rows per call and the core byte budget. Indexed
partial errors become per-operation rejections; other successful rows remain accepted.
Permanent row errors stop the run after recording all known results. Accepted means
API ingestion, never matched people, targetability or attributed conversions. Unknown
response shapes, invalid error indexes and lost responses remain unresolved; no blind
write retries. HTTP status and numeric provider codes are logged, never free-text
provider messages, identifiers, credentials or request bodies. Recovery uses bound
saved receipts; without a receipt the operator must reconcile (a tracking ID alone is
not a queryable delivery job). Initialization/finalization have no remote side effects.

Managed lists are account-scoped, non-expiring (`MembershipDuration: -1`) and exclusively
managed by Jitsu. Source validation precedes creation. Persist a random description
marker and submitting intent before `AddAudiences`; retry conclusively unsent/rejected
creation requests, but recover ambiguous creation using `GetAudiencesByIds`
with omitted IDs. Never create again after an ambiguous submission. A unique marker,
scope, parent account, type and membership policy must match. No match/multiple matches
block creation recovery. Existing lists are never treated as empty or cleared to seed
a mirror. An empty managed model removes tracked members through the core.

Existing lists are validated by ID, Customer List type and authenticated API lookup,
not by matching their owner to the configured account/customer. Shared-list lookup
access does not imply write permission: Microsoft enforces that on each add/remove.
Managed-list owner, marker, scope and expiration checks remain strict.

Customer Match terms must already be accepted in Microsoft UI, or the user must
explicitly select acceptance in sync settings. Never accept terms implicitly.
Offline goals must exist for at least two hours before upload. Conversion times must
be UTC, within 90 days, and satisfy the goal's click/conversion window for attribution.
Source timestamps are required rather than generating a different time on each run.

## Scope and references

Hightouch documents audiences (new/existing, add/remove) and offline conversion inserts.
Its connector source was not found in public official repositories. No Microsoft Ads
implementation was found in Syncmaven's current tree. Segment's direct audience connector
is the API reference; its separate UET CAPI connector is not an offline-import adapter.
RudderStack uses asynchronous Bulk uploads and additionally supports conversion
restatements/retractions. Native audience replacement, adjustments, UET CAPI, array
email fan-out and account/audience pickers are not part of this initial implementation.
IDs are entered explicitly. Provider approval/live tests are not implied by mock tests.

- [Audience writes](https://learn.microsoft.com/en-us/advertising/campaign-management-service/applycustomerlistuserdata?view=bingads-13)
- [Customer List and expiration](https://learn.microsoft.com/en-us/advertising/campaign-management-service/customerlist?view=bingads-13)
- [Audience discovery](https://learn.microsoft.com/en-us/advertising/campaign-management-service/getaudiencesbyids?view=bingads-13)
- [Offline conversion writes](https://learn.microsoft.com/en-us/advertising/campaign-management-service/applyofflineconversions?view=bingads-13)
- [Offline conversion fields](https://learn.microsoft.com/en-us/advertising/campaign-management-service/offlineconversion?view=bingads-13)
- [Hightouch](https://hightouch.com/docs/destinations/bingads)
- [Segment source, revision 0bcc32d5](https://github.com/segmentio/action-destinations/tree/0bcc32d5f850188b9f7f87687d158d33e0dd9081/packages/destination-actions/src/destinations/ms-bing-ads-audiences) — package declares MIT; no code copied.
- [RudderStack source, revision 21f7e410](https://github.com/rudderlabs/rudder-server/tree/21f7e410b4f57fdabb522086c25c6b6d72575ddc/router/batchrouter/asyncdestinationmanager/bing-ads) — ELv2; behavioral research only, no code copied.

## Review decisions

- No schema, scheduling, billing, worker-lock or snapshot-engine changes.
- Single compiled-in provider with stream-specific metadata and strict dispatch.
- Microsoft-specific credentials are never sent to Google or vice versa.
- OAuth refresh is host-owned and does not mutate delivery revisions.
- Direct API acknowledgements do not claim downstream matches or attribution.
- Ambiguous writes block rather than re-upload or infer success.
- Creation intent is independent of the logical delivery run, with marker discovery.
- Managed lists use account scope and no automatic expiry; existing settings are untouched.
- Terms acceptance is explicit, not an automatic API default.
- No live provider writes or infrastructure deployments without separate approval.
