# Meta Reverse ETL results

The console reads current audience/dataset metrics separately from delivery receipts. Refreshing results makes only Graph API GET requests; it does not queue a runner, submit events, provision an audience, or alter synchronization state. Metrics apply to the whole target, including other senders, and are not a historical report for the selected execution attempt.

Custom Audiences report approximate lower/upper size bounds and processing/ad-eligibility status codes. The match range is an estimate using those bounds divided by the source-row count of the latest successful, completed, exclusive managed mirror snapshot. It is unavailable for existing audiences, incomplete or failed runs, older runs without aggregate counts, empty or deduplicated snapshots, privacy-limited estimates, and estimates inconsistent with the snapshot. It is not a measured upload match rate.

The runner records optional sealed snapshot aggregates in existing task statistics. They contain no row data and are never delivery/recovery authorization. They become available on a subsequent run with the updated runner; no state reset is needed. The console does not download snapshot artifacts to obtain a denominator.

Web conversion quality uses `GET /dataset_quality` with `dataset_id` and `fields=web{event_name,event_match_quality{composite_score},acr{percentage}}`. EMQ is a score out of ten. ACR is Meta's estimated percentage uplift alongside the browser Pixel, not an event count; it can exceed 100%. No partner filter is applied. Missing/null/invalid metrics remain unavailable rather than zero; non-web quality metrics are outside this endpoint's web response.

Quality reporting needs dataset access and the documented reporting permissions or Events Manager opt-in. A token that can deliver conversions may not be able to read quality metrics. Provider messages, ownership markers, tokens and payloads are not returned to the browser.

Deploy the runner and then the console. A console-only deployment still shows target metrics, but new snapshot aggregates require the updated runner. No migration, syncctl binary, or saved-state change is required.

Contracts checked 2026-10-08:

- [Meta Custom Audience reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/custom-audience).
- [Meta Dataset Quality API](https://developers.facebook.com/documentation/ads-commerce/conversions-api/dataset-quality-api).
- [Hightouch matched-user calculation and eligibility](https://hightouch.com/docs/destinations/meta#matched-users-count).
