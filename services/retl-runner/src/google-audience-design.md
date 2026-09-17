# Google managed audiences — implementation contract (2026-09-17)

JITSU-227; stacked on PR #1523. No live provider actions during implementation.

- Customer Match contact lists through Data Manager v1 `userLists` create/list/get;
  existing v1 ingest/remove/status delivery and OAuth `datamanager` scope remain.
- Explicit console provisioning is separate from sync execution. Persist a
  deterministic creation intent before POST; only one caller may submit it.
  Uncertain creation is looked up by its unique integration code/name, never
  blindly retried or replaced. No matches do not prove absence.
  Correlation uses a server-generated 256-bit nonce saved by the winning intent,
  not predictable request IDs; callers cannot pre-stamp an old list for adoption.
- Internal configuration objects hold creation evidence and the intended owning
  sync, destination/account and OAuth binding. They are not generic editable
  configuration types. The authenticated export supplies verified evidence;
  caller-supplied destination metadata cannot assert a managed baseline.
  Provisioning requires an existing non-deleted reverse sync, checked again after
  OAuth I/O. Disabled links are allowed so the future editor can create a disabled
  sync first, provision its audience, then configure/enable it. There is no
  client-chosen future-sync-ID reservation or new transaction around remote I/O.
- Mirror only Jitsu-created audiences reserved to one sync, with explicit exclusive
  management confirmation. Check current remote identity/type/ownership/marker on
  every attempt. Google account ownership is not an API-enforced Jitsu-only lock;
  operators must not add other writers. Never infer baseline from estimated size,
  adopt an arbitrary audience, clear an audience, or delete it on error.
- User confirmed 540-day membership and 30-day refresh during normal syncs.
  Core stores last accepted upload time per membership and an immutable refresh
  cutoff per snapshot. Fresh unchanged members stay skipped; due members use the
  same journal/acceptance path as additions before removals. Paused/failing syncs
  cannot guarantee no expiry; this is not a separate freshness scheduler.
- Email/phone raw or SHA-256 only; normalize once, deduplicate canonical hashed
  identifiers in core, and reuse persisted wire payloads in recovery. Existing
  audiences retain additions/removals only. Permanent row failures still stop.
- Hightouch documents new/existing list selection, not its native implementation.
  No native connector source was found in the public hightouchio repositories;
  Syncmaven's current tree has no Google audience adapter. No competitor code reused.
- Reverse sync editor/creation rollout remains the next slice. This change adds
  provisioning APIs, validated runtime binding and tests, not production deployment.

Sources verified 2026-09-17:

- https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/create-audience
- https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists/create
- https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists/list
- https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists
- https://support.google.com/google-ads/answer/6334160
- https://hightouch.com/docs/destinations/google-data-manager

Review decisions: no billing/encryption/worker-ownership layer or new audience
tables. Two Prisma-managed timestamp columns implement expiry refresh. Internal
provisioning CAS only prevents duplicate console POSTs; it is not a worker lease.
