# PostHog Localhost HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept `http://localhost` with an optional valid port for PostHog while requiring HTTPS DNS-domain URLs everywhere else.

**Architecture:** Keep the complete URL in the existing PostHog Zod schema and encode both accepted forms in a JSON-Schema-compatible regex. Remove the now-unnecessary custom host field so the console uses its standard text input, while retaining field-specific validation-message transformation.

**Tech Stack:** TypeScript, Zod 3, JSON Schema, AJV, React 18, RJSF, Vitest

## Global Constraints

- Users enter and persist the complete URL, including its scheme.
- HTTPS is required for non-localhost DNS domains.
- HTTP is allowed only for exact `localhost`, with an optional port from 1 through 65535.
- Reject HTTPS localhost, IP addresses, paths, queries, fragments, credentials, whitespace, port 0, and ports above 65535.
- Keep `https://app.posthog.com` as the default.
- Zod and JSON Schema/AJV must enforce the same contract.
- Display `must be a valid host, for example https://app.posthog.com or http://localhost:8000` instead of the regex.

---

### Task 1: Expand the shared PostHog host schema

**Files:**
- Modify: `libs/destination-functions/__tests__/posthog-config.test.ts`
- Modify: `libs/destination-functions/src/meta.ts:336-351`

**Interfaces:**
- Consumes: `PosthogDestinationConfig.safeParse({ key, host })`
- Produces: `POSTHOG_HOST_PATTERN`, accepting HTTPS DNS domains or HTTP localhost with an optional valid port

- [ ] **Step 1: Add failing schema cases**

Extend the accepted table with:

```ts
"http://localhost",
"http://LOCALHOST",
"http://localhost:1",
"http://localhost:3000",
"http://localhost:65535",
```

Extend the rejected table with:

```ts
"https://localhost",
"https://localhost:3000",
"http://posthog.com",
"http://localhost:0",
"http://localhost:65536",
"http://localhost:99999",
"http://localhost/path",
"http://localhost:3000/path",
"http://127.0.0.1:3000",
```

- [ ] **Step 2: Run the schema test and verify RED**

```bash
cd libs/destination-functions
corepack pnpm exec vitest run __tests__/posthog-config.test.ts --reporter=verbose
```

Expected: the new valid localhost cases fail because the current pattern accepts only HTTPS DNS domains.

- [ ] **Step 3: Implement the minimal schema pattern**

Replace `POSTHOG_HOST_PATTERN` with one anchored alternation:

```ts
export const POSTHOG_HOST_PATTERN =
  /^(?:[hH][tT][tT][pP][sS]:\/\/(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|[hH][tT][tT][pP]:\/\/[lL][oO][cC][aA][lL][hH][oO][sS][tT](?::(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)$/;
```

Update the Zod regex message to describe the complete host rather than HTTPS-only input:

```ts
.regex(POSTHOG_HOST_PATTERN, "Host must be an HTTPS domain or HTTP localhost URL")
```

- [ ] **Step 4: Run the schema test and verify GREEN**

```bash
cd libs/destination-functions
corepack pnpm exec vitest run __tests__/posthog-config.test.ts --reporter=verbose
```

Expected: all schema cases pass.

### Task 2: Remove the custom field and verify console validation

**Files:**
- Delete: `webapps/console/components/ConfigObjectEditor/SchemaHostField.tsx`
- Delete: `webapps/console/__tests__/unit/schema-host-field.test.ts`
- Modify: `webapps/console/pages/[workspaceId]/destinations.tsx`
- Modify: `webapps/console/lib/schema/destinations.tsx:1030-1040`
- Modify: `webapps/console/__tests__/unit/posthog-json-schema.test.ts`

**Interfaces:**
- Consumes: the PostHog Zod schema converted by `zodToJsonSchema`
- Produces: standard RJSF text input metadata containing only the custom `pattern` validation message

- [ ] **Step 1: Update console tests first**

In `posthog-json-schema.test.ts`, replace the accepted case table with:

```ts
test.each([
  "https://POSTHOG.EXAMPLE.COM",
  "HTTPS://APP.POSTHOG.COM",
  "http://localhost",
  "http://LOCALHOST:3000",
  "http://localhost:65535",
])("accepts supported host %s", host => {
  expect(validate(config(host))).toBe(true);
});
```

Add rejected AJV cases:

```ts
test.each([
  "http://posthog.example.com",
  "https://localhost",
  "http://localhost:0",
  "http://localhost:65536",
  "http://localhost:3000/path",
])("rejects unsupported host %s", host => {
  expect(validate(config(host))).toBe(false);
});
```

Change the metadata expectation to:

```ts
expect(coreDestinationsMap.posthog.credentialsUi).toEqual({
  host: {
    validationMessages: {
      pattern: "must be a valid host, for example https://app.posthog.com or http://localhost:8000",
    },
  },
});
```

- [ ] **Step 2: Run the console test and verify RED**

```bash
cd webapps/console
corepack pnpm exec vitest run --project unit __tests__/unit/posthog-json-schema.test.ts --reporter=verbose
```

Expected: localhost cases and the metadata expectation fail.

- [ ] **Step 3: Remove custom field wiring**

Delete `SchemaHostField.tsx` and its dedicated unit test. Remove its import and `"SchemaHostField"` branch from `getEditorComponent()` in `destinations.tsx`.

Remove the `editor` property from PostHog host UI metadata and update the pattern message:

```ts
credentialsUi: {
  host: {
    validationMessages: {
      pattern: "must be a valid host, for example https://app.posthog.com or http://localhost:8000",
    },
  },
},
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
cd webapps/console
corepack pnpm exec vitest run --project unit __tests__/unit/posthog-json-schema.test.ts --reporter=verbose
```

Expected: all PostHog JSON Schema and metadata cases pass.

### Task 3: Final verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed schema and console changes
- Produces: fresh verification evidence

- [ ] **Step 1: Run affected tests**

```bash
cd libs/destination-functions
corepack pnpm exec vitest run __tests__/posthog-config.test.ts --reporter=verbose
cd ../../webapps/console
corepack pnpm exec vitest run --project unit --reporter=verbose
```

Expected: both suites pass.

- [ ] **Step 2: Run formatting and whitespace checks**

```bash
cd ../..
corepack pnpm format:check
git diff --check
```

Expected: both checks pass.

- [ ] **Step 3: Review the final diff**

```bash
git status --short
git diff --stat
git diff
```

Expected: only the PostHog schema/tests, standard-field metadata, and removal of `SchemaHostField` are changed.
