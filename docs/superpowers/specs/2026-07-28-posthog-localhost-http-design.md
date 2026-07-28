# PostHog Localhost HTTP Design

## Goal

Allow PostHog destinations to use HTTP for local development while requiring HTTPS for all non-localhost hosts.

## User Interface

The Host field will use the console's standard text input. Users enter the complete URL, including its scheme. The custom `SchemaHostField`, its fixed scheme addon, its conversion helpers, and its editor registry entry will be removed.

The existing default remains `https://app.posthog.com`.

## Validation

The shared `PosthogDestinationConfig` schema will accept exactly two forms:

- an HTTPS URL containing only a valid ASCII DNS domain, such as `https://app.posthog.com`; or
- `http://localhost` with an optional port from 1 through 65535, such as `http://localhost:8000`.

Matching is case-insensitive. Internationalized domains are accepted only in their ASCII Punycode form.

The schema rejects schemeless values, HTTP for non-localhost domains, HTTPS localhost, IP addresses, credentials, paths, query strings, fragments, whitespace, port 0, and ports greater than 65535.

The regex constraint must work identically in Zod and in the JSON Schema/AJV validation used by the console.

## Error Message

Pattern validation errors will be presented as:

> must be a valid host, for example https://app.posthog.com or http://localhost:8000

The internal regex must not appear in inline or modal errors.

## Tests

Schema tests will cover valid HTTPS domains, valid localhost HTTP ports and boundaries, and each rejected category. Console JSON Schema/AJV tests will cover the same two accepted forms and confirm the user-facing validation message metadata.

The obsolete `SchemaHostField` tests will be removed with the component.
