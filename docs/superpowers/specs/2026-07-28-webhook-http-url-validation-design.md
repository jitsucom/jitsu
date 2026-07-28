# Webhook HTTP(S) URL Validation Design

## Goal

Validate the Webhook destination `url` field consistently in the console and
the shared destination schema. A saved Webhook URL must be an absolute URL that
JavaScript's `URL` class accepts and whose protocol is HTTP or HTTPS.

## Validation Rules

The URL is valid when all of the following are true:

- `new URL(value)` succeeds.
- The parsed protocol is exactly `http:` or `https:`.

This permits HTTP and HTTPS URLs containing any components supported by
JavaScript's `URL` class, including localhost, IP addresses, credentials, ports,
paths, query strings, and fragments.

This rejects relative and malformed URLs, as well as URLs using other protocols
such as FTP, mailto, data, file, and JavaScript.

## Architecture

The shared `WebhookDestinationConfig` Zod schema remains the authoritative
validation boundary. Its existing `.url()` check already uses JavaScript's
`URL` parser in the installed Zod version. An additional refinement will
restrict the parsed protocol to HTTP or HTTPS.

The console will add a focused HTTP(S) URL validator using the same algorithm:
parse with `new URL`, then inspect the protocol. The Webhook destination's
`credentialsUi.url` metadata will register this validator through the existing
`clientValidator` hook. This gives immediate field feedback and prevents save
without changing the generic form renderer or enabling JSON Schema URL
validation globally.

The validation helper will return:

> must be a valid HTTP(S) URL, for example https://example.com/webhook

The message avoids exposing an implementation pattern or regular expression.

## Data Flow

1. The user enters a Webhook destination URL.
2. The console field validator parses the value and checks its protocol.
3. Invalid input marks only the URL field invalid and displays the friendly
   example message; valid input leaves the field unmarked.
4. On save, the shared Zod schema repeats the parse and protocol checks.
5. The Webhook runtime receives the validated URL unchanged, preserving the
   complete URL, including any port, path, query string, or fragment.

## Testing

Shared-schema tests will verify acceptance of representative HTTP and HTTPS
URLs, including localhost, IP addresses, ports, credentials, paths, queries,
and fragments. They will verify rejection of non-HTTP(S), relative, and
malformed values.

Console unit tests will exercise the client helper with matching accepted and
rejected cases. A metadata test will verify that the Webhook URL field is wired
to the helper, including its friendly error message.

Existing Webhook runtime tests will continue to confirm that the complete URL
is used without normalization or truncation.

## Non-Goals

- Restricting Webhook URLs to public domains or particular hosts.
- Blocking localhost, private IP addresses, credentials, ports, paths, queries,
  or fragments.
- Rewriting, normalizing, or prefixing user input.
- Changing PostHog, GA4, or generic form validation behavior.
