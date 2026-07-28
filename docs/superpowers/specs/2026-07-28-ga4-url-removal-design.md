# GA4 URL Removal Design

## Goal

Remove the configurable URL from Google Analytics 4 Measurement Protocol destinations and always send requests to
Google's production collection endpoint.

## Configuration

`Ga4Credentials` will no longer contain a `url` property. The console generates the GA4 destination form from this
schema, so removing the property also removes the URL option from the UI.

The remaining GA4 credentials and defaults are unchanged.

## Runtime

The GA4 destination will define one endpoint constant:

```ts
const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
```

Every GA4 request will use this constant. The runtime will not read `ctx.props.url`.

Existing destinations may retain a legacy `url` property in stored configuration. It will be ignored immediately,
including when it contains a custom or invalid URL. The normal form save flow may remove the obsolete property later;
no data migration is required.

## Tests

Runtime tests will provide a legacy custom URL and verify that the fetch target still begins with
`https://www.google-analytics.com/mp/collect?`.

Schema tests will verify that generated GA4 credentials no longer expose or accept a `url` property through the
declared schema shape. Existing request-body behavior remains covered by the GA4 destination test suite.

## Non-Goals

- Supporting the GA4 debug collection endpoint.
- Migrating or rewriting stored destination records.
- Changing API secret, measurement ID, event filtering, or request payload behavior.
