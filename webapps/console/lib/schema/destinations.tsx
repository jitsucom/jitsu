import { SomeZodObject, z } from "zod";
import React, { ReactNode } from "react";

import amplitudeIcon from "./icons/amplitude";
import bigqueryIcon from "./icons/bigquery";
import ClickhouseIcon from "./icons/clickhouse";
import devnullIcon from "./icons/devnull";
import gcsIcon from "./icons/gcs";
import hubspotIcon from "./icons/hubspot";
import mixpanelIcon from "./icons/mixpanel";
import facebookIcon from "./icons/facebook";
import juneIcon from "./icons/june";
import blazeIcon from "./icons/blaze";
import salesforceIcon from "./icons/salesforce";
import mongodbIcon from "./icons/mongodb";

import ga4Icon from "./icons/ga4";
import gtmIcon from "./icons/gtm";
import postgresIcon from "./icons/postgres";
import mysqlIcon from "./icons/mysql";
import motherduckIcon from "./icons/motherduck";
import redshiftIcon from "./icons/redshift";
import posthogIcon from "./icons/posthog";
import segmentIcon from "./icons/segment";
import s3Icon from "./icons/s3";
import tagIcon from "./icons/tag";
import snowflakeIcon from "./icons/snowflake";
import logRocketIcon from "./icons/logrocket";
import intercomIcon from "./icons/intercom";
import webhookIcon from "./icons/webhook";
import { branding } from "../branding";
import * as meta from "@jitsu/core-functions/src/meta";
import { HubspotCredentials } from "@jitsu/core-functions/src/meta";

const s3Regions = [
  "us-west-1",
  "us-west-2",
  "us-east-2",
  "us-east-1",
  "ap-south-1",
  "ap-northeast-3",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "cn-north-1",
  "cn-northwest-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-west-3",
  "eu-north-1",
  "me-south-1",
  "sa-east-1",
  "us-gov-east-1",
  "us-gov-west-1",
] as const;

/**
 * UI for property
 */
export type PropertyUI = {
  /**
   * Optional human-friendly name of the field
   */
  displayName?: string;
  /**
   * If string field should be treated as textarea (multiline input)
   */
  textarea?: boolean;
  /**
   * If string field should be treated as password
   */
  password?: boolean;
  /**
   * If the field should not be displayed. That field must have a default value
   */
  hidden?: boolean | ((obj: any) => boolean);
  /**
   * If the field should be a constant
   */
  constant?: any | ((obj: any) => any);
  /**
   * correction to field value. e.g: set default value for property that was missing before
   */
  correction?: any | ((obj: any) => any);

  /**
   * Documentation for the field
   */
  documentation?: string;
  /**
   * Name of custom editor component. See getEditorComponent() function from `[workspaceId]/destinations.txt`
   */
  editor?: string;
  /**
   * Properties of an editor component (not implemented yet, reserved for the future)
   */
  editorProps?: any;
};

export type SchemaUI = Record<string, PropertyUI>;

export const FunctionsConnectionOptions = z.object({
  functions: z.array(z.object({ functionId: z.string(), functionOptions: z.any() })).optional(),
  functionsEnv: z.record(z.string()).optional(),
  debugTill: z.string().optional(),
});

//Options of any source -> destination connection that are not specific to any particular destination
export const CloudDestinationsConnectionOptions = z
  .object({
    multithreading: z.boolean().optional(),
  })
  .merge(FunctionsConnectionOptions);
export type CloudDestinationsConnectionOptions = z.infer<typeof CloudDestinationsConnectionOptions>;

//Auxiliary type for batch mode options
export const BatchModeOptions = z.object({
  batchSize: z.number().min(1).default(10000),
  frequency: z
    .number()
    .int()
    .min(1)
    .max(60 * 24)
    .default(5)
    .nullish(),
});
export type BatchModeOptions = z.infer<typeof BatchModeOptions>;

/**
 * Common settings for device destination connections
 */
export const DeviceDestinationsConnectionOptions = z
  .object({
    events: z.string().optional().default("*"),
    hosts: z.string().optional().default("*"),
  })
  .merge(FunctionsConnectionOptions);

export type DeviceDestinationsConnectionOptions = z.infer<typeof DeviceDestinationsConnectionOptions>;

//All possible options for Bulker based source -> destination connection
export const BaseBulkerConnectionOptions = z
  .object({
    mode: z.enum(["stream", "batch"]).default("batch"),
    primaryKey: z.string().default("message_id"),
    deduplicate: z.boolean().default(true),
    deduplicateWindow: z.number().default(31),
    timestampColumn: z.string().default("timestamp"),
    dataLayout: z
      .enum(["segment", "jitsu-legacy", "segment-single-table", "passthrough"])
      .default("segment-single-table"),
    schemaFreeze: z.boolean().default(false),
    keepOriginalNames: z.boolean().default(false),
  })
  .merge(BatchModeOptions)
  .merge(FunctionsConnectionOptions);

export type BaseBulkerConnectionOptions = z.infer<typeof BaseBulkerConnectionOptions>;

export const AllConnectionOptions = BaseBulkerConnectionOptions.merge(DeviceDestinationsConnectionOptions).merge(
  CloudDestinationsConnectionOptions
);

export type AllConnectionOptions = Partial<z.infer<typeof AllConnectionOptions>>;

/**
 * There's a little copy-paste between here and jitsu-js
 */
export type AnalyticsPluginDescriptor = {
  type: "analytics-plugin";
  //link to a CDN with the plugin source code
  packageCdn: string;
  //name of the variable where plugin object is exported
  moduleVarName: string;
};

export type InternalPluginDescriptor = {
  type: "internal-plugin";
  name: string;
};

export type DeviceOptions = AnalyticsPluginDescriptor | InternalPluginDescriptor;

export type DestinationType<T = any> = {
  id: string;
  title: string;
  isSynchronous?: boolean;
  usesBulker?: boolean;
  // destinations that relies on both rotor for flexible logic in typescript and bulker for batching
  hybrid?: boolean;
  tags: string | string[];
  credentials: SomeZodObject;
  connectionOptions: SomeZodObject;
  credentialsUi?: SchemaUI;
  comingSoon?: boolean;
  icon?: ReactNode;
  description: ReactNode;
  documentation?: ReactNode;
  //For cloud (=server side) destinations - name builtin of the function that implements it
  implementingFunction?: string;
  //For device destinations - how this destination should be invoked? Information such as analytics plugin name, package name
  //etc. Not typed yet since so far each destination has its own settings
  deviceOptions?: DeviceOptions;

  /*
   * If destination support sync from connector packages, here's a place to define it
   * key is a FQN of the connector package, li
   */
  syncs?: {
    [key: string]: {
      syncOptions: SomeZodObject;
      description: ReactNode;
    };
  };
};

export const blockStorageSettings = z.object({
  folder: z.string().optional().describe("Folder in the block storage bucket where files will be stored"),
  format: z
    .enum(["ndjson", "ndjson_flat", "csv"])
    .default("ndjson")
    .describe(
      "Format of the files stored in the block storage: <b>ndjson</b> - Newline Delimited JSON, <b>ndjson_flat</b> - Newline Delimited JSON flattened, <b>csv</b> - CSV"
    ),
  compression: z
    .enum(["gzip", "none"])
    .default("gzip")
    .describe(
      "Compression mode used for the files stored in the block storage:<br/><b>gzip</b> - files will be compressed and have <code>.gz</code> filename suffix and <code>Content-Type: application/gzip</code><br/><b>none</b> - no compression, <code>Content-Type</code> and file extension will be set according to the format"
    ),
});

export function getCoreDestinationType(typeId: string): DestinationType {
  const destinationType = coreDestinationsMap[typeId];
  if (!destinationType) {
    throw new Error(
      `Destination type ${typeId} is not found. Available types: ${coreDestinations.map(d => d.id).join(", ")}`
    );
  }
  return destinationType;
}

export function getCoreDestinationTypeNonStrict(typeId: string): DestinationType | undefined {
  return coreDestinationsMap[typeId];
}

export const ClickhouseCredentials = z.object({
  protocol: z
    .enum(["http", "https", "clickhouse", "clickhouse-secure"])
    .default("clickhouse-secure")
    .describe(
      "Protocol used for ClickHouse connection: <code>http</code>, <code>https</code>, <code>clickhouse</code>, <code>clickhouse-secure</code>"
    ),
  hosts: z
    .array(z.string())
    .describe(
      "List of clickhouse servers as <code>host:port</code>. If port is not specified, default port for respective protocol will be used: <code>http->8123</code>, <code>https->8443</code>, <code>clickhouse->9000</code>, <code>clickhouse-secure->9440</code>"
    ),
  username: z.string().default("default").describe("Username for ClickHouse connection"),
  password: z.string().describe("Password for ClickHouse connection"),
  cluster: z
    .string()
    .optional()
    .describe("Name of cluster to use.<br/>For <b>ClickHouse Cloud</b> or single-node setups, leave this field empty."),
  database: z.string().default("default").describe("Name of the database to use"),
  parameters: z
    .object({})
    .catchall(z.string().default(""))
    .optional()
    .describe(
      "Additional parameters for ClickHouse driver. See <a href='https://clickhouse.com/docs/en/integrations/go#connection-settings-1' rel='noreferrer noopener' target='_blank'>Clickhouse documentation</a>"
    ),
  loadAsJson: z
    .boolean()
    .default(false)
    .describe(
      "Use JSONEachRow format::Load data in the <a href='https://clickhouse.com/docs/en/interfaces/formats' rel='noreferrer noopener' target='_blank'>JSONEachRow</a> format. This method offers better performance but may not work correctly on older ClickHouse versions."
    ),
});

export type ClickhouseCredentials = z.infer<typeof ClickhouseCredentials>;

const logRocketDestination = {
  id: "logrocket",
  isSynchronous: true,
  icon: logRocketIcon,
  tags: "Device Destinations",
  title: "Log Rocket",
  description: "Log Rocket is a session replay tool that helps you understand how users interact with your app.",
  credentials: z.object({
    //a json representation of the code - value & language. We can't use ordinary object here
    //because 3rd-party form renderer doesn't support it
    appId: z.string().describe("Log Rocket App ID. Go to Settings » Project Setup » General Settings to find it"),
  }),
  deviceOptions: {
    type: "internal-plugin",
    name: "logrocket",
  } as DeviceOptions,
  connectionOptions: DeviceDestinationsConnectionOptions,
};

const tagDestination = {
  id: "tag",
  isSynchronous: true,
  icon: tagIcon,
  title: "Tag",
  tags: "Device Destinations",
  description:
    "Inserts any html or javascript into your page. Use this to add any third party tracking code as Google Analytics, Facebook Pixel, Twitter Pixel, etc.",
  credentials: z.object({
    //a json representation of the code - value & language. We can't use ordinary object here
    //because 3rd-party form renderer doesn't support it
    code: z.string().describe("Code to insert into site page in <code>html</code> or <code>javascript</code> format"),
  }),
  deviceOptions: {
    type: "internal-plugin",
    name: "tag",
  } as DeviceOptions,
  credentialsUi: {
    code: {
      editor: "SnippedEditor",
      editorProps: { languages: ["html", "javascript"] },
    },
  },
  connectionOptions: DeviceDestinationsConnectionOptions,
};

const gaDeviceDestination = {
  id: "ga4-tag",
  isSynchronous: true,
  icon: ga4Icon,
  title: "Google Analytics 4 (Device Mode)",
  tags: "Device Destinations",
  description: "Tracks users in Google Analytics with client side code snippet. ",
  credentials: z.object({
    measurementIds: z
      .string()
      .describe(
        "Measurement ID::Measurement ID of your Google Analytics 4 properties. <a href='https://support.google.com/analytics/answer/9539598?hl=en' target='_blank' rel='noreferrer noopener'>How to find</a>"
      ),
    autoPageView: z
      .boolean()
      .default(false)
      .describe(
        "Rely on <a href='https://support.google.com/analytics/answer/9216061#page_view' target='_blank' rel='noopener noreferer'>Enhanced event measurement</a> to track page views. Jitsu <code>page</code> event will be ignored."
      ),
  }),
  deviceOptions: {
    type: "internal-plugin",
    name: "ga4-tag",
    // type: "analytics-plugin",
    // packageCdn:
    //   "https://cdn.jsdelivr.net/npm/@analytics/google-analytics@1.0.7/dist/@analytics/google-analytics.min.js",
    // moduleVarName: "analyticsGa",
  } as DeviceOptions,
  connectionOptions: DeviceDestinationsConnectionOptions,
};

const gtmDeviceDestination = {
  id: "gtm",
  isSynchronous: true,
  icon: gtmIcon,
  title: "Google Tag Manager",
  tags: "Device Destinations",
  description: "Installs Google Tag Manager client code and sends events to Google Tag Manager.",
  credentials: z.object({
    containerId: z.string().describe("The Container ID uniquely identifies the GTM Container."),
    dataLayerName: z.string().default("dataLayer").describe("The name of the data layer variable."),
  }),
  deviceOptions: {
    type: "internal-plugin",
    name: "gtm",
  } as DeviceOptions,
  connectionOptions: DeviceDestinationsConnectionOptions,
};

export const coreDestinations: DestinationType<any>[] = [
  tagDestination,
  gaDeviceDestination,
  gtmDeviceDestination,
  logRocketDestination,
  {
    id: "clickhouse",
    usesBulker: true,
    icon: <ClickhouseIcon />,
    connectionOptions: BaseBulkerConnectionOptions.merge(
      z.object({
        primaryKey: z.string().default("timestamp,message_id"),
        clickhouseSettings: z.string().default(""),
      })
    ).describe(
      JSON.stringify({
        limitations: {
          streamModeLocked:
            'Stream mode in ClickHouse requires async inserts enabled both on client and server level. <a href="https://clickhouse.com/docs/en/optimize/asynchronous-inserts" target="_blank" rel="noopener noreferrer">Read more about async inserts here</a>.<br/>Also, make sure to set async inserts parameters in the advanced section',
        },
      })
    ),
    title: "Clickhouse",
    tags: "Datawarehouse",
    credentials: ClickhouseCredentials,
    description:
      "ClickHouse is an open-source column-oriented database management system specialized for online analytical processing of queries (OLAP).",
    credentialsUi: {
      hosts: {
        editor: "StringArrayEditor",
      },
      loadAsJson: {
        hidden: true,
      },
      password: {
        password: true,
      },
    },
  },
  {
    id: "postgres",
    usesBulker: true,
    icon: postgresIcon,
    title: "Postgres",
    tags: "Datawarehouse",
    connectionOptions: BaseBulkerConnectionOptions,
    credentials: z.object({
      authenticationMethod: z
        .enum(["password", "google-psc"])
        .optional()
        .default("password")
        .describe(
          "Authentication Method::Standard username/password or <a target='_blank' rel='noreferrer noopener' href='https://docs.jitsu.com/destinations/warehouse/postgres#advanced-private-service-connect-for-google-cloud-sql'>Private Service Connect</a> for Google-managed postgres instances only."
        ),
      instanceConnectionName: z
        .string()
        .optional()
        .describe(
          "Instance Connection Name::Google SQL instance Connection Name in the format <code>project-name:region:instance-name</code>. <a target='_blank' rel='noreferrer noopener' href='https://docs.jitsu.com/destinations/warehouse/postgres#provide-jitsu-with-cloud-sql-instance-details'>How to obtain</a>."
        ),
      host: z.string().optional().describe("Postgres host"),
      port: z.number().optional().default(5432).describe("Postgres port"),
      sslMode: z
        .enum(["disable", "require", "verify-ca", "verify-full"])
        .optional()
        .default("require")
        .describe(
          "SSL Mode::SSL mode for Postgres connection: <code>disable</code>,<code>require</code>,<code>verify-ca</code>,<code>verify-full</code>"
        ),
      sslServerCA: z.string().optional().describe("SSL Server CA::"),
      sslClientCert: z.string().optional().describe("SSL Client Cert::"),
      sslClientKey: z.string().optional().describe("SSL Client Key::"),
      database: z.string().describe("Postgres database name"),
      username: z.string().optional().describe("Postgres username"),
      password: z.string().optional().describe("Postgres password"),
      defaultSchema: z.string().default("public").describe("Schema::Postgres schema"),
    }),
    credentialsUi: {
      authenticationMethod: {
        correction: obj => obj.authenticationMethod || "password",
      },
      instanceConnectionName: {
        hidden: obj => obj.authenticationMethod !== "google-psc",
      },
      username: {
        hidden: obj => obj.authenticationMethod === "google-psc",
      },
      password: {
        password: true,
        hidden: obj => obj.authenticationMethod === "google-psc",
      },
      host: {
        hidden: obj => obj.authenticationMethod === "google-psc",
      },
      port: {
        hidden: obj => obj.authenticationMethod === "google-psc",
      },
      sslMode: {
        hidden: obj => obj.authenticationMethod === "google-psc",
      },
      sslServerCA: {
        textarea: true,
        hidden: obj => obj.sslMode === "disable" || obj.sslMode === "require",
      },
      sslClientCert: {
        textarea: true,
        hidden: obj => obj.sslMode === "disable" || obj.sslMode === "require",
      },
      sslClientKey: {
        textarea: true,
        hidden: obj => obj.sslMode === "disable" || obj.sslMode === "require",
      },
    },
    description: "Postgres is a powerful, open source object-relational database system.",
  },
  {
    id: "bigquery",
    usesBulker: true,
    icon: bigqueryIcon,
    connectionOptions: BaseBulkerConnectionOptions.describe(
      JSON.stringify({
        limitations: {
          streamModeDisabled:
            "It's possible to implement stream mode for BigQuery, but data Deduplication cannot be supported in this mode. So it is currently disabled in Jitsu.",
        },
      })
    ),
    title: "BigQuery",
    tags: "Datawarehouse",
    description: "BigQuery is a cloud-based SQL data warehouse service developed by Google.",
    credentials: z.object({
      project: z
        .string()
        .describe(
          "Project ID::Google Cloud Project ID. <a target='_blank' rel='noreferrer noopener' href='https://support.google.com/googleapi/answer/7014113?hl=en'>Locate Project ID</a>"
        ),
      bqDataset: z
        .string()
        .describe(
          "Dataset::BigQuery <a target='_blank' rel='noreferrer noopener' href='https://cloud.google.com/bigquery/docs/datasets-intro'>Dataset</a>"
        ),
      keyFile: z
        .string()
        .describe(
          "Access Key::Google Service Account JSON for BigQuery. <a target='_blank' rel='noreferrer noopener' href='https://jitsu.com/docs/configuration/google-authorization#service-account-configuration'>Read more about Google Authorization</a>"
        ),
    }),
    credentialsUi: {
      keyFile: {
        editor: "CodeEditor",
        editorProps: {
          language: "json",
          height: "250px",
          monacoOptions: { lineNumbers: "off" },
        },
      },
    },
  },
  {
    id: "snowflake",
    usesBulker: true,
    title: "Snowflake",
    tags: "Datawarehouse",
    credentials: z.object({
      authenticationMethod: z
        .enum(["key-pair", "password"])
        .optional()
        .default("key-pair")
        .describe(
          "Authentication Method::Snowflake authentication method: <a target='_blank' rel='noopener noreferrer' href='https://docs.snowflake.com/en/user-guide/key-pair-auth'>Key-pair</a> or username/password"
        ),
      username: z.string().optional().describe("Snowflake username"),
      password: z.string().optional().describe("Snowflake password"),
      privateKey: z
        .string()
        .optional()
        .describe(
          "Private Key::Snowflake private key. <a target='_blank' rel='noopener noreferrer' href='https://docs.snowflake.com/en/user-guide/key-pair-auth'>Generate the private key</a>"
        ),
      privateKeyPassphrase: z.string().optional(),
      account: z.string().describe("Snowflake account name"),
      warehouse: z.string().describe("Snowflake warehouse name"),
      database: z.string().describe("Snowflake database name"),
      defaultSchema: z.string().default("PUBLIC").describe("Schema::Snowflake schema"),
      parameters: z
        .object({})
        .catchall(z.string().default(""))
        .optional()
        .describe("Additional Snowflake connection parameters"),
    }),
    credentialsUi: {
      authenticationMethod: {
        correction: (obj, isNew) => (isNew ? "key-pair" : obj.authenticationMethod || "password"),
      },
      password: {
        password: true,
        hidden: obj => obj.authenticationMethod === "key-pair",
      },
      privateKey: {
        hidden: obj => obj.authenticationMethod !== "key-pair",
        textarea: true,
        password: true,
      },
      privateKeyPassphrase: {
        hidden: obj => obj.authenticationMethod !== "key-pair",
        password: true,
      },
    },
    connectionOptions: BaseBulkerConnectionOptions,
    icon: snowflakeIcon,
    description: "Snowflake is an independent a cloud data warehouse with compute-based pricing.",
  },
  {
    id: "redshift",
    usesBulker: true,
    icon: redshiftIcon,
    title: "Redshift",
    connectionOptions: BaseBulkerConnectionOptions.describe(
      JSON.stringify({
        limitations: {
          streamModeLocked:
            "Supported as plain insert statements.<br/>Don't use at production scale (more than 10 records per minute)",
        },
      })
    ),
    tags: "Datawarehouse",
    credentials: z.object({
      authenticationMethod: z
        .enum(["iam", "password"])
        .optional()
        .default("password")
        .describe(
          "Authentication Method::Redshift authentication method: <a target='_blank' rel='noopener noreferrer' href='https://docs.jitsu.com/destinations/warehouse/redshift#advanced-iam-role-for-jitsu'>IAM Role based</a> or database username/password"
        ),
      serverless: z.boolean().default(false).optional().describe("Redshift Serverless::"),
      region: z.enum(s3Regions).describe("Region::Aws Region"),
      clusterIdentifier: z.string().optional().describe("Cluster Identifier::Redshift cluster identifier"),
      workgroupName: z.string().optional().describe("Workgroup name::Redshift Serverless workgroup name"),
      roleARN: z
        .string()
        .optional()
        .describe(
          "Role ARN::IAM role ARN. <a target='_blank' rel='noopener noreferrer' href='https://docs.jitsu.com/destinations/warehouse/redshift#advanced-iam-role-for-jitsu'>How to create</a>"
        ),
      externalID: z.string().optional().describe("External ID::IAM external ID"),
      host: z.string().optional().describe("Redshift host"),
      database: z.string().describe("Redshift database name"),
      defaultSchema: z.string().default("PUBLIC").describe("Schema::Redshift schema"),
      username: z.string().optional().describe("Redshift username"),
      password: z.string().optional().describe("Redshift password"),
      bucket: z.string().describe("S3 Bucket Name::S3 Bucket Name"),
      accessKeyId: z
        .string()
        .optional()
        .describe(
          "S3 Access Key Id::S3 Access Key Id. <a target='_blank' rel='noreferrer noopener' href='https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html#access-keys-and-secret-access-keys'>Create access key</a>"
        ),
      secretAccessKey: z.string().optional().describe("S3 Secret Access Key::S3 Secret Access Key"),
    }),
    credentialsUi: {
      authenticationMethod: {
        correction: obj => obj.authenticationMethod || "password",
      },
      username: {
        hidden: obj => obj.authenticationMethod === "iam" && obj.serverless === true,
      },
      password: {
        password: true,
        hidden: obj => obj.authenticationMethod === "iam",
      },
      secretAccessKey: {
        hidden: obj => obj.authenticationMethod === "iam",
        password: true,
      },
      accessKeyId: {
        hidden: obj => obj.authenticationMethod === "iam",
      },
      host: {
        hidden: obj => obj.authenticationMethod === "iam",
      },
      clusterIdentifier: {
        hidden: obj => obj.authenticationMethod !== "iam" || obj.serverless === true,
      },
      workgroupName: {
        hidden: obj => obj.authenticationMethod !== "iam" || obj.serverless === false,
      },
      roleARN: {
        hidden: obj => obj.authenticationMethod !== "iam",
      },
      externalID: {
        // constants are not yet refreshed on form state change. so it is unconditional here
        constant: obj => obj.workspaceId,
      },
    },
    description:
      "Amazon Redshift is a cloud data warehouse that is optimized for the analytical workloads of business intelligence (BI) and data warehousing (DWH). Jitsu supports both Serverless and Classic Redshift",
  },
  {
    id: "duckdb",
    usesBulker: true,
    icon: motherduckIcon,
    title: "MotherDuck (DuckDB)",
    tags: "Datawarehouse",
    connectionOptions: BaseBulkerConnectionOptions,
    credentials: z.object({
      database: z.string().describe("MotherDuck database name"),
      motherduckToken: z
        .string()
        .describe(
          "MotherDuck token::MotherDuck token can be obtained in the MotherDuck's <a target='_blank' rel='noopener noreferrer' href='https://app.motherduck.com/settings/tokens'>Settings -> Access Tokens</a> section"
        ),
      defaultSchema: z.string().default("main").describe("Schema::Database schema"),
    }),
    credentialsUi: {
      motherduckToken: {
        password: true,
      },
    },
    description: "DuckDB-powered cloud data warehouse scaling to terabytes with ease.",
  },
  {
    id: "mysql",
    usesBulker: true,
    icon: mysqlIcon,
    title: "Mysql",
    tags: "Datawarehouse",
    connectionOptions: BaseBulkerConnectionOptions,
    credentials: z.object({
      host: z.string().describe("Mysql host"),
      port: z.number().default(3306).describe("Mysql port"),
      database: z.string().describe("Mysql database name"),
      username: z.string().describe("Mysql username"),
      password: z.string().describe("Mysql password"),
      parameters: z
        .object({ tls: z.enum(["true", "false", "skip-verify", "preferred"]) })
        .catchall(z.string().default(""))
        .optional()
        .default({ tls: "preferred" })
        .describe("Additional Mysql connection parameters"),
    }),
    credentialsUi: {
      password: {
        password: true,
      },
    },
    description: "MySQL is a popular open source object-relational database system.",
  },
  {
    id: "s3",
    usesBulker: true,
    icon: s3Icon,
    connectionOptions: BaseBulkerConnectionOptions.describe(
      JSON.stringify({
        limitations: {
          streamModeDisabled: "S3 destination doesn't support stream mode.",
          identityStitchingDisabled: "S3 destination doesn't support identityStitching.",
        },
      })
    ),
    title: "Amazon S3",
    tags: "Block Storage",
    description: "S3 is a cloud file storage service by Amazon",
    credentials: z
      .object({
        authenticationMethod: z
          .enum(["iam", "accessKey"])
          .optional()
          .default("accessKey")
          .describe(
            "Authentication Method::S3 authentication method: <a target='_blank' rel='noopener noreferrer' href='https://docs.jitsu.com/destinations/block-storage/s3#advanced-iam-role-for-jitsu'>IAM Role based</a> or Access Key"
          ),
        region: z.enum(s3Regions).default(s3Regions[0]).describe("S3 Region::S3 Region"),
        roleARN: z
          .string()
          .optional()
          .describe(
            "Role ARN::IAM role ARN. <a target='_blank' rel='noopener noreferrer' href='https://docs.jitsu.com/destinations/block-storage/s3#advanced-iam-role-for-jitsu'>How to create</a>"
          ),
        externalID: z.string().optional().describe("External ID::IAM external ID"),
        accessKeyId: z
          .string()
          .optional()
          .describe(
            "S3 Access Key Id::S3 Access Key Id. <a target='_blank' rel='noreferrer noopener' href='https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html#access-keys-and-secret-access-keys'>Create access key</a>"
          ),
        secretAccessKey: z.string().optional().describe("S3 Secret Access Key::S3 Secret Access Key"),
        bucket: z.string().describe("S3 Bucket Name::S3 Bucket Name"),
        endpoint: z.string().optional().describe("Custom endpoint of S3-compatible server"),
      })
      .merge(blockStorageSettings),
    credentialsUi: {
      authenticationMethod: {
        correction: obj => obj.authenticationMethod || "accessKey",
      },
      secretAccessKey: {
        hidden: obj => obj.authenticationMethod === "iam",
        password: true,
      },
      accessKeyId: {
        hidden: obj => obj.authenticationMethod === "iam",
      },
      endpoint: {
        hidden: obj => obj.authenticationMethod === "iam",
      },
      roleARN: {
        hidden: obj => obj.authenticationMethod !== "iam",
      },
      externalID: {
        // constants are not yet refreshed on form state change. so it is unconditional here
        constant: obj => obj.workspaceId,
      },
    },
  },
  {
    id: "gcs",
    usesBulker: true,
    icon: gcsIcon,
    connectionOptions: BaseBulkerConnectionOptions.describe(
      JSON.stringify({
        limitations: {
          streamModeDisabled: "Google Cloud Storage destination doesn't support stream mode.",
          identityStitchingDisabled: "Google Cloud Storage destination doesn't support identityStitching.",
        },
      })
    ),
    title: "Google Cloud Storage",
    tags: "Block Storage",
    credentials: z
      .object({
        accessKey: z.string().describe("Google Access Key::Google Access Key"),
        bucket: z.string().describe("GCS Bucket Name::GCS Bucket Name"),
      })
      .merge(blockStorageSettings),
    description: "Google Cloud Storage is a cloud file storage service by Google",
  },
  {
    id: "mixpanel",
    icon: mixpanelIcon,
    title: "Mixpanel",
    hybrid: true,
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions.merge(BatchModeOptions).merge(
      z.object({
        batchSize: z.number().min(1).max(2000).default(1000),
        batchSizeBytes: z.number().min(1).max(10_000_000).default(9_000_000),
        mode: z.enum(["stream", "batch"]).default("stream"),
      })
    ),
    credentials: meta.MixpanelCredentials,
    credentialsUi: meta.MixpanelCredentialsUi,
    description: "Mixpanel is a product analytics platform that provides insights into user behavior.",
    syncs: {
      "airbyte/source-google-ads": {
        syncOptions: z.object({}),
        description: (
          <>
            Jitsu exports ad spend data to from Google Ads to Mixpanel to measure return on ad spend (ROAS). Learn more
            about Mixpanel ROAS tracking{" "}
            <a
              href="https://mixpanel.com/blog/the-next-evolution-of-marketing-analytics/"
              target="_blank"
              rel="noreferrer noopener"
            >
              here
            </a>
          </>
        ),
      },
      "airbyte/source-facebook-marketing": {
        syncOptions: z.object({}),
        description: (
          <>
            Jitsu exports ad spend data to from Facebook to Mixpanel to measure return on ad spend (ROAS). Learn more
            about Mixpanel ROAS tracking{" "}
            <a
              href="https://mixpanel.com/blog/the-next-evolution-of-marketing-analytics/"
              target="_blank"
              rel="noreferrer noopener"
            >
              here
            </a>
          </>
        ),
      },
    },
  },
  {
    id: "intercom",
    icon: intercomIcon,
    title: "Intercom",
    tags: "Product Analytics",
    credentials: meta.IntercomDestinationCredentials,
    connectionOptions: CloudDestinationsConnectionOptions,
    description: (
      <>
        Jitsu updates intercom companies and users on each <code>.group()</code> and <code>.identify()</code> calls. For
        other events Jitsu sends them as custom events to Intercom
      </>
    ),
  },
  {
    id: "facebook-conversions",
    icon: facebookIcon,
    title: "Facebook Conversions API",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.FacebookConversionApiCredentials,
    credentialsUi: meta.FacebookConversionApiCredentialsUi,
    description: "Facebook Conversion API is a tool for sending events to Facebook Ads Manager.",
  },
  {
    id: "june",
    icon: juneIcon,
    title: "June.so",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.JuneCredentials,
    description: "June.so is a product analytics platform that provides insights into user behavior.",
  },
  {
    id: "braze",
    icon: blazeIcon,
    title: "Braze",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.BrazeCredentials,
    description: "Braze is a customer engagement platform used by businesses for multichannel marketing.",
  },
  {
    id: "salesforce",
    icon: salesforceIcon,
    title: "Salesforce",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.SalesforceCredentials,
    credentialsUi: {
      authorized: {
        hidden: true,
      },
      oauthIntegrationId: {
        hidden: true,
      },
      oauthConnectionId: {
        hidden: true,
      },
    },
    description: "Salesforce is the world's leading customer relationship management technology.",
  },
  {
    id: "mongodb",
    icon: mongodbIcon,
    title: "MongoDB",
    tags: "Datawarehouse",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.MongodbDestinationConfig,
    credentialsUi: meta.MongodbDestinationConfigUi,
    description:
      "MongoDB is a cross-platform NoSQL document-oriented database. Jitsu supports both self-hosted Mongo and MongoDB Atlas.",
  },
  {
    id: "ga4",
    icon: ga4Icon,
    title: "Google Analytics 4 (GA4 Measurement Protocol)",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.Ga4Credentials,
    description:
      "Google Analytics 4 is a service offered by Google that reports website traffic data and marketing trends.",
  },
  {
    id: "posthog",
    icon: posthogIcon,
    title: "Posthog",
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.PosthogDestinationConfig,
    description:
      "Posthog is an open-source product analytics tool. Jitsu supports both self-hosted Posthog and Posthog Cloud.",
  },
  {
    id: "amplitude",
    icon: amplitudeIcon,
    connectionOptions: CloudDestinationsConnectionOptions,
    title: "Amplitude",
    tags: "Product Analytics",
    credentials: meta.AmplitudeDestinationConfig,
    description: "Amplitude is a product analytics platform",
  },
  {
    id: "hubspot",
    icon: hubspotIcon,
    connectionOptions: CloudDestinationsConnectionOptions,
    title: "Hubspot",
    tags: "CRM",
    credentials: HubspotCredentials,
    description: "Hubspot is a CRM. Jitsu sends data to Hubspot API and updates contacts and company records",
    documentation: (
      <>
        The integration performs several functions:
        <ul>
          <li>
            For each <code>.identify()</code> event, it either creates or updates a contact in the CRM. Jitsu utilizes a
            custom property named <code>jitsu_user_id</code>, which is automatically generated, as the unique identifier
            for the contact object. This identifier corresponds to the <code>.userId</code> property within the{" "}
            <code>identify</code> event.
          </li>
          <li>
            For each <code>.group()</code> event, it either creates or updates a company profile in the CRM. Here, Jitsu
            employs a custom property called <code>jitsu_group_id</code>, which is also automatically generated, to
            serve as the unique identifier for the company object. This identifier is derived from the{" "}
            <code>.groupId</code> property within the <code>group</code> event.
          </li>
          <li>
            If an event includes both <code>groupId</code> and <code>userId</code>, Jitsu will establish a linkage
            between the two identifiers, effectively associating the user with the company.
          </li>
          <li>
            When the <code>sendPageViews</code> feature is activated, Jitsu will forward <code>page</code> events, along
            with other related events, to HubSpot for any identified user. <b>Important:</b> To utilize this
            functionality, ensure that your HubSpot plan includes access to the{" "}
            <a href="https://developers.hubspot.com/apisbytier">Events API</a>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "devnull",
    icon: devnullIcon,
    connectionOptions: CloudDestinationsConnectionOptions,
    title: "/dev/null",
    tags: "Special",
    credentials: z.object({}),
    description:
      "This destination does not send any data anywhere. However, you can connect a function to this destination",
  },
  {
    id: "segment-proxy",
    connectionOptions: CloudDestinationsConnectionOptions,
    icon: segmentIcon,
    title: "Segment",
    tags: "Special",
    credentials: meta.SegmentCredentials,
    description: (
      <>
        Forward events for to Segment-compatible endpoint. It's useful if you want to use {branding.productName} for
        sending data to DWH and leave your existing Segment configuration for other purposes
      </>
    ),
  },
  {
    id: "webhook",
    icon: webhookIcon,
    title: "Webhook",
    tags: "Special",
    hybrid: true,
    connectionOptions: CloudDestinationsConnectionOptions.merge(BatchModeOptions).merge(
      z.object({
        batchSize: z.number().min(1).max(1000).default(100),
        mode: z.enum(["stream", "batch"]).default("stream"),
      })
    ),
    credentials: meta.WebhookDestinationConfig,
    credentialsUi: {
      headers: {
        editor: "StringArrayEditor",
      },
      payload: {
        editor: "SnippedEditor",
        editorProps: { languages: ["json", "text"], height: "300", syntaxCheck: { json: false } },
        hidden: obj => !obj.customPayload,
      },
    },
    description:
      "Send data to any HTTP endpoint. You can use this destination to send data to Slack, Discord, or any other service that accepts HTTP requests. ",
  },
];

export const coreDestinationsMap = coreDestinations.reduce((acc, destination) => {
  acc[destination.id] = destination;
  return acc;
}, {} as Record<string, DestinationType<any>>);
