# PostHog Host Validation Design

## Goal

Make the PostHog destination's Host field accept only a domain name while preserving the existing stored configuration format, such as `https://app.posthog.com`.

## User Interface

The Host field will use a PostHog-specific editor. The input will show a fixed, non-editable `https://` prefix and an editable domain portion. For example, the stored value `https://app.posthog.com` will be displayed as:

```text
https:// | app.posthog.com
```

When the domain changes, the editor will emit `https://${domain}` as the form value. The existing default remains `https://app.posthog.com`.

## Validation

The shared `PosthogDestinationConfig` Zod schema will require the Host value to contain:

- the `https://` scheme;
- an ASCII DNS domain with at least two dot-separated labels, where each label is 1–63 characters, starts and ends with an alphanumeric character, and otherwise contains only alphanumeric characters or hyphens; and
- no port, path, query string, fragment, credentials, IP address, `localhost`, or whitespace.

Putting the constraint in the shared schema ensures the console and server-side configuration APIs enforce the same rule. The regex constraint will also be represented in the JSON Schema used by the console form, so invalid values prevent saving and produce an inline field error.

Matching is case-insensitive. Internationalized domains are accepted in their ASCII Punycode form.

## Compatibility

The stored shape does not change: existing valid values such as `https://app.posthog.com` remain valid. No data migration is required. The PostHog runtime continues to receive a full HTTPS host, so its request construction does not change.

Existing values outside the new contract, such as schemeless hosts or hosts with paths, must be corrected before the destination can be saved again.

## Implementation Boundaries

- Add a small PostHog HTTPS-domain editor to the console's existing destination editor registry.
- Select that editor for the PostHog `host` field through `credentialsUi`.
- Tighten `PosthogDestinationConfig.host` in the shared destination metadata.
- Do not generalize prefix support across the form framework.
- Do not change PostHog event delivery or runtime host normalization.

## Tests

Schema tests will prove that standard and multi-level domains are accepted and that invalid scheme, path, port, query, fragment, credentials, IP, localhost, malformed labels, and whitespace are rejected.

A focused unit test of the editor's value conversion will prove that a full stored HTTPS host becomes a domain-only editable value and that editing it emits the full `https://` host.
