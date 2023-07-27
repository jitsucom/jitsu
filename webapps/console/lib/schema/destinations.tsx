import { SomeZodObject, z } from "zod";
import React, { ReactNode } from "react";

import amplitudeIcon from "./icons/amplitude";
import bigqueryIcon from "./icons/bigquery";
import ClickhouseIcon from "./icons/clickhouse";
import devnullIcon from "./icons/devnull";
import gcsIcon from "./icons/gcs";
import hubspotIcon from "./icons/hubspot";
import mixpanelIcon from "./icons/mixpanel";
import juneIcon from "./icons/june";
import mongodbIcon from "./icons/mongodb";

import ga4Icon from "./icons/ga4";
import gtmIcon from "./icons/gtm";
import postgresIcon from "./icons/postgres";
import mysqlIcon from "./icons/mysql";
import redshiftIcon from "./icons/redshift";
import posthogIcon from "./icons/posthog";
import segmentIcon from "./icons/segment";
import s3Icon from "./icons/s3";
import tagIcon from "./icons/tag";
import snowflakeIcon from "./icons/snowflake";
import logRocketIcon from "./icons/logrocket";
import webhookIcon from "./icons/webhook";
import { branding } from "../branding";
import * as meta from "@jitsu/core-functions/src/meta";
import { SegmentCredentials } from "@jitsu/core-functions/src/meta";

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
  hidden?: boolean;
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

//Options of any source -> destination connection that are not specific to any particular destination
export const CloudDestinationsConnectionOptions = z.object({
  functions: z.array(z.object({ functionId: z.string(), functionOptions: z.any() })).optional(),
});
export type CloudDestinationsConnectionOptions = z.infer<typeof CloudDestinationsConnectionOptions>;

//Auxiliary type for batch mode options
export const BatchModeOptions = z.object({
  batchSize: z.number().min(1).optional(),
  frequency: z
    .number()
    .int()
    .min(1)
    .max(60 * 24)
    .default(5),
});
export type BatchModeOptions = z.infer<typeof BatchModeOptions>;

/**
 * Common settings for device destination connections
 */
export const DeviceDestinationsConnectionOptions = z.object({
  events: z.string().optional().default("*"),
  hosts: z.string().optional().default("*"),
});

export type DeviceDestinationsConnectionOptions = z.infer<typeof DeviceDestinationsConnectionOptions>;

//All possible options for Bulker based source -> destination connection
export const BaseBulkerConnectionOptions = z
  .object({
    mode: z.enum(["stream", "batch"]).default("batch"),
    primaryKey: z.string().default("message_id"),
    deduplicate: z.boolean().default(true),
    timestampColumn: z.string().default("timestamp"),
    dataLayout: z
      .enum(["segment", "jitsu-legacy", "segment-single-table", "passthrough"])
      .default("segment-single-table"),
  })
  .merge(BatchModeOptions)
  .merge(CloudDestinationsConnectionOptions);

export type BaseBulkerConnectionOptions = z.infer<typeof BaseBulkerConnectionOptions>;

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
  tags: string | string[];
  credentials: SomeZodObject;
  connectionOptions: SomeZodObject;
  credentialsUi?: SchemaUI;
  comingSoon?: boolean;
  icon?: ReactNode;
  description: ReactNode;
  //For cloud (=server side) destinations - name builtin of the function that implements it
  implementingFunction?: string;
  //For device destinations - how this destination should be invoked? Information such as analytics plugin name, package name
  //etc. Not typed yet since so far each destination has its own settings
  deviceOptions?: DeviceOptions;
};

export const blockStorageSettings = z.object({
  folder: z.string().optional().describe("Folder in the block storage bucket where files will be stored"),
  format: z
    .enum(["ndjson", "ndjson_flat", "csv"])
    .default("ndjson")
    .describe(
      "Format of the files stored in the block storage: <code>ndjson</code> - Newline Delimited JSON, <code>ndjson_flat</code> - Newline Delimited JSON flattened, <code>csv</code> - CSV"
    ),
  compression: z
    .enum(["gzip", "none"])
    .default("none")
    .describe(
      "Compression algorithm used for the files stored in the block storage: <code>gzip</code> - GZIP, <code>none</code> - no compression."
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
    .describe("Name of cluster to use. If clickhouse works in single node mode, leave this field empty"),
  database: z.string().default("default").describe("Name of the database to use"),
  parameters: z
    .object({})
    .catchall(z.string().default(""))
    .optional()
    .describe(
      "Additional parameters for ClickHouse driver. See <a href='https://clickhouse.com/docs/en/integrations/go#connection-settings-1' rel='noreferrer noopener' target='_blank'>Clickhouse documentation</a>"
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
    code: { editor: "SnippedEditor", editorProps: { languages: ["html", "javascript"] } },
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
        "Measurement IDs of your Google Analytics 4 properties. <a href='https://support.google.com/analytics/answer/9539598?hl=en' target='_blank' rel='noreferrer noopener'>How to find</a>"
      ),
  }),
  deviceOptions: {
    type: "analytics-plugin",
    packageCdn:
      "https://cdn.jsdelivr.net/npm/@analytics/google-analytics@1.0.5/dist/@analytics/google-analytics.min.js",
    moduleVarName: "analyticsGa",
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
    connectionOptions: BaseBulkerConnectionOptions.describe(
      JSON.stringify({
        limitations: {
          streamModeLocked:
            'Stream mode in ClickHouse is <a href="https://clickhouse.com/docs/knowledgebase/exception-too-many-parts" target="_blank" rel="noopener noreferrer">limited by MergeTree engine capabilities</a>.<br/>ClickHouse is not designed to handle a large number of individual inserts.<br/>Use it only for testing purposes.',
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
      host: z.string().describe("Postgres host"),
      port: z.number().default(5432).describe("Postgres port"),
      sslMode: z
        .enum(["disable", "require"])
        .default("require")
        .describe("SSL Mode::SSL mode for Postgres connection: <code>disable</code> or <code>require</code>"),
      database: z.string().describe("Postgres database name"),
      username: z.string().describe("Postgres username"),
      password: z.string().describe("Postgres password"),
      defaultSchema: z.string().default("public").describe("Schema::Postgres schema"),
    }),
    credentialsUi: {
      password: {
        password: true,
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
        editorProps: { language: "json", height: "250px", monacoOptions: { lineNumbers: "off" } },
      },
    },
  },
  {
    id: "snowflake",
    usesBulker: true,
    title: "Snowflake",
    tags: "Datawarehouse",
    credentials: z.object({
      account: z.string().describe("Snowflake account name"),
      database: z.string().describe("Snowflake database name"),
      defaultSchema: z.string().default("PUBLIC").describe("Schema::Snowflake schema"),
      username: z.string().describe("Snowflake username"),
      password: z.string().describe("Snowflake password"),
      warehouse: z.string().describe("Snowflake warehouse name"),
      parameters: z
        .object({})
        .catchall(z.string().default(""))
        .optional()
        .describe("Additional Snowflake connection parameters"),
    }),
    credentialsUi: {
      password: {
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
      host: z.string().describe("Redshift host"),
      database: z.string().describe("Redshift database name"),
      defaultSchema: z.string().default("PUBLIC").describe("Schema::Redshift schema"),
      username: z.string().describe("Redshift username"),
      password: z.string().describe("Redshift password"),
      accessKeyId: z
        .string()
        .describe(
          "S3 Access Key Id::S3 Access Key Id. <a target='_blank' rel='noreferrer noopener' href='https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html#access-keys-and-secret-access-keys'>Create access key</a>"
        ),
      secretAccessKey: z.string().describe("S3 Secret Access Key::S3 Secret Access Key"),
      region: z.enum(s3Regions).describe("S3 Region::S3 Region"),
      bucket: z.string().describe("S3 Bucket Name::S3 Bucket Name"),
    }),
    credentialsUi: {
      password: {
        password: true,
      },
      secretAccessKey: {
        password: true,
      },
    },
    description:
      "Amazon Redshift is a cloud data warehouse that is optimized for the analytical workloads of business intelligence (BI) and data warehousing (DWH). Jitsu supports both Serverless and Classic Redshift",
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
        accessKeyId: z
          .string()
          .describe(
            "S3 Access Key Id::S3 Access Key Id. <a target='_blank' rel='noreferrer noopener' href='https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html#access-keys-and-secret-access-keys'>Create access key</a>"
          ),
        secretAccessKey: z.string().describe("S3 Secret Access Key::S3 Secret Access Key"),
        bucket: z.string().describe("S3 Bucket Name::S3 Bucket Name"),
        region: z.enum(s3Regions).default(s3Regions[0]).describe("S3 Region::S3 Region"),
        endpoint: z.string().optional().describe("Custom endpoint of S3-compatible server"),
      })
      .merge(blockStorageSettings),
    credentialsUi: {
      secretAccessKey: {
        password: true,
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
    tags: "Product Analytics",
    connectionOptions: CloudDestinationsConnectionOptions,
    credentials: meta.MixpanelCredentials,
    credentialsUi: meta.MixpanelCredentialsUi,
    description: "Mixpanel is a product analytics platform that provides insights into user behavior.",
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
    title: "Google Analytics 4",
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
    comingSoon: true,
    credentials: z.object({
      apiKey: z.string().describe("API Key::Amplitude API Key"),
    }),
    description: "Amplitude is a product analytics platform",
  },
  {
    id: "hubspot",
    icon: hubspotIcon,
    comingSoon: true,
    connectionOptions: CloudDestinationsConnectionOptions,
    title: "Hubspot",
    tags: "CRM",
    credentials: z.object({
      apiKey: z.string().describe("API Key::Hubspot API Key"),
      hubId: z.string().describe("Hub ID::Hubspot Hub ID"),
    }),
    description: "Hubspot is a CRM. Jitsu sends data to Hubspot API and updates contacts and company records",
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
    credentials: SegmentCredentials,
    description: (
      <>
        Forward events for to Segment-compatible endpoint. It's useful if you want to use {branding.productName} for
        sending data to DWH and leave your existing Segment configuration for other purposes
      </>
    ),
  },
  {
    id: "webhook",
    connectionOptions: CloudDestinationsConnectionOptions,
    icon: webhookIcon,
    title: "Webhook",
    tags: "Special",
    credentials: meta.WebhookDestinationConfig,
    credentialsUi: {
      headers: {
        editor: "StringArrayEditor",
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
