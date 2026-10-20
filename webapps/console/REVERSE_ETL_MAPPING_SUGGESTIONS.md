# Reverse ETL mapping suggestions

Set `TYPESAFE_API_KEY` on the **console server** to enable Jev requests. Optionally set
`TYPESAFE_MAPPING_MODEL` (default `jev-1.14.0`). No runner, database migration, or destination
credentials change is needed. Console deployment is manual for this PR.
The button is hidden when the key is absent or blank. Public app configuration exposes
only a boolean availability flag, never the key itself.

Users choose **Suggest mappings**, review the results, then apply selected mappings to the
unsaved form. Existing mappings are not replaced. Changing the model, destination, stream,
mapping or stream settings invalidates suggestions. Webhook's identity payload does not need
suggestions. Locked syncs remain locked.

All semantic matching uses Jev: no alias table, fuzzy matcher, or name-based fallback.
Each unconfigured visible mapping control is a Choice over actual columns plus “none”.
Raw and SHA-256 variants share one question so they cannot both be applied. Instructions
explicitly cover ambiguous business meanings, missing evidence, and input formats.
Every question identifies the destination and stream by catalog ID and display name.
These are product names (for example Google Ads / Audience), not customer-entered destination
names or account identifiers.

Only source column names/types and provider-owned field descriptions, requirements, and
enumerated selector labels go to TypeSafe. No row samples, SQL, credentials, arbitrary
stream settings, or user-entered account/audience names are included. Schema names can
themselves be sensitive: enable the service only when this disclosure is appropriate.
Requests/responses and provider errors are not logged by this integration.

Confidence >= 0.8 and a probability lead >= 0.2 preselect a suggestion **inside the review
dialog only**. All other choices require user selection. These are conservative starting
heuristics, not measured accuracy guarantees. Alternatives show the top three non-zero
column/format candidates. Validation checks the provider's response shape and candidate
membership before showing any result; partial provider failures discard the whole result.
Confidence in “none” is labeled as such, not as confidence in a weak alternative. Confident
no-match fields are collapsed separately from suggested and uncertain matches.

Safeguards: workspace edit permission and Reverse ETL flag, five requests per principal
per minute, 1–127 unique columns (two formats plus none fit the 255-choice API limit),
48 KB per provider request, at most ten sequential batches, 30-second provider deadline,
60-second overall deadline and cancellation on disconnect. Oversized requests fail with
manual mapping still available; candidates are never silently truncated.

## Evaluation before rollout

Tests use synthetic schemas and stubbed TypeSafe responses; they verify integration behavior,
not Jev's matching quality. Run a separate synthetic-schema evaluation with the configured
model before enabling broadly. Include Google/Meta/Microsoft streams; ambiguous timestamps,
billing/shipping contacts, gross/net values, raw/hash pairs, multiple plausible columns,
missing required fields, misleading names, non-English names, and no suitable match.
Measure precision of preselected suggestions, coverage, ambiguity handling, latency and
token usage. Adjust thresholds only using those results. Do not submit real customer rows.

### Initial live smoke check (2026-10-20, before explicit destination context)

Tested `jev-1.14.0` with six synthetic schemas: Google raw audience contacts, Google hashed
email, Meta purchase conversions, Microsoft offline conversions, ambiguous billing/shipping
emails, and unrelated inventory columns. Of 19 expected mappings, 17 were correctly
preselected; hashed email and Meta event name remained available for explicit review.
No mappings were preselected for the ambiguous or unrelated schemas. Seven provider
requests consumed 43,032 input tokens; per-fixture elapsed times were 221–614 ms locally.
This small smoke check confirms the integration, not general accuracy or latency guarantees.

API references: [Choice](https://docs.typesafe.ai/primitives/choice),
[System One](https://docs.typesafe.ai/api/system-one), [Confidence](https://docs.typesafe.ai/confidence).
