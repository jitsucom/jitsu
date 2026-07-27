# PostHog Host Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require PostHog destination hosts to be full HTTPS URLs containing only a valid domain while presenting users with a fixed `https://` prefix and a domain-only input.

**Architecture:** The shared PostHog Zod schema owns the validation rule so console and API saves agree. A focused console widget translates between the persisted full host and the domain-only input without changing the stored configuration shape.

**Tech Stack:** TypeScript, Zod 3, React 18, Ant Design Input, Vitest, RJSF

## Global Constraints

- Persist the full host, for example `https://app.posthog.com`.
- The editable input contains only the domain and displays a fixed, non-editable `https://` prefix.
- Accept case-insensitive ASCII DNS domains with at least two labels; accept internationalized domains only in ASCII Punycode form.
- Reject ports, paths, query strings, fragments, credentials, IP addresses, `localhost`, malformed labels, and whitespace.
- Keep `https://app.posthog.com` as the default.
- Do not generalize prefix support across the form framework.
- Do not change PostHog event delivery or runtime host normalization.

---

## File Structure

- `libs/destination-functions/src/meta.ts`: define the shared HTTPS-domain pattern, enforce it on `PosthogDestinationConfig.host`, and select the PostHog editor through `PosthogDestinationConfigUi`.
- `libs/destination-functions/__tests__/posthog-config.test.ts`: exercise accepted and rejected persisted host values through the real Zod schema.
- `webapps/console/lib/schema/posthog-host.ts`: provide pure conversions between persisted hosts and editable domains.
- `webapps/console/components/ConfigObjectEditor/PosthogHostEditor.tsx`: render the Ant Design input with a fixed HTTPS prefix.
- `webapps/console/__tests__/unit/posthog-host.test.ts`: test the pure editor conversions without a browser environment.
- `webapps/console/pages/[workspaceId]/destinations.tsx`: register the PostHog editor name with the destination form.
- `webapps/console/lib/schema/destinations.tsx`: expose `PosthogDestinationConfigUi` on the PostHog destination.

### Task 1: Enforce the persisted PostHog host contract

**Files:**
- Create: `libs/destination-functions/__tests__/posthog-config.test.ts`
- Modify: `libs/destination-functions/src/meta.ts:336-387`

**Interfaces:**
- Consumes: `PosthogDestinationConfig.safeParse(input)`
- Produces: `POSTHOG_HOST_PATTERN: RegExp` and a `host` schema that accepts only `https://` followed by a valid domain

- [ ] **Step 1: Write the failing schema tests**

Create `libs/destination-functions/__tests__/posthog-config.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { PosthogDestinationConfig } from "../src/meta";

const config = (host: string) => ({ key: "phc_test", host });

describe("PosthogDestinationConfig host", () => {
  test.each([
    "https://posthog.com",
    "https://app.posthog.com",
    "https://analytics.example.co.uk",
    "https://POSTHOG.EXAMPLE.COM",
    "https://xn--e1afmkfd.xn--p1ai",
  ])("accepts domain-only HTTPS host %s", host => {
    expect(PosthogDestinationConfig.safeParse(config(host)).success).toBe(true);
  });

  test.each([
    "posthog.com",
    "http://posthog.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://posthog.com:8443",
    "https://posthog.com/path",
    "https://posthog.com?key=value",
    "https://posthog.com#fragment",
    "https://user:pass@posthog.com",
    "https://-posthog.com",
    "https://posthog-.com",
    "https://post_hog.com",
    "https://posthog..com",
    "https://posthog.com ",
  ])("rejects non-domain PostHog host %s", host => {
    expect(PosthogDestinationConfig.safeParse(config(host)).success).toBe(false);
  });

  test("keeps the existing default full host", () => {
    expect(PosthogDestinationConfig.parse({ key: "phc_test" }).host).toBe("https://app.posthog.com");
  });
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
cd libs/destination-functions
pnpm exec vitest run __tests__/posthog-config.test.ts
```

Expected: FAIL because the current `z.string()` accepts every rejected host.

- [ ] **Step 3: Add the minimal shared schema validation**

In `libs/destination-functions/src/meta.ts`, add the pattern next to `POSTHOG_DEFAULT_HOST` and apply it to `host`:

```ts
export const POSTHOG_DEFAULT_HOST = "https://app.posthog.com";
export const POSTHOG_HOST_PATTERN =
  /^https:\/\/(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const PosthogDestinationConfig = z.object({
  // existing key field
  host: z
    .string()
    .regex(POSTHOG_HOST_PATTERN, "Host must contain only a valid domain after https://")
    .optional()
    .default(POSTHOG_DEFAULT_HOST)
    .describe("Posthog host"),
  // remaining existing fields
});
```

Add the editor selection without changing the existing visibility corrections:

```ts
export const PosthogDestinationConfigUi: Partial<
  Record<keyof PosthogDestinationConfig, { correction?: any; hidden?: any; editor?: string }>
> = {
  host: {
    editor: "PosthogHostEditor",
  },
  // existing sendAnonymousEvents and enableAnonymousUserProfiles entries
};
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run:

```bash
cd libs/destination-functions
pnpm exec vitest run __tests__/posthog-config.test.ts
```

Expected: PASS with all accepted values, rejected values, and the default covered.

- [ ] **Step 5: Run the destination-functions typecheck**

Run:

```bash
pnpm --filter @jitsu/destination-functions typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the schema change**

```bash
git add libs/destination-functions/src/meta.ts libs/destination-functions/__tests__/posthog-config.test.ts
git commit -m "fix(destinations): validate PostHog host domain"
```

### Task 2: Add and wire the fixed-prefix PostHog editor

**Files:**
- Create: `webapps/console/lib/schema/posthog-host.ts`
- Create: `webapps/console/components/ConfigObjectEditor/PosthogHostEditor.tsx`
- Create: `webapps/console/__tests__/unit/posthog-host.test.ts`
- Modify: `webapps/console/pages/[workspaceId]/destinations.tsx:115-220`
- Modify: `webapps/console/lib/schema/destinations.tsx:1023-1031`

**Interfaces:**
- Consumes: `CustomWidgetProps<string>` and the `"PosthogHostEditor"` name emitted by `PosthogDestinationConfigUi`
- Produces: `POSTHOG_HTTPS_PREFIX`, `posthogHostToDomain(host?: string): string`, `posthogDomainToHost(domain: string): string`, and `PosthogHostEditor`

- [ ] **Step 1: Write the failing conversion tests**

Create `webapps/console/__tests__/unit/posthog-host.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { posthogDomainToHost, posthogHostToDomain } from "../../lib/schema/posthog-host";

describe("PostHog host editor conversion", () => {
  test("shows only the editable domain from a persisted HTTPS host", () => {
    expect(posthogHostToDomain("https://app.posthog.com")).toBe("app.posthog.com");
  });

  test("preserves an unrecognized legacy value so the user can correct it", () => {
    expect(posthogHostToDomain("posthog.internal")).toBe("posthog.internal");
  });

  test("stores an edited domain as a full HTTPS host", () => {
    expect(posthogDomainToHost("analytics.example.com")).toBe("https://analytics.example.com");
  });

  test("keeps an empty input empty so required validation remains visible", () => {
    expect(posthogDomainToHost("")).toBe("");
  });
});
```

- [ ] **Step 2: Run the conversion test to verify it fails**

Run:

```bash
cd webapps/console
pnpm exec vitest run --project unit __tests__/unit/posthog-host.test.ts
```

Expected: FAIL because `lib/schema/posthog-host.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure conversions**

Create `webapps/console/lib/schema/posthog-host.ts`:

```ts
export const POSTHOG_HTTPS_PREFIX = "https://";

export function posthogHostToDomain(host?: string): string {
  return host?.startsWith(POSTHOG_HTTPS_PREFIX) ? host.slice(POSTHOG_HTTPS_PREFIX.length) : host ?? "";
}

export function posthogDomainToHost(domain: string): string {
  return domain ? `${POSTHOG_HTTPS_PREFIX}${domain}` : "";
}
```

- [ ] **Step 4: Run the conversion test to verify it passes**

Run:

```bash
cd webapps/console
pnpm exec vitest run --project unit __tests__/unit/posthog-host.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the fixed-prefix React editor**

Create `webapps/console/components/ConfigObjectEditor/PosthogHostEditor.tsx`:

```tsx
import React from "react";
import { Input } from "antd";
import { CustomWidgetProps } from "./Editors";
import {
  POSTHOG_HTTPS_PREFIX,
  posthogDomainToHost,
  posthogHostToDomain,
} from "../../lib/schema/posthog-host";

export const PosthogHostEditor: React.FC<CustomWidgetProps<string>> = props => (
  <Input
    addonBefore={POSTHOG_HTTPS_PREFIX}
    disabled={props.disabled}
    type="text"
    value={posthogHostToDomain(props.value)}
    onChange={event => props.onChange(posthogDomainToHost(event.target.value))}
  />
);
```

- [ ] **Step 6: Register and select the editor**

Import `PosthogHostEditor` in `webapps/console/pages/[workspaceId]/destinations.tsx` and add this branch to `getEditorComponent`:

```tsx
} else if (editor === "PosthogHostEditor") {
  return PosthogHostEditor;
```

In the PostHog entry in `webapps/console/lib/schema/destinations.tsx`, expose the metadata:

```ts
credentials: meta.PosthogDestinationConfig,
credentialsUi: meta.PosthogDestinationConfigUi,
```

- [ ] **Step 7: Run focused console tests and typecheck**

Run:

```bash
cd webapps/console
pnpm exec vitest run --project unit __tests__/unit/posthog-host.test.ts
pnpm typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Run formatting validation**

Run:

```bash
pnpm format:check
git diff --check
```

Expected: both commands PASS with no whitespace errors.

- [ ] **Step 9: Commit the console editor**

```bash
git add webapps/console/lib/schema/posthog-host.ts webapps/console/components/ConfigObjectEditor/PosthogHostEditor.tsx webapps/console/__tests__/unit/posthog-host.test.ts 'webapps/console/pages/[workspaceId]/destinations.tsx' webapps/console/lib/schema/destinations.tsx
git commit -m "fix(console): constrain PostHog host input"
```

### Task 3: Verify the integrated behavior

**Files:**
- Verify only; no planned modifications

**Interfaces:**
- Consumes: the shared schema, JSON Schema conversion, editor registry, and editor conversion helpers from Tasks 1–2
- Produces: verification evidence that save-time validation and persisted value conversion work together

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
cd libs/destination-functions
pnpm exec vitest run __tests__/posthog-config.test.ts
cd ../..
cd webapps/console
pnpm exec vitest run --project unit __tests__/unit/posthog-host.test.ts
```

Expected: both suites PASS.

- [ ] **Step 2: Run affected package typechecks**

Run:

```bash
pnpm --filter @jitsu/destination-functions typecheck
pnpm --filter @jitsu-internal/console typecheck
```

Expected: both commands PASS.

- [ ] **Step 3: Confirm the final diff is scoped**

Run:

```bash
git status --short
git diff --check HEAD~2
git diff --stat HEAD~2
```

Expected: only the planned PostHog schema, tests, editor, wiring, and documentation files are present; no whitespace errors.
