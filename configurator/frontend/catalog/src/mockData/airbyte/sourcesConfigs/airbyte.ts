export const hubspot = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/hubspot",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Hubspot Source Spec",
    type: "object",
    required: ["start_date", "credentials"],
    additionalProperties: false,
    properties: {
      start_date: {
        type: "string",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
        description:
          "UTC date and time in the format 2017-01-25T00:00:00Z. Any data before this date will not be replicated.",
        examples: ["2017-01-25T00:00:00Z"],
      },
      credentials: {
        type: "object",
        title: "api key",
        required: ["api_key"],
        properties: {
          api_key: {
            description:
              'Hubspot API Key. See our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/hubspot">docs</a> if you need help finding this key.',
            type: "string",
            airbyte_secret: true,
          },
        },
      },
    },
  },
}

export const mysql = {
  documentationUrl: "https://docs.airbyte.io/integrations/source/mysql",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "MySql Source Spec",
    type: "object",
    required: ["host", "port", "database", "username", "replication_method"],
    additionalProperties: false,
    properties: {
      host: {
        description: "Hostname of the database.",
        type: "string",
        order: 0,
      },
      port: {
        description: "Port of the database.",
        type: "integer",
        minimum: 0,
        maximum: 65536,
        default: 3306,
        examples: ["3306"],
        order: 1,
      },
      database: {
        description: "Name of the database.",
        type: "string",
        order: 2,
      },
      username: {
        description: "Username to use to access the database.",
        type: "string",
        order: 3,
      },
      password: {
        description: "Password associated with the username.",
        type: "string",
        airbyte_secret: true,
        order: 4,
      },
      jdbc_url_params: {
        description:
          "Additional properties to pass to the jdbc url string when connecting to the database formatted as 'key=value' pairs separated by the symbol '&'. (example: key1=value1&key2=value2&key3=value3)",
        type: "string",
        order: 5,
      },
      replication_method: {
        type: "string",
        title: "Replication Method",
        description:
          "Replication method to use for extracting data from the database. STANDARD replication requires no setup on the DB side but will not be able to represent deletions incrementally. CDC uses the Binlog to detect inserts, updates, and deletes. This needs to be configured on the source database itself.",
        order: 6,
        default: "STANDARD",
        enum: ["STANDARD", "CDC"],
      },
    },
  },
  supportsNormalization: false,
  supportsDBT: false,
  supported_destination_sync_modes: [],
}

export const mongodb = {
  changelogUrl: "https://docs.airbyte.io/integrations/sources/mongodb",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Mongodb Source Spec",
    type: "object",
    required: ["host", "port", "database", "user", "password", "auth_source"],
    additionalProperties: false,
    properties: {
      host: {
        title: "Host",
        type: "string",
        description: "Host of a Mongo database to be replicated.",
        order: 0,
      },
      port: {
        title: "Port",
        type: "integer",
        description: "Port of a Mongo database to be replicated.",
        minimum: 0,
        maximum: 65536,
        default: 27017,
        examples: ["27017"],
        order: 1,
      },
      database: {
        title: "Database name",
        type: "string",
        description: "Database to be replicated.",
        order: 2,
      },
      user: { title: "User", type: "string", description: "User", order: 3 },
      password: {
        title: "Password",
        type: "string",
        description: "Password",
        airbyte_secret: true,
        order: 4,
      },
      auth_source: {
        title: "Authentication source",
        type: "string",
        description:
          'Authentication source where user information is stored. See <a target="_blank" href="* [Authentication Source](https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.authSource)"> the Mongo docs</a> for more info.',
        default: "admin",
        examples: ["admin"],
        order: 5,
      },
      replica_set: {
        title: "Replica Set",
        type: "string",
        description:
          "The name of the set to filter servers by, when connecting to a replica set (Under this condition, the 'TLS connection' value automatically becomes 'true'). See <a href=\"https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.replicaSet\"> the Mongo docs </a> for more info.",
        default: "",
        order: 6,
      },
      ssl: {
        title: "TLS connection",
        type: "boolean",
        description: "If this switch is enabled, TLS connections will be used to connect to MongoDB.",
        default: false,
        order: 7,
      },
    },
  },
  documentationUrl: "https://docs.airbyte.io/integrations/sources/mongodb",
}

export const mailchimp = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/mailchimp",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Mailchimp Spec",
    type: "object",
    required: ["username", "apikey"],
    additionalProperties: false,
    properties: {
      username: {
        type: "string",
        description: "The Username or email you use to sign into Mailchimp",
      },
      apikey: {
        type: "string",
        airbyte_secret: true,
        description:
          'API Key. See the <a target="_blank" href="https://docs.airbyte.io/integrations/sources/mailchimp">docs</a> for information on how to generate this key.',
      },
    },
  },
}

export const feshdesk = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/freshdesk",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Freshdesk Spec",
    type: "object",
    required: ["domain", "api_key"],
    additionalProperties: false,
    properties: {
      domain: {
        type: "string",
        description: "Freshdesk domain",
        examples: ["myaccount.freshdesk.com"],
        pattern: ["^[a-zA-Z0-9._-]*\\.freshdesk\\.com$"],
      },
      api_key: {
        type: "string",
        description:
          'Freshdesk API Key. See the <a target="_blank" href="https://docs.airbyte.io/integrations/sources/freshdesk">docs</a> for more information on how to obtain this key.',
        airbyte_secret: true,
      },
      requests_per_minute: {
        title: "Requests per minute",
        type: "integer",
        description: "Number of requests per minute that this source allowed to use.",
      },
    },
  },
}

export const instagram = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/instagram",
  changelogUrl: "https://docs.airbyte.io/integrations/sources/instagram",
  connectionSpecification: {
    title: "Source Instagram",
    type: "object",
    required: ["start_date", "access_token"],
    properties: {
      start_date: {
        title: "Start Date",
        description:
          "The date from which you'd like to replicate data for User Insights, in the format YYYY-MM-DDT00:00:00Z. All data generated after this date will be replicated.",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
        examples: ["2017-01-25T00:00:00Z"],
        type: "string",
        format: "date-time",
      },
      access_token: {
        title: "Access Token",
        description:
          'The value of the access token generated. See the <a target="_blank" href="https://docs.airbyte.io/integrations/sources/instagram">docs</a> for more information',
        airbyte_secret: true,
        type: "string",
      },
    },
  },
  supportsIncremental: true,
  supported_destination_sync_modes: ["append"],
}

export const googleAds = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/google-ads",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Google Ads Spec",
    type: "object",
    required: ["credentials", "start_date", "customer_id"],
    additionalProperties: false,
    properties: {
      credentials: {
        type: "object",
        title: "Google Credentials",
        required: ["developer_token", "client_id", "client_secret", "refresh_token"],
        properties: {
          developer_token: {
            type: "string",
            title: "Developer Token",
            description:
              'Developer token granted by Google to use their APIs. More instruction on how to find this value in our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>',
            airbyte_secret: true,
          },
          client_id: {
            type: "string",
            title: "Client Id",
            description:
              'Google client id. More instruction on how to find this value in our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>',
          },
          client_secret: {
            type: "string",
            title: "Client Secret",
            description:
              'Google client secret. More instruction on how to find this value in our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>',
            airbyte_secret: true,
          },
          refresh_token: {
            type: "string",
            title: "Refresh Token",
            description:
              'Refresh token generated using developer_token, oauth_client_id, and oauth_client_secret. More instruction on how to find this value in our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>',
            airbyte_secret: true,
          },
        },
      },
      customer_id: {
        title: "Customer Id",
        type: "string",
        description:
          'Customer id must be specified as a 10-digit number without dashes. More instruction on how to find this value in our <a target="_blank" href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>',
      },
      login_customer_id: {
        type: "string",
        title: "Login Customer ID",
        description:
          'If your access to the customer account is through a manager account, this field is required and must be set to the customer ID of the manager account (10-digit number without dashes). More information about this field you can see <a target="_blank" href="https://developers.google.com/google-ads/api/docs/concepts/call-structure#cid">here</a>',
      },
      start_date: {
        type: "string",
        title: "Start Date",
        description: "UTC date and time in the format 2017-01-25. Any data before this date will not be replicated.",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        examples: ["2017-01-25"],
      },
      conversion_window_days: {
        title: "Conversion Window",
        type: "integer",
        description: "Define the historical replication lookback window in days",
        minimum: 0,
        maximum: 1095,
        default: 14,
        examples: [14],
      },
    },
  },
}

export const microsoftTeams = {
  documentationUrl: "https://docs.airbyte.io/integrations/sources/microsoft-teams",
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Microsoft Teams Spec",
    type: "object",
    required: ["tenant_id", "client_id", "client_secret", "period"],
    additionalProperties: false,
    properties: {
      tenant_id: {
        title: "Directory (tenant) ID",
        type: "string",
        description: "Directory (tenant) ID",
      },
      client_id: {
        title: "Application (client) ID",
        type: "string",
        description: "Application (client) ID",
      },
      client_secret: {
        title: "Client Secret",
        type: "string",
        description: "Client secret",
        airbyte_secret: true,
      },
      period: {
        type: "string",
        description:
          "Specifies the length of time over which the Team Device Report stream is aggregated. The supported values are: D7, D30, D90, and D180.",
        examples: ["D7"],
      },
    },
  },
}

export const postgres = {
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: false,
    properties: {
      database: {
        description: "Name of the database.",
        order: 2,
        title: "DB Name",
        type: "string",
      },
      host: {
        description: "Hostname of the database.",
        order: 0,
        title: "Host",
        type: "string",
      },
      password: {
        airbyte_secret: true,
        description: "Password associated with the username.",
        order: 4,
        title: "Password",
        type: "string",
      },
      port: {
        default: 5432,
        description: "Port of the database.",
        examples: ["5432"],
        maximum: 65536,
        minimum: 0,
        order: 1,
        title: "Port",
        type: "integer",
      },
      replication_method: {
        description: "Replication method to use for extracting data from the database.",
        oneOf: [
          {
            additionalProperties: false,
            description:
              "Standard replication requires no setup on the DB side but will not be able to represent deletions incrementally.",
            properties: {
              method: {
                const: "Standard",
                default: "Standard",
                enum: ["Standard"],
                order: 0,
                type: "string",
              },
            },
            required: ["method"],
            title: "Standard",
          },
          {
            additionalProperties: false,
            description:
              'Logical replication uses the Postgres write-ahead log (WAL) to detect inserts, updates, and deletes. This needs to be configured on the source database itself. Only available on Postgres 10 and above. Read the <a target="_blank" href="https://docs.airbyte.io/integrations/sources/postgres">Postgres Source</a> docs for more information.',
            properties: {
              method: {
                const: "CDC",
                default: "CDC",
                enum: ["CDC"],
                order: 0,
                type: "string",
              },
              plugin: {
                default: "pgoutput",
                description:
                  'A logical decoding plug-in installed on the PostgreSQL server. `pgoutput` plug-in is used by default.\nIf replication table contains a lot of big jsonb values it is recommended to use `wal2json` plug-in. For more information about `wal2json` plug-in read <a target="_blank" href="https://docs.airbyte.io/integrations/sources/postgres">Postgres Source</a> docs.',
                enum: ["pgoutput", "wal2json"],
                order: 1,
                type: "string",
              },
              publication: {
                description: "A Postgres publication used for consuming changes.",
                order: 3,
                type: "string",
              },
              replication_slot: {
                description: "A plug-in logical replication slot.",
                order: 2,
                type: "string",
              },
            },
            required: ["method", "replication_slot", "publication"],
            title: "Logical Replication (CDC)",
          },
        ],
        order: 6,
        title: "Replication Method",
        type: "object",
      },
      ssl: {
        default: false,
        description: "Encrypt client/server communications for increased security.",
        order: 5,
        title: "Connect using SSL",
        type: "boolean",
      },
      tunnel_method: {
        description:
          "Whether to initiate an SSH tunnel before connecting to the database, and if so, which kind of authentication to use.",
        oneOf: [
          {
            properties: {
              tunnel_method: {
                const: "NO_TUNNEL",
                description: "No ssh tunnel needed to connect to database",
                order: 0,
                type: "string",
              },
            },
            required: ["tunnel_method"],
            title: "No Tunnel",
          },
          {
            properties: {
              ssh_key: {
                airbyte_secret: true,
                description: "OS-level user account ssh key credentials for logging into the jump server host.",
                multiline: true,
                order: 4,
                title: "SSH Private Key",
                type: "string",
              },
              tunnel_host: {
                description: "Hostname of the jump server host that allows inbound ssh tunnel.",
                order: 1,
                title: "SSH Tunnel Jump Server Host",
                type: "string",
              },
              tunnel_method: {
                const: "SSH_KEY_AUTH",
                description: "Connect through a jump server tunnel host using username and ssh key",
                order: 0,
                type: "string",
              },
              tunnel_port: {
                default: 22,
                description: "Port on the proxy/jump server that accepts inbound ssh connections.",
                examples: ["22"],
                maximum: 65536,
                minimum: 0,
                order: 2,
                title: "SSH Connection Port",
                type: "integer",
              },
              tunnel_user: {
                description: "OS-level username for logging into the jump server host.",
                order: 3,
                title: "SSH Login Username",
                type: "string",
              },
            },
            required: ["tunnel_method", "tunnel_host", "tunnel_port", "tunnel_user", "ssh_key"],
            title: "SSH Key Authentication",
          },
          {
            properties: {
              tunnel_host: {
                description: "Hostname of the jump server host that allows inbound ssh tunnel.",
                order: 1,
                title: "SSH Tunnel Jump Server Host",
                type: "string",
              },
              tunnel_method: {
                const: "SSH_PASSWORD_AUTH",
                description: "Connect through a jump server tunnel host using username and password authentication",
                order: 0,
                type: "string",
              },
              tunnel_port: {
                default: 22,
                description: "Port on the proxy/jump server that accepts inbound ssh connections.",
                examples: ["22"],
                maximum: 65536,
                minimum: 0,
                order: 2,
                title: "SSH Connection Port",
                type: "integer",
              },
              tunnel_user: {
                description: "OS-level username for logging into the jump server host",
                order: 3,
                title: "SSH Login Username",
                type: "string",
              },
              tunnel_user_password: {
                airbyte_secret: true,
                description: "OS-level password for logging into the jump server host",
                order: 4,
                title: "Password",
                type: "string",
              },
            },
            required: ["tunnel_method", "tunnel_host", "tunnel_port", "tunnel_user", "tunnel_user_password"],
            title: "Password Authentication",
          },
        ],
        title: "SSH Tunnel Method",
        type: "object",
      },
      username: {
        description: "Username to use to access the database.",
        order: 3,
        title: "User",
        type: "string",
      },
    },
    required: ["host", "port", "database", "username"],
    title: "Postgres Source Spec",
    type: "object",
  },
  documentationUrl: "https://docs.airbyte.io/integrations/sources/postgres",
  supported_destination_sync_modes: [],
  supportsDBT: false,
  supportsNormalization: false,
}

export const braintree = {
  connectionSpecification: {
    definitions: {
      Environment: {
        description: "An enumeration.",
        enum: ["Development", "Sandbox", "Qa", "Production"],
        title: "Environment",
        type: "string",
      },
    },
    properties: {
      environment: {
        allOf: [{ $ref: "#/definitions/Environment" }],
        description: "Environment specifies where the data will come from.",
        examples: ["sandbox", "production", "qa", "development"],
        name: "Environment",
      },
      merchant_id: {
        description:
          '\u003ca href="https://docs.airbyte.io/integrations/sources/braintree"\u003eMerchant ID\u003c/a\u003e is the unique identifier for entire gateway account.',
        name: "Merchant ID",
        title: "Merchant Id",
        type: "string",
      },
      private_key: {
        airbyte_secret: true,
        description: "This is your user-specific private identifier.",
        name: "Private Key",
        title: "Private Key",
        type: "string",
      },
      public_key: {
        description: "This is your user-specific public identifier for Braintree.",
        name: "Public key",
        title: "Public Key",
        type: "string",
      },
      start_date: {
        description:
          "The date from which you'd like to replicate data for Braintree API for UTC timezone, All data generated after this date will be replicated.",
        examples: ["2020", "2020-12-30", "2020-11-22 20:20:05"],
        format: "date-time",
        name: "Start date",
        title: "Start Date",
        type: "string",
      },
    },
    required: ["merchant_id", "public_key", "private_key", "environment"],
    title: "Braintree Spec",
    type: "object",
  },
  documentationUrl: "https://docs.airbyte.io/integrations/sources/braintree",
} as const

export const github = {
  authSpecification: {
    auth_type: "oauth2.0",
    oauth2Specification: {
      oauthFlowInitParameters: [],
      oauthFlowOutputParameters: [["access_token"]],
      rootObject: ["credentials", "0"],
    },
  },
  connectionSpecification: {
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: true,
    properties: {
      branch: {
        description:
          "Space-delimited list of GitHub repository branches to pull commits for, e.g. `airbytehq/airbyte/master`. If no branches are specified for a repository, the default branch will be pulled.",
        examples: ["airbytehq/airbyte/master"],
        title: "Branch",
        type: "string",
      },
      credentials: {
        description: "Choose how to authenticate to Github",
        oneOf: [
          {
            properties: {
              access_token: {
                airbyte_secret: true,
                description: "Oauth access token",
                title: "Access Token",
                type: "string",
              },
              option_title: {
                const: "OAuth Credentials",
                description: "OAuth Credentials",
                title: "Credentials title",
                type: "string",
              },
            },
            required: ["access_token"],
            title: "Authenticate via Github (Oauth)",
            type: "object",
          },
          {
            properties: {
              option_title: {
                const: "PAT Credentials",
                description: "PAT Credentials",
                title: "Credentials title",
                type: "string",
              },
              personal_access_token: {
                airbyte_secret: true,
                description:
                  'Log into Github and then generate a <a target="_blank" href="https://github.com/settings/tokens"> personal access token</a>. To load balance your API quota consumption across multiple API tokens, input multiple tokens separated with ","',
                title: "Personal Access Tokens",
                type: "string",
              },
            },
            required: ["personal_access_token"],
            title: "Authenticate with Personal Access Token",
            type: "object",
          },
        ],
        title: "Authentication mechanism",
        type: "object",
      },
      repository: {
        description:
          "Space-delimited list of GitHub repositories/organizations, e.g. `airbytehq/airbyte` for single repository and `airbytehq/*` for get all repositories from organization",
        examples: ["airbytehq/airbyte", "airbytehq/*"],
        title: "Github repositories",
        type: "string",
      },
      start_date: {
        description:
          "The date from which you'd like to replicate data for GitHub in the format YYYY-MM-DDT00:00:00Z. All data generated after this date will be replicated. Note that it will be used only in the following incremental streams: comments, commits and issues.",
        examples: ["2021-03-01T00:00:00Z"],
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
        title: "Start date",
        type: "string",
      },
    },
    required: ["start_date", "repository"],
    title: "Github Source Spec",
    type: "object",
  },
  documentationUrl: "https://docs.airbyte.io/integrations/sources/github",
} as const
