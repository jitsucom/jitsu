import { z } from "zod";
import { UserProfileDbModel, WorkspaceDbModel } from "../../prisma/schema";
import { WorkspaceRolesZodType } from "../workspace-roles";
import { ConfigApiDeleteOptions } from "../useApi";

export const SessionUser = z.object({
  name: z.string(),
  email: z.string(),
  image: z.string().nullish(),
  loginProvider: z.string(),
  externalId: z.string(),
  internalId: z.string(),
  externalUsername: z.string().nullish(),
  mustChangePassword: z.boolean().nullish(),
  authType: z.string().nullish().optional(),
  // Set only when authType === "bearer". Identifies which UserApiToken row was used.
  tokenId: z.string().nullish().optional(),
  // Set only when authType === "bearer". Mirrors UserApiToken.type ("api", "cli", ...).
  tokenType: z.string().nullish().optional(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const ContextApiResponse = z.object({
  user: SessionUser,
  firstWorkspaceId: z.string().nullish().optional(),
  firstWorkspaceSlug: z.string().nullish().optional(),
  redirect: z.string().optional(),
});
export type ContextApiResponse = z.infer<typeof ContextApiResponse>;

/**
 * Parametrized in-app banner provided by the billing API (JITSU-88). The
 * console owns the card template (themed card, icon tile, title + badge pill,
 * action button) and fills it with these fields; copy and dismissal policy are
 * decided server-side. `body`, `icon` and `action.subtitle` are HTML fragments
 * (sanitized before rendering) — `body` carries the quota progress-bar markup.
 */
export const BillingBanner = z.object({
  /** Stable identity for client-side dismissal (a dismissed id stays hidden). */
  id: z.string(),
  /** Drives the template theme and the default icon. */
  severity: z.enum(["info", "warning", "error"]),
  /** Optional icon HTML overriding the default severity icon. */
  icon: z.string().optional(),
  title: z.string(),
  /** Status pill next to the title, e.g. "82% USED". */
  badge: z.string(),
  /** Body HTML (the message copy). */
  body: z.string(),
  /** Widget zone HTML under the body (quota progress bar); omitted in compact contexts. */
  extra: z.string().optional(),
  action: z
    .object({
      text: z.string(),
      /** Workspace-relative console path; the console prefixes the workspace. */
      location: z.string(),
      /** Small HTML line under the button. */
      subtitle: z.string().optional(),
      /** Show the action on the billing settings page. Missing = true. */
      onBillingPage: z.boolean().optional(),
    })
    .optional(),
  closeable: z.boolean(),
  /** Show this banner on the billing settings page. Missing = true. */
  onBillingPage: z.boolean().optional(),
  /**
   * Presentation: inline card ("banner", default) or blocking modal ("modal" —
   * non-closable mask; Jitsu admins can dismiss regardless of closeable).
   */
  kind: z.enum(["banner", "modal"]).optional(),
});

export type BillingBanner = z.infer<typeof BillingBanner>;

//Default values are for "free" (default) plan
export const BillingSettings = z.object({
  planId: z.string().default("free"),
  //if plan has a custom pricing prepared for a particular workspace
  customBilling: z.boolean().default(false).optional(),
  pastDue: z.boolean().default(false).optional(),
  //Can be "self-service" or "enterprise". Enterprise plans doesn't block workspace on overage, but requires manual billing.
  planKind: z.string().default("self-service").optional(),
  //similar to customBilling, but indicates that plan is custom. custom flag comes from stripe plan metadata
  custom: z.boolean().default(false).optional(),
  dailyActiveSyncs: z.number().default(1).optional(),
  dailyActiveSyncsOverage: z.number().default(20).optional(),
  maximumSyncFrequency: z.number().optional(), //minutes
  planName: z.string().optional(), //if not set - will be taken from planId
  overagePricePer100k: z.number().optional(),
  canShowProvisionDbCredentials: z.boolean().default(false),
  dataRetentionEditorEnabled: z.boolean().default(false).optional(),
  destinationEvensPerMonth: z.number().default(200_000),
  /**
   * End of the current period, or, on a committed contract, the end of the
   * commitment term (the contract anniversary for a commitment billed
   * quarterly). Always a UTC instant.
   */
  expiresAt: z.string().optional(),
  /**
   * Commitment term of a negotiated contract (JITSU-200), from the plan's
   * `plan_data`; absent for month-to-month plans. The quota stays monthly
   * regardless — this only says what `expiresAt` is the end of. Expected
   * values are "month" | "year", but it is typed loosely: the value is Stripe
   * metadata spread wholesale into the response, and a typo there must not
   * take the billing page down — an unknown value just renders no term.
   */
  commitmentInterval: z.string().nullable().optional(),
  /**
   * Current billing period, as reported by the billing API, always one month:
   * the Stripe cycle for a plain monthly price, otherwise the contract month
   * anchored on the subscription start (day-of-month, day 29–31 clamped). A
   * committed contract (JITSU-200) invoiced quarterly or annually still meters
   * `destinationEvensPerMonth` per month — there is no annual pool — and only
   * `expiresAt` reflects the commitment term. Absent for the free plan, where
   * the console falls back to the UTC calendar month.
   */
  currentPeriod: z
    .object({
      end: z.string(),
      start: z.string(),
    })
    .optional(),
  renewAfterExpiration: z.boolean().default(false).optional(),
  //if subscription starts some time in the future, for enterprise plans only
  futureSubscriptionDate: z.string().optional(),
  profileBuilderEnabled: z.boolean().default(false).optional(),
  /** Live Events observability export (JITSU-138); comes from stripe plan
   * metadata via billing/settings, like the other per-feature flags */
  observabilityExportsEnabled: z.boolean().default(false).optional(),
  isLegacyPlan: z.boolean().default(false).optional(),
  //in-app banners (JITSU-88); attached from the billing/settings response, not part of subscriptionStatus
  banners: z.array(BillingBanner).optional(),
});

export type BillingSettings = z.infer<typeof BillingSettings>;

export const noRestrictions: BillingSettings = {
  planId: "$admin",
  overagePricePer100k: undefined,
  canShowProvisionDbCredentials: true,
  maximumSyncFrequency: 0,
  dailyActiveSyncs: 100,
  dailyActiveSyncsOverage: 100,
  destinationEvensPerMonth: 100_000_000_000,
  profileBuilderEnabled: true,
  observabilityExportsEnabled: true,
};

/**
 * Result of POST /api/fb-auth/create-user. A discriminated union rather than an
 * HTTP error: `ok: false` is a normal 200 response carrying the reason a signup
 * was refused (JITSU-70 — personal email rejected), so the client can show a
 * friendly message instead of treating it as a request failure.
 */
export const CreateUserResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), rejected: z.literal("personal-email"), message: z.string() }),
]);
export type CreateUserResult = z.infer<typeof CreateUserResult>;

export const AppConfig = z.object({
  docsUrl: z.string().optional(),
  websiteUrl: z.string().optional(),
  maintenance: z
    .object({
      active: z.boolean().optional(),
      description: z.string().optional(),
      planned_start: z.string().optional(),
      planned_end: z.string().optional(),
      show_in_advance: z.boolean().optional(),
      // Mirrors lib/server/maintenance.ts MaintenanceState.database_access.
      // The browser uses this to decide whether to render the maintenance page
      // unconditionally (DB unavailable) vs. just show the read-only banner.
      database_access: z.enum(["read_only", "off"]).optional(),
    })
    .optional(),
  disableSignup: z.boolean().optional(),
  // Display-only hint: signup requires a work email (JITSU-70). Enforcement is
  // server-side; this only drives the badge on the signup form.
  limitPersonalEmails: z.boolean().optional(),
  customDomainsEnabled: z.boolean().optional(),
  ee: z.object({
    available: z.boolean(),
    host: z.string().optional(),
  }),
  billingEnabled: z.boolean(),
  /** Segment/RudderStack migration analyzer entry points (JITSU-131). Gated by
   * the MIGRATION_WIZARD_ENABLED env var; implies ee.available. */
  migrationWizardEnabled: z.boolean().optional(),
  /** Booking link for the migration report's call CTA (MIGRATION_CALENDLY_URL env). */
  migrationCalendlyUrl: z.string().optional(),
  publicEndpoints: z.object({
    protocol: z.enum(["http", "https"]),
    host: z.string(),
    dataHost: z.string().optional(),
    ingestUrl: z.string().optional(),
    cname: z.string().optional(),
    //if differs from standard protocol port - 80 or 443
    port: z.number().optional(),
  }),
  auth: z
    .object({
      firebasePublic: z.any(),
      nextauth: z
        .object({
          github: z.boolean().optional(),
          credentials: z.boolean().optional(),
          oidc: z.boolean().optional(),
        })
        .optional(),
      dynamicOidc: z.boolean().optional(),
    })
    .optional(),
  frontendTelemetry: z.object({
    enabled: z.boolean(),
    host: z.string().optional(),
  }),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  syncs: z.object({
    enabled: z.boolean(),
    scheduler: z.object({
      enabled: z.boolean(),
      provider: z.enum(["google-cloud-scheduler"]).optional(),
    }),
  }),
  mitCompliant: z.boolean().optional(),
  nango: z
    .object({
      publicKey: z.string(),
      host: z.string(),
    })
    .optional(),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const ConfigEntityBase = z.object({
  id: z.string(),
  type: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  updatedAt: z.coerce.date().nullish(),
  cloneId: z.string().optional(),
});
export type ConfigEntityBase = z.infer<typeof ConfigEntityBase>;

export const ApiKey = z.object({
  plaintext: z.string().nullish(),
  hash: z.string().nullish(),
  hint: z.string().nullish(),
  createdAt: z.coerce.date().nullish(),
  lastUsed: z.coerce.date().nullish(),
  id: z.string(),
  type: z.string().nullish(),
  name: z.string().nullish(),
  expiresAt: z.coerce.date().nullish(),
  // When set, this row is an MCP-issued refresh token. Its presence is the
  // single source of truth for "MCP-ness" (we don't set type="mcp").
  // mcpClientName carries the registered client_name for display on /user.
  mcpClientName: z.string().nullish(),
});
export type ApiKey = z.infer<typeof ApiKey>;

/**
 * Legacy keys created before UserApiToken.type existed have no stored type.
 * Recover one from the id prefix used by jitsu-cli (`jitsu-cli-...`); everything
 * else falls back to "api". Pure function — safe to import from client code.
 */
export function inferTokenTypeFromId(id: string): string {
  if (id.startsWith("jitsu-cli-")) return "cli";
  return "api";
}

/** Where an authenticated request originated. */
export type RequestOrigin = "ui" | "api" | "cli" | "mcp";

/**
 * Classify the origin of an authenticated request from its auth fields (as carried on
 * SessionUser, or on an audit-log row). Pure — safe to import from client code.
 *
 *   X-Jitsu-Client "jitsu-cli/…" header   → "cli"  (explicit client signal, wins over token)
 *   authType "mcp"                        → "mcp"
 *   authType "bearer" + CLI token         → "cli"  (tokenType "cli", or jitsu-cli- id)
 *   authType "bearer" + anything else     → "api"
 *   anything else (session / no authType) → "ui"
 *
 * The `headers` are the allowlisted request headers stored on the audit row
 * (see extractRequestProvenance). They let us recover CLI/SDK provenance even
 * when the request authenticated with a plain API key — the token carries no
 * CLI marker, but the client announces itself via X-Jitsu-Client.
 *
 * Single source of truth for origin: `resolveOrigin` in
 * components/AuditLog/AuditLog.tsx and the origin filter predicates in
 * pages/api/audit-log.ts mirror this mapping — keep them in sync.
 */
export function originFromAuth(auth: {
  authType?: string | null;
  tokenId?: string | null;
  tokenType?: string | null;
  headers?: Record<string, string> | null;
}): RequestOrigin {
  // Match the "jitsu-cli/" prefix (with the trailing slash) case-insensitively.
  // The slash is a deliberate delimiter so we don't false-attribute a client
  // like "jitsu-client/1.0"; the CLI always sends `jitsu-cli/<version>`. Kept a
  // plain prefix check so the read-API origin filter (a Prisma
  // `string_starts_with` with mode:"insensitive") mirrors it exactly — both
  // sides must agree or `origin=cli` filtering drifts from what the row renders.
  const client = auth.headers?.["x-jitsu-client"];
  if (client && client.toLowerCase().startsWith("jitsu-cli/")) return "cli";
  if (auth.authType === "mcp") return "mcp";
  if (auth.authType === "bearer") {
    const tokenType = auth.tokenType || (auth.tokenId ? inferTokenTypeFromId(auth.tokenId) : "api");
    return tokenType === "cli" ? "cli" : "api";
  }
  return "ui";
}

export const StreamConfig = ConfigEntityBase.merge(
  z
    .object({
      domains: z.array(z.string()).optional(),
      authorizedJavaScriptDomains: z.string().optional(),
      publicKeys: z.array(ApiKey).optional(),
      privateKeys: z.array(ApiKey).optional(),
      strict: z.boolean().optional(),
      shard: z.number().optional(),
      deduplicateWindowMs: z.number().optional(),
    })
    // Tolerate legacy/unknown fields on older stream records (matches DestinationConfig).
    // Without this, zodToJsonSchema emits `additionalProperties: false` and the editor's
    // live validation rejects old streams with "must NOT have additional properties".
    .passthrough()
);
export type StreamConfig = z.infer<typeof StreamConfig>;

export const DestinationConfig = ConfigEntityBase.merge(
  z
    .object({
      destinationType: z.string(),
      provisioned: z.boolean().optional(),
      testConnectionError: z.string().optional(),
    })
    .passthrough()
);
export type DestinationConfig = z.infer<typeof DestinationConfig>;

export const FunctionConfig = ConfigEntityBase.merge(
  z.object({
    code: z.string(),
    draft: z.string().optional(),
    kind: z.enum(["profile", "event"]).optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    origin: z.string().optional(),
    slug: z.string().optional(),
  })
);
export type FunctionConfig = z.infer<typeof FunctionConfig>;

export const ServiceConfig = ConfigEntityBase.merge(
  z.object({
    protocol: z.enum(["airbyte"]).default("airbyte"),
    authorized: z.boolean().optional(),
    package: z.string(),
    version: z.string(),
    credentials: z.object({}).passthrough(),
    testConnectionError: z.string().optional(),
  })
);
export type ServiceConfig = z.infer<typeof ServiceConfig>;

export const ConnectorImageConfig = ConfigEntityBase.merge(
  z.object({
    package: z.string(),
    version: z.string(),
  })
);
export type ConnectorImageConfig = z.infer<typeof ConnectorImageConfig>;

export const WorkspaceDomain = ConfigEntityBase.merge(z.object({}));
export type WorkspaceDomain = z.infer<typeof WorkspaceDomain>;

export const MiscEntity = ConfigEntityBase.merge(
  z.object({
    objectType: z.enum(["classic-mapping"]).default("classic-mapping"),
    value: z.string(),
  })
);
export type MiscEntity = z.infer<typeof MiscEntity>;

export const NotificationChannel = ConfigEntityBase.merge(
  z.object({
    events: z.array(z.enum(["all", "sync", "batch", "dead", "account"])).default(["all"]),
    channel: z.enum(["email", "slack"]).default("slack"),
    slackWebhookUrl: z.string().optional(),
    // allWorkspaceEmails: z.boolean().default(true).optional(),
    emails: z.array(z.string()).optional(),
    recurringAlertsPeriodHours: z.number().max(720).min(0).default(168),
    summarizeBatchNotificationsByTable: z.boolean().default(true),
  })
);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * What happens to an object before it is saved to DB.
 *
 * opts.original — original of the object, if object is being updated
 * opts.patch — patch of the object, if object is being updated. Or full object, if object is being created
 */
export type InputFilter<T = any> = (
  val: T,
  context: "create" | "update",
  workspace: z.infer<typeof WorkspaceDbModel>
) => Promise<T>;
export type OutputFilter<T = any> = (original: T) => T;

/**
 * To validate object. Could use external async services (like DB) to validate.
 * Should throw error if validation failed.
 */
export type Validator<T> = (value: T) => Promise<void>;

export type ConfigObjectType<T = any> = {
  schema: z.ZodSchema<T>;
  narrowSchema?: (obj: any, originalSchema: z.ZodSchema<T>) => z.ZodSchema<T>;

  /**
   * Applied to input object before saving to DB.
   * There's a place where to apply validation, and throw error if validation failed.
   */
  inputFilter?: InputFilter<T>;
  /**
   * Custom merge logic. By default, it's just shallow merge - {...original, ...patch}.
   */
  merge?: (original: T, patch: Partial<T>) => T | Promise<T>;

  /**
   * Clean object before sending to client. Can remove fields, hide values etc
   */
  outputFilter?: OutputFilter<T> | ((original: T) => Promise<T>);

  /**
   * Called before deleting the object. Can perform validation and cleanup.
   * Should throw ApiError if deletion is not allowed.
   */
  onDelete?: (original: T, options?: ConfigApiDeleteOptions) => Promise<void>;
};

const SafeUserProfile = UserProfileDbModel.pick({
  id: true,
  name: true,
  loginProvider: true,
  externalId: true,
  externalUsername: true,
  email: true,
});

export type SafeUserProfile = z.infer<typeof SafeUserProfile>;

export const UserWorkspaceRelation = z.object({
  workspaceId: z.string(),
  user: SafeUserProfile.optional(),
  invitationLink: z.string().optional(),
  invitationEmail: z.string().optional(),
  canSendEmail: z.boolean().optional(),
  role: WorkspaceRolesZodType,
});

export type UserWorkspaceRelation = z.infer<typeof UserWorkspaceRelation>;

export const BaseLinkType = z.object({ fromId: z.string(), toId: z.string() });

export const SelectedStreamSettings = z.object({
  sync_mode: z.enum(["full_refresh", "incremental"]),
  table_name: z.string().optional(),
  cursor_field: z.array(z.string()).optional(),
});

export type SelectedStreamSettings = z.infer<typeof SelectedStreamSettings>;

export const SyncOptionsType = z.object({
  streams: z.record(SelectedStreamSettings),
  disabledStreams: z.record(SelectedStreamSettings).optional(),
  namespace: z.string().optional(),
  tableNamePrefix: z.string().optional(),
  toSameCase: z.boolean().optional(),
  addMeta: z.boolean().optional(),
  deduplicate: z.boolean().optional().default(true),
  schemaChanges: z.enum(["manual", "fields", "streams"]).optional(),
  functionsEnv: z.any().optional(),
  schedule: z
    .union([z.string(), z.enum(["0 0 * * *", "0 * * * *", "*/15 * * * *", "*/5 * * * *", "* * * * *"])])
    .optional(),
  timezone: z.string().optional(),
});

export type SyncOptionsType = z.infer<typeof SyncOptionsType>;
