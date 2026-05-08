// Single source of truth for the `jitsu config <noun>` command tree.
// `kind` selects which verb handlers apply; `type` is the segment used in
// /api/{workspaceId}/config/{type} for standard config objects.

export type ResourceKind = "configObject" | "workspace" | "link" | "profile-builder";

export type Resource = {
  noun: string;
  aliases: string[];
  kind: ResourceKind;
  type?: string;
  supportsTest?: boolean;
  // Description used in `--help`.
  description: string;
};

export const resources: Resource[] = [
  {
    noun: "workspaces",
    aliases: ["workspace"],
    kind: "workspace",
    description: "Workspaces accessible to the current user",
  },
  {
    noun: "destinations",
    aliases: ["destination", "dest"],
    kind: "configObject",
    type: "destination",
    supportsTest: true,
    description: "Destinations (warehouses, databases, services receiving events)",
  },
  {
    noun: "streams",
    aliases: ["stream"],
    kind: "configObject",
    type: "stream",
    supportsTest: true,
    description: "Event streams (formerly known as sources)",
  },
  {
    noun: "functions",
    aliases: ["function", "fn"],
    kind: "configObject",
    type: "function",
    description: "User-defined functions (UDFs). For dev workflow see `jitsu deploy`.",
  },
  {
    noun: "services",
    aliases: ["service"],
    kind: "configObject",
    type: "service",
    supportsTest: true,
    description: "External connector services (Airbyte protocol)",
  },
  {
    noun: "domains",
    aliases: ["domain"],
    kind: "configObject",
    type: "domain",
    description: "Custom ingestion domains",
  },
  {
    noun: "misc",
    aliases: [],
    kind: "configObject",
    type: "misc",
    description: "Miscellaneous configuration entities (free-form)",
  },
  {
    noun: "notifications",
    aliases: ["notification"],
    kind: "configObject",
    type: "notification",
    description: "Alert channels (email/Slack)",
  },
  {
    noun: "connections",
    aliases: ["connection", "link", "links"],
    kind: "link",
    description: "Connections between streams/services and destinations",
  },
  {
    noun: "profile-builders",
    aliases: ["profile-builder"],
    kind: "profile-builder",
    description: "Profile builders (identity stitching)",
  },
];

export type Verb = "list" | "get" | "create" | "update" | "delete" | "test";

// Which verbs apply to a given resource kind.
export function verbsFor(kind: ResourceKind): Verb[] {
  switch (kind) {
    case "configObject":
      return ["list", "get", "create", "update", "delete"];
    case "workspace":
      return ["list", "get", "create", "update", "delete"];
    case "link":
      // link has no per-id GET; list+create(upsert)+update(alias)+delete
      return ["list", "create", "update", "delete"];
    case "profile-builder":
      return ["list", "create", "update", "delete"];
  }
}

export function findResource(name: string): Resource | undefined {
  const lower = name.toLowerCase();
  return resources.find(r => r.noun === lower || r.aliases.includes(lower));
}
