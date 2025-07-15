import { getCoreDestinationType } from "../../../lib/schema/destinations";
import omit from "lodash/omit";
import {
  MixpanelCredentials,
  AmplitudeDestinationConfig,
  FacebookConversionApiCredentials,
  HubspotCredentials,
} from "@jitsu/core-functions/src/meta";

type SourceMapping =
  | ((src: any) => {
      package: string;
      version: string;
      credentials: any;
      streams: any;
    })
  | "skip";

type DestinationMapping =
  | {
      type?: string;
      credentialsFunc: (_formData: any) => any;
      transformFunc?: (code: string) => string;
    }
  | "skip";

function parseDstCreds(destinationType: string, creds: any) {
  try {
    console.log("Parsing credentials for destination type", destinationType, JSON.stringify(creds));
    const dstType = getCoreDestinationType(destinationType);
    return dstType.credentials.parse(creds);
  } catch (e: any) {
    throw new Error(
      `Failed to parse credentials for destination type ${destinationType}:\n${JSON.stringify(creds)}\nError:\n${
        e.message
      }`
    );
  }
}

export const mapAmplitudeFunction = (funcCode: string) => {
  return `
export default async function(event, ctx) {
    event = toJitsuClassic(event, ctx)
    
    let res = classicFunction(event, ctx)
    
    if (!res) {
      return "drop"
    } else if (typeof res === 'object') {
      return {
        amplitudeEvent: res
      }
    } else {
      return res
    }
} 

function classicFunction(event, $context) {
    let $ = event
    let _ = event
    const $kv = $context.store
    $context.header = (name) => Object.entries($context.headers).find(([k,v]) => k.toLowerCase() === name.toLowerCase())?.[1]
    ${funcCode}
}
`;
};

export const mapFacebookFunction = (funcCode: string) => {
  return `
export default async function(event, ctx) {
    event = toJitsuClassic(event, ctx)
    
    let res = classicFunction(event, ctx)
    
    if (!res) {
      return "drop"
    } else if (typeof res === 'object') {
      return {
        facebookEvent: res
      }
    } else {
      return res
    }
} 

function classicFunction(event, $context) {
    let $ = event
    let _ = event
    const $kv = $context.store
    $context.header = (name) => Object.entries($context.headers).find(([k,v]) => k.toLowerCase() === name.toLowerCase())?.[1]
    ${funcCode}
}
`;
};

export const destinationMappings: Record<string, DestinationMapping> = {
  google_analytics: "skip",
  dbtcloud: "skip",
  webhook: {
    credentialsFunc: _formData => {
      const url = new URL(_formData.url);
      return parseDstCreds("webhook", {
        method: _formData.method,
        url: _formData.url,
        enableAnonymousUserProfiles: false,
        dataResidency: "US",
        sessionWindow: 30,
      });
    },
  },
  amplitude: {
    credentialsFunc: _formData => {
      const amplitudeCred: AmplitudeDestinationConfig = {
        minIdLength: 5,
        key: _formData.apiKey,
        dataResidency: _formData.endpoint?.includes("api.eu.amplitude.com") ? "EU" : "US",
        sessionWindow: 30,
        groupType: "company",
        enableAnonymousUserProfiles: false,
        enableGroupAnalytics: false,
      };
      return parseDstCreds("amplitude", amplitudeCred);
    },
    transformFunc: mapAmplitudeFunction,
  },
  facebook: {
    type: "facebook-conversions",
    credentialsFunc: _formData => {
      const facebookCred: FacebookConversionApiCredentials = {
        pixelId: _formData.fbPixelId,
        accessToken: _formData.fbAccessToken,
        actionSource: "website",
        events: "",
        phoneFieldName: "",
      };
      return parseDstCreds("facebook-conversions", facebookCred);
    },
    transformFunc: mapFacebookFunction,
  },
  hubspot: {
    credentialsFunc: _formData => {
      const hubspotCred: HubspotCredentials = {
        accessToken: _formData.accessToken,
        autoCreateCustomProperties: false,
        sendPageViewEvents: false,
      };
      return parseDstCreds("hubspot", hubspotCred);
    },
  },
  mixpanel2: {
    type: "mixpanel",
    credentialsFunc: _formData => {
      const mixpanelCred: MixpanelCredentials = {
        projectId: _formData.project_id,
        serviceAccountUserName: "",
        serviceAccountPassword: "",
        projectToken: _formData.token,
        sendPageEvents: false,
        sendIdentifyEvents: false,
        simplifiedIdMerge: false,
        enableGroupAnalytics: false,
        groupKey: "",
        filterBotTraffic: true,
        enableAnonymousUserProfiles: _formData.anonymous_users_enabled,
      };
      return parseDstCreds("mixpanel", mixpanelCred);
    },
  },
  mixpanel: {
    credentialsFunc: _formData => {
      const mixpanelCred: MixpanelCredentials = {
        projectId: "",
        serviceAccountUserName: "",
        serviceAccountPassword: "",
        projectToken: _formData.token,
        sendPageEvents: true,
        sendIdentifyEvents: false,
        simplifiedIdMerge: false,
        enableGroupAnalytics: false,
        groupKey: "",
        filterBotTraffic: true,
        enableAnonymousUserProfiles: _formData.anonymous_users_enabled,
      };
      return parseDstCreds("mixpanel", mixpanelCred);
    },
  },
  gcs: {
    credentialsFunc: _formData => {
      return parseDstCreds("gcs", {
        bucket: _formData.gcsBucket,
        accessKey: _formData.gcsKey,
        compression: _formData.gcsCompressionEnabled ? "gzip" : "none",
        format: _formData.gcsFormat.replace("json", "ndjson"),
        folder: _formData.gcsFolder,
      });
    },
  },
  bigquery: {
    credentialsFunc: _formData => {
      return parseDstCreds("bigquery", {
        project: _formData.bqProjectId,
        bqDataset: _formData.bqDataset,
        keyFile: _formData.bqJSONKey,
      });
    },
  },
  snowflake: {
    credentialsFunc: _formData => {
      return parseDstCreds("snowflake", {
        authenticationMethod: "password",
        username: _formData.snowflakeUsername,
        password: _formData.snowflakePassword,
        account: _formData.snowflakeAccount,
        warehouse: _formData.snowflakeWarehouse,
        database: _formData.snowflakeDB,
        defaultSchema: _formData.snowflakeSchema,
      });
    },
  },
  mysql: {
    credentialsFunc: _formData => {
      return parseDstCreds("mysql", {
        host: _formData.mysqlHost,
        port: _formData.mysqlPort,
        database: _formData.mysqlDatabase,
        username: _formData.mysqlUser,
        password: _formData.mysqlPassword,
      });
    },
  },
  postgres: {
    credentialsFunc: _formData => {
      if (_formData.pghost.includes("eventnative.com")) {
        return undefined;
      }
      return parseDstCreds("postgres", {
        host: _formData.pghost,
        port: _formData.pgport,
        sslMode: _formData.pgsslmode,
        database: _formData.pgdatabase,
        username: _formData.pguser,
        password: _formData.pgpassword,
        defaultSchema: _formData.pgschema,
        sslServerCA: _formData.pgssl.server_ca,
        sslClientCert: _formData.pgssl.client_cert,
        sslClientKey: _formData.pgssl.client_key,
      });
    },
  },
  s3: {
    credentialsFunc: _formData => {
      if (_formData.s3Format === "parquet") {
        throw new Error("Parquet format is not supported");
      }
      return parseDstCreds("s3", {
        accessKeyId: _formData.s3AccessKeyID,
        secretAccessKey: _formData.s3SecretKey,
        region: _formData.s3Region,
        bucket: _formData.s3Bucket,
        endpoint: _formData.s3Endpoint,
        authenticationMethod: "accessKey",
        folder: _formData.s3Folder,
        format:
          _formData.s3Format == "json"
            ? "ndjson"
            : _formData.s3Format == "flat_json"
            ? "ndjson_flat"
            : _formData.s3Format,
        compression: _formData.s3CompressionEnabled ? "gzip" : "none",
      });
    },
  },
  clickhouse: {
    credentialsFunc: _formData => {
      const dsns = _formData.ch_dsns_list as string[];
      const database = _formData.ch_database;
      const cluster = _formData.ch_cluster;
      const engine = _formData.engine;
      if (engine) {
        throw new Error("Engine is not supported");
      }
      const hosts: string[] = [];
      let protocol: string = "https";
      let parameters: Record<string, string> = {};
      let username: string = "";
      let password: string = "";
      let port: number = 8443;

      for (const dsn of dsns) {
        //parse dsn as URL
        const url = new URL(dsn.replace("\u0026", "&"));
        switch (url.protocol) {
          case "http:":
            protocol = url.protocol.replace(":", "");
            port = 8123;
            break;
          case "https:":
            protocol = url.protocol.replace(":", "");
            port = 8443;
            break;
          case "clickhouse:":
            protocol = "clickhouse-secure";
            port = 9440;
            break;
          default:
            throw new Error(`Unsupported protocol: ${url.protocol}`);
        }
        if (url.port) {
          port = parseInt(url.port);
        }
        username = url.username;
        password = url.password;
        parameters = Object.fromEntries(url.searchParams);
        hosts.push(url.hostname + ":" + port);
      }
      if (parameters["tls_config"]) {
        if (parameters["tls_config"] === "maincert") {
          delete parameters["tls_config"];
        } else {
          throw new Error("TLS config is not supported");
        }
      }
      return parseDstCreds("clickhouse", {
        protocol,
        hosts,
        parameters,
        username,
        password,
        database,
        cluster,
        loadAsJson: false,
      });
    },
  },
};

export const sourceMappings: Record<string, SourceMapping> = {
  facebook_marketing: "skip",
  google_ads: "skip",
  google_analytics: "skip",
  sdk_source: "skip",
  firebase: src => ({
    package: "jitsucom/source-firebase",
    version: "0.0.3",
    credentials: {
      serviceAccountKey: src.config.key,
      projectId: src.config.project_id,
    },
    streams: Object.fromEntries(
      (src.collections ?? []).map((s: any) => [
        `${s.type === "users" ? "auth" : "firestore"}.${s.type}`,
        {
          sync_mode: "full_refresh",
          table_name: s.name,
        },
      ])
    ),
  }),
  singer_tap_google_search_console: src => {
    let config: any;
    if (typeof src.config.config === "string") {
      config = JSON.parse(src.config.config);
    } else {
      config = src.config.config;
    }
    return {
      package: "airbyte/source-google-search-console",
      version: "latest",
      credentials: {
        authorization: {
          auth_type: "Client",
          client_id: config?.client_id,
          client_secret: config?.client_secret,
          refresh_token: config?.refresh_token,
        },
        start_date: config?.start_date?.substring(0, 10),
        site_urls: Array.isArray(config?.site_urls) ? config?.site_urls : config?.site_urls.split(","),
      },
      streams: {},
    };
  },
  singer_tap_google_sheets: src => ({
    package: "airbyte/source-google-sheets",
    version: "latest",
    credentials: {
      credentials: {
        auth_type: "Client",
        client_id: "",
        client_secret: "",
        refresh_token: src.config.config?.refresh_token,
      },
      spreadsheet_id: !src.config.config?.spreadsheet_id.startsWith("https://")
        ? `https://docs.google.com/spreadsheets/d/${src.config.config?.spreadsheet_id}/edit`
        : src.config.config?.spreadsheet_id,
    },
    streams: mapSelectedSteams(src),
  }),
  airbyte: src => ({
    package: "airbyte/" + src.config.docker_image,
    version: src.config.image_version,
    credentials: src.config.config,
    streams: mapSelectedSteams(src),
  }),
};

const mapSelectedSteams = (src: any) =>
  Object.fromEntries(
    (src.config.selected_streams ?? []).map((s: any) => [
      s.namespace ? s.namespace + "." + s.name : s.name,
      omit(s, "namespace", "name"),
    ])
  );

export const TableFunctionCode = `
export default async function(event, { log }) {
    // If JITSU_TABLE_NAME was not assigned by other functions
    // set it to the value of TABLE_NAME env variable when present
    if (!event.JITSU_TABLE_NAME && process.env.TABLE_NAME) {
        log.info(\`Assigning table name: \${process.env.TABLE_NAME}\`)
        event.JITSU_TABLE_NAME = process.env.TABLE_NAME
        return event
    }
}
`;

export const mapClassicFunction = (funcCode: string) => {
  return `
export default async function(event, ctx) {
    event = toJitsuClassic(event, ctx)
    
    let res = classicFunction(event, ctx)
    
    if (!res) {
      return "drop"
    } else if (typeof res === 'object') {
      if (Array.isArray(res)) {
        return res.map(postMapping(event))
      } else {
        return postMapping(event)(res)
      }
    } else {
      return res
    }
} 
function postMapping(original) {
    const ogId = original.eventn_ctx_event_id
    const ogTimestamp = original._timestamp
    return (event, index) => {
        if (index > 0) {
            event.eventn_ctx_event_id = (event.eventn_ctx_event_id || ogId) + "_" + index
        } else if (!event.eventn_ctx_event_id) {
            event.eventn_ctx_event_id = ogId
        }
        if (!event._timestamp) {
            event._timestamp = ogTimestamp
        }
        return fromJitsuClassic(event)
    }
}

function classicFunction(event, $context) {
    let $ = event
    let _ = event
    const $kv = $context.store
    $context.header = (name) => Object.entries($context.headers).find(([k,v]) => k.toLowerCase() === name.toLowerCase())?.[1]
    ${funcCode}
}
`;
};

export const mapWebhookPayload = (funcCode: string) => {
  if (funcCode.startsWith("{") || !funcCode.includes("return")) {
    throw new Error("Function code should return a value");
  }
  return `
export default async function(event, ctx) {
    event = toJitsuClassic(event, ctx)
    
    return classicFunction(event, ctx)
} 

function classicFunction(event, $context) {
    let $ = event
    let _ = event
    const $kv = $context.store
    $context.header = (name) => Object.entries($context.headers).find(([k,v]) => k.toLowerCase() === name.toLowerCase())?.[1]
    ${funcCode}
}
`;
};
