# Reverse ETL delivery behavior

## Advertising conversions

Google, Meta, and Microsoft conversion streams send new model primary keys; editing
a previously submitted row does not resend it. Use one stable primary key per event.
Google conversion adjustments are separate events: each adjustment needs a new model
primary key and must identify the original conversion through its mapping.

For Meta conversions, unknown submission outcomes require manual reconciliation;
event-ID deduplication does not provide an unlimited replay guarantee. Microsoft
conversion submissions with uncertain outcomes are not automatically replayed.
Inspect the run logs before retrying or resetting state: a lost response does not
prove that the destination failed to receive the request.

API acceptance is not audience matching or conversion attribution. Audience matching
can be asynchronous, and provider-side results may lag behind accepted delivery.

## Audience mirroring

Changes-only mirroring uploads additions/changes before removing tracked members
absent from the full model. An empty model clears tracked membership. Use the full
audience query, not a query returning only recent changes.

Google full replacement uploads every member before requesting cleanup of older
membership. An empty model clears the audience. Do not write to the same audience
from other tools while Jitsu exclusively manages it.

Existing Meta and Microsoft audiences support additions and explicit removals via
a model delete column; their existing membership is not imported as a mirror baseline.

## Webhook delivery

Webhook requests use JSON POST bodies with
`{syncId, runId, sentAt, records:[{operation, key, idempotencyKey, data}]}`.
All selected model columns are included in `data`; rename or reshape them in SQL.
Binary values become base64, intervals become ISO 8601 durations, and NaN/Infinity
become strings.

Delivery is at least once. The endpoint must use each record's `idempotencyKey` to
tolerate repeated delivery after failures or restarts. A rejected record stops the
run and is sent again on the next run. Request-size limits also apply to single rows.
Use HTTPS: HTTP exposes both row data and header credentials in transit.
