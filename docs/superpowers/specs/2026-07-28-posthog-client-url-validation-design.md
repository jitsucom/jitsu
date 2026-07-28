# PostHog Client URL Validation Design

## Goal

Validate the PostHog destination Host field as an HTTP(S) URL in the console, applying stricter rules only to
`posthog.com` and its subdomains.

## User Interface

The Host field uses the console's standard text input. Users enter and persist the complete URL, including its
scheme. The existing default remains `https://app.posthog.com`.

Validation runs through a reusable client-side field-validator hook in `ConfigEditor`. The PostHog Host metadata
selects a pure URL-parser validator without requiring a custom input component.

## Validation

The shared `PosthogDestinationConfig` schema keeps Host as a string with its existing default but no
PostHog-specific regex. Direct API writes therefore do not receive this console-only validation.

The client validator parses the complete value with `new URL()` and then applies these rules:

- The protocol must be `http:` or `https:`.
- A hostname is PostHog-owned when it is exactly `posthog.com` or ends with `.posthog.com`. Matching is
  case-insensitive and label-aware, so `notposthog.com` is not PostHog-owned.
- A PostHog-owned URL must be exactly `https://<hostname>`, ignoring case. It cannot contain credentials, a port,
  a trailing slash, a path, a query, or a fragment.
- Any non-PostHog hostname accepts the HTTP(S) URL forms supported by the browser URL parser, including
  credentials, ports, paths, queries, fragments, localhost, IPv4, and IPv6.

The validator preserves the user's full input and does not normalize or rewrite it.

## Client Validation Hook

`PropertyUI` and `FieldDisplay` gain an optional client validator. `ConfigEditor` passes a `customValidate`
callback to RJSF that runs configured validators against their field values and adds returned messages to the
matching field's error list. A validation error blocks the existing submit flow.

The hook remains generic so other configuration fields can use browser-native or cross-field validation later.
It does not replace JSON Schema validation.

## Error Messages

Malformed values and unsupported protocols display a friendly HTTP(S) URL example. PostHog-owned URLs that
violate the stricter contract display a specific message explaining that they require HTTPS without credentials,
a port, or a path. Native parser details are never shown.

## Tests

Unit tests for the pure validator cover:

- ordinary HTTP(S) URLs with credentials, ports, paths, queries, and fragments;
- localhost and IP addresses;
- rejection of malformed values and non-HTTP(S) protocols;
- exact and subdomain PostHog hostname matching;
- PostHog rejection for HTTP, credentials, ports, trailing slashes, paths, queries, and fragments;
- case-insensitive PostHog schemes and hostnames; and
- label boundaries such as `notposthog.com`.

Config-editor tests verify that field-validator errors are attached to the correct RJSF field and that valid
values add no errors. PostHog metadata tests verify that Host selects the URL-parser validator.

## Non-Goals

- Adding equivalent validation to direct API writes.
- Rewriting or normalizing entered URLs.
- Restricting non-PostHog HTTP(S) URL features beyond browser URL-parser validity.
