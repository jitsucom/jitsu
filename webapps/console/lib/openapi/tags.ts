// Display metadata for OpenAPI tags. Each operation in the spec carries a tag *slug*
// (e.g. "destination") for routing; the renderer (Scalar / Swagger UI) reads the
// document-level `tags` array for the human-readable name and description shown
// in the sidebar and section header.

export type TagInfo = {
  // Slug used on operation `tags: [...]` — this is the wire identifier.
  slug: string;
  // Display name shown in the sidebar / section header.
  name: string;
  description: string;
  externalDocs?: { url: string; description?: string };
};

const DOCS_BASE = "https://docs.jitsu.com";

export const tagInfos: TagInfo[] = [
  {
    slug: "destination",
    name: "Destinations",
    description:
      `A **destination** is a target system Jitsu sends events to — a data warehouse (Postgres, ClickHouse, BigQuery, Snowflake, Redshift), object storage (S3, GCS), or a downstream service.\n\n` +
      `[Learn more about destinations](${DOCS_BASE}/core-concepts/destinations).`,
    externalDocs: { url: `${DOCS_BASE}/core-concepts/destinations`, description: "Destinations in Jitsu" },
  },
  {
    slug: "stream",
    name: "Streams",
    description:
      `A **stream** is an incoming-events endpoint (formerly called a *source*). Each stream has its own write keys and the list of domains allowed to send events.\n\n` +
      `[Learn more about streams](${DOCS_BASE}/core-concepts/streams).`,
    externalDocs: { url: `${DOCS_BASE}/core-concepts/streams`, description: "Streams in Jitsu" },
  },
  {
    slug: "function",
    name: "Functions",
    description:
      `User-defined functions (UDFs) that transform, filter, or enrich events as they flow through the pipeline. Functions are written in TypeScript and run inside Jitsu's sandbox.\n\n` +
      `[Learn more about functions](${DOCS_BASE}/functions).`,
    externalDocs: { url: `${DOCS_BASE}/functions`, description: "Functions in Jitsu" },
  },
  {
    slug: "service",
    name: "Services",
    description:
      `A **service** is an external system polled by a connector (Airbyte protocol) — for example Stripe, HubSpot, or a database. Services produce data on a schedule that's then routed to destinations.\n\n` +
      `[Learn more about services](${DOCS_BASE}/core-concepts/services).`,
    externalDocs: { url: `${DOCS_BASE}/core-concepts/services`, description: "Services in Jitsu" },
  },
  {
    slug: "sync",
    name: "Syncs",
    description:
      `Endpoints that drive **sync runs** — pulling data from a service into a destination on demand. ` +
      `Use these to fetch a connector's config schema, discover its streams, trigger and monitor runs, and stream task logs.\n\n` +
      `[Learn more about the Sync API](${DOCS_BASE}/api/sync).`,
    externalDocs: { url: `${DOCS_BASE}/api/sync`, description: "Sync API in Jitsu docs" },
  },
  {
    slug: "link",
    name: "Connections",
    description:
      `A **connection** wires a stream (or service) to a destination. It controls which data flows where and what optional functions run along the way.\n\n` +
      `[Learn more about connections](${DOCS_BASE}/core-concepts/connections).`,
    externalDocs: { url: `${DOCS_BASE}/core-concepts/connections`, description: "Connections in Jitsu" },
  },
  {
    slug: "profile-builder",
    name: "Profile builders",
    description:
      `**Profile builders** aggregate event history into per-user profiles using identity stitching. They run on a schedule and emit profiles to a destination.\n\n` +
      `[Learn more about profile builders](${DOCS_BASE}/features/identity-stitching).`,
    externalDocs: { url: `${DOCS_BASE}/features/identity-stitching`, description: "Identity stitching in Jitsu" },
  },
  {
    slug: "domain",
    name: "Domains",
    description: `Custom domains registered in a workspace, used as ingestion endpoints for streams.`,
  },
  {
    slug: "notification",
    name: "Notification channels",
    description: `Subscriptions that deliver workspace alerts (sync failures, batch failures, dead-letter events) to email or Slack.`,
  },
  {
    slug: "misc",
    name: "Misc entities",
    description: `Catch-all configuration objects with a free-form value. Used for things like classic event mappings.`,
  },
  {
    slug: "custom-image",
    name: "Custom images",
    description: `Custom connector images registered in the workspace.`,
  },
  {
    slug: "metrics",
    name: "Metrics",
    description: `Workspace event volume and ingestion metrics.`,
  },
  {
    slug: "workspace",
    name: "Workspace",
    description: `Workspace metadata and settings.`,
  },
  {
    slug: "config",
    name: "Configuration",
    description: `General configuration endpoints (connectivity tests, etc.).`,
  },
];

const bySlug: Record<string, TagInfo> = Object.fromEntries(tagInfos.map(t => [t.slug, t]));

export function getTagInfo(slug: string): TagInfo | undefined {
  return bySlug[slug];
}
