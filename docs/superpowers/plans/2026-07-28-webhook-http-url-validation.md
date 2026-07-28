# Webhook HTTP(S) URL Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the Webhook destination URL to be an absolute HTTP or HTTPS URL in both the shared schema and the console form.

**Architecture:** Keep `WebhookDestinationConfig` as the authoritative boundary by retaining Zod's JavaScript-`URL`-based `.url()` check and adding a safe protocol refinement. Add a focused console helper that repeats the same `new URL` plus protocol check and wire it through the existing per-field `clientValidator` metadata so users receive immediate, friendly feedback.

**Tech Stack:** TypeScript, Zod 3, JavaScript `URL`, React JSON Schema Form metadata, Vitest, pnpm 10.22.0

## Global Constraints

- Accept only absolute URLs for which `new URL(value)` succeeds.
- Accept only the exact protocols `http:` and `https:`.
- Allow localhost, IPv4, IPv6, credentials, ports, paths, query strings, and fragments.
- Reject relative, malformed, FTP, mailto, data, file, and JavaScript URLs.
- Preserve the complete user-entered URL; do not prefix, normalize, or truncate it.
- Display `must be a valid HTTP(S) URL, for example https://example.com/webhook` for console validation failures.
- Do not change PostHog, GA4, the Webhook runtime request logic, or generic form validation behavior.
- Use the pinned package manager executable: `node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs`.

## File Structure

- Create `libs/destination-functions/__tests__/webhook-config.test.ts` for isolated shared-schema acceptance and rejection coverage.
- Modify `libs/destination-functions/src/meta.ts` to add the safe HTTP(S) protocol refinement to `WebhookDestinationConfig.url`.
- Create `webapps/console/lib/schema/http-url-validation.ts` for the client-side HTTP(S) validator and its user-facing message.
- Create `webapps/console/__tests__/unit/webhook-url-validation.test.ts` for helper behavior and Webhook metadata wiring.
- Modify `webapps/console/lib/schema/destinations.tsx` to register the helper on `credentialsUi.url`.

---

### Task 1: Enforce HTTP(S) in the Shared Webhook Schema

**Files:**
- Create: `libs/destination-functions/__tests__/webhook-config.test.ts`
- Modify: `libs/destination-functions/src/meta.ts`

**Interfaces:**
- Consumes: JavaScript global `URL` and Zod's existing `z.string().url()` schema.
- Produces: `WebhookDestinationConfig` whose `url` property accepts only absolute HTTP(S) URLs while preserving the existing inferred `string` type.

- [ ] **Step 1: Write the failing shared-schema tests**

Create `libs/destination-functions/__tests__/webhook-config.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { WebhookDestinationConfig } from "../src/meta";

describe("WebhookDestinationConfig URL", () => {
  test.each([
    "https://example.com/webhook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://[::1]:8080/hook",
    "https://user:pass@example.com:8443/path?key=value#fragment",
  ])("accepts HTTP(S) URL %s", url => {
    expect(WebhookDestinationConfig.safeParse({ url }).success).toBe(true);
  });

  test.each([
    "ftp://example.com/hook",
    "mailto:user@example.com",
    "data:text/plain,hello",
    "file:///tmp/hook",
    "javascript:alert(1)",
    "/relative/hook",
    "not a URL",
  ])("rejects unsupported URL %s", url => {
    expect(WebhookDestinationConfig.safeParse({ url }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify the protocol cases fail**

Run:

```bash
cd libs/destination-functions
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run __tests__/webhook-config.test.ts --reporter=verbose
```

Expected: the HTTP(S) cases pass, while at least the FTP, mailto, data, file, and JavaScript cases fail the test because the current `.url()` schema accepts protocols supported by JavaScript's `URL` class.

- [ ] **Step 3: Add the minimal safe protocol refinement**

In `libs/destination-functions/src/meta.ts`, add a focused predicate near `WebhookDestinationConfig`:

```ts
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
```

Then change only the Webhook `url` property:

```ts
url: z
  .string()
  .url()
  .refine(isHttpUrl, "Webhook URL must use HTTP or HTTPS")
  .describe("Webhook URL"),
```

Keep the `try`/`catch` even though `.url()` precedes the refinement: the predicate must remain safe if Zod evaluates multiple checks for malformed input.

- [ ] **Step 4: Run the focused schema test**

Run:

```bash
cd libs/destination-functions
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run __tests__/webhook-config.test.ts --reporter=verbose
```

Expected: all accepted and rejected cases pass.

- [ ] **Step 5: Run the existing Webhook runtime tests**

Run:

```bash
cd libs/destination-functions
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run __tests__/webhook-destination.test.ts --reporter=verbose
```

Expected: all existing Webhook tests pass, confirming the runtime still receives and uses its configured URL unchanged.

- [ ] **Step 6: Commit the shared-schema change**

```bash
git add libs/destination-functions/src/meta.ts libs/destination-functions/__tests__/webhook-config.test.ts
git commit -m "fix(destinations): restrict Webhook URLs to HTTP(S)"
```

### Task 2: Add Immediate Console Validation

**Files:**
- Create: `webapps/console/lib/schema/http-url-validation.ts`
- Create: `webapps/console/__tests__/unit/webhook-url-validation.test.ts`
- Modify: `webapps/console/lib/schema/destinations.tsx`

**Interfaces:**
- Consumes: `ClientFieldValidator` through `DestinationType.credentialsUi`, JavaScript global `URL`, and `coreDestinationsMap`.
- Produces: `INVALID_HTTP_URL_MESSAGE: string` and `validateHttpUrl(value: unknown): string | undefined`; the Webhook metadata exposes `credentialsUi.url.clientValidator === validateHttpUrl`.

- [ ] **Step 1: Write failing helper and metadata tests**

Create `webapps/console/__tests__/unit/webhook-url-validation.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import {
  INVALID_HTTP_URL_MESSAGE,
  validateHttpUrl,
} from "../../lib/schema/http-url-validation";

describe("Webhook destination URL field", () => {
  test.each([
    "https://example.com/webhook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://[::1]:8080/hook",
    "https://user:pass@example.com:8443/path?key=value#fragment",
  ])("accepts HTTP(S) URL %s", value => {
    expect(validateHttpUrl(value)).toBeUndefined();
  });

  test.each([
    undefined,
    "",
    "ftp://example.com/hook",
    "mailto:user@example.com",
    "data:text/plain,hello",
    "file:///tmp/hook",
    "javascript:alert(1)",
    "/relative/hook",
    "not a URL",
  ])("rejects unsupported URL %s", value => {
    expect(validateHttpUrl(value)).toBe(INVALID_HTTP_URL_MESSAGE);
  });

  test("uses a friendly example-based error message", () => {
    expect(INVALID_HTTP_URL_MESSAGE).toBe(
      "must be a valid HTTP(S) URL, for example https://example.com/webhook"
    );
  });

  test("registers the validator on the Webhook URL field", () => {
    expect(coreDestinationsMap.webhook.credentialsUi?.url?.clientValidator).toBe(validateHttpUrl);
  });
});
```

- [ ] **Step 2: Run the console test and verify it fails**

Run:

```bash
cd webapps/console
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run --project unit __tests__/unit/webhook-url-validation.test.ts --reporter=verbose
```

Expected: FAIL because `http-url-validation.ts` and the Webhook URL metadata registration do not exist.

- [ ] **Step 3: Implement the client validator**

Create `webapps/console/lib/schema/http-url-validation.ts`:

```ts
export const INVALID_HTTP_URL_MESSAGE =
  "must be a valid HTTP(S) URL, for example https://example.com/webhook";

export function validateHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return INVALID_HTTP_URL_MESSAGE;
  }

  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? undefined : INVALID_HTTP_URL_MESSAGE;
  } catch {
    return INVALID_HTTP_URL_MESSAGE;
  }
}
```

- [ ] **Step 4: Wire the validator to the Webhook URL field**

In `webapps/console/lib/schema/destinations.tsx`, import the helper:

```ts
import { validateHttpUrl } from "./http-url-validation";
```

Add `url` without changing the existing Webhook field metadata:

```ts
credentialsUi: {
  url: {
    clientValidator: validateHttpUrl,
  },
  headers: {
    editor: "StringArrayEditor",
  },
  // Existing payload and signature field metadata remain unchanged.
},
```

- [ ] **Step 5: Run the focused console unit test**

Run:

```bash
cd webapps/console
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run --project unit __tests__/unit/webhook-url-validation.test.ts --reporter=verbose
```

Expected: all helper, message, and metadata wiring tests pass.

- [ ] **Step 6: Run the complete console unit project**

Run:

```bash
cd webapps/console
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run --project unit --reporter=verbose
```

Expected: all console unit tests pass, including the existing PostHog and generic config-editor validation coverage.

- [ ] **Step 7: Check formatting for every changed implementation file**

Run from the repository root:

```bash
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec prettier --check \
  libs/destination-functions/src/meta.ts \
  libs/destination-functions/__tests__/webhook-config.test.ts \
  webapps/console/lib/schema/http-url-validation.ts \
  webapps/console/lib/schema/destinations.tsx \
  webapps/console/__tests__/unit/webhook-url-validation.test.ts
git diff --check
```

Expected: Prettier reports every listed file as formatted and `git diff --check` produces no output.

- [ ] **Step 8: Commit the console change**

```bash
git add webapps/console/lib/schema/http-url-validation.ts \
  webapps/console/lib/schema/destinations.tsx \
  webapps/console/__tests__/unit/webhook-url-validation.test.ts
git commit -m "fix(console): validate Webhook HTTP URLs"
```

### Task 3: Final Cross-Layer Verification

**Files:**
- Verify only; no file changes expected.

**Interfaces:**
- Consumes: the shared Webhook schema, console client validator, and Webhook metadata produced by Tasks 1 and 2.
- Produces: evidence that the server and client accept and reject the same URL categories without regressing Webhook runtime or other console unit behavior.

- [ ] **Step 1: Run all relevant destination tests together**

Run:

```bash
cd libs/destination-functions
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run \
  __tests__/webhook-config.test.ts \
  __tests__/webhook-destination.test.ts \
  --reporter=verbose
```

Expected: all Webhook schema and runtime tests pass.

- [ ] **Step 2: Run the complete console unit project again**

Run:

```bash
cd webapps/console
node /Users/chris/.cache/node/corepack/v1/pnpm/10.22.0/bin/pnpm.cjs exec vitest run --project unit --reporter=verbose
```

Expected: all console unit tests pass.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
git diff origin/newjitsu...HEAD -- \
  libs/destination-functions/src/meta.ts \
  libs/destination-functions/__tests__/webhook-config.test.ts \
  webapps/console/lib/schema/http-url-validation.ts \
  webapps/console/lib/schema/destinations.tsx \
  webapps/console/__tests__/unit/webhook-url-validation.test.ts
```

Expected: only the intended Webhook schema, helper, metadata, and test changes appear for this feature; no whitespace errors are reported.
