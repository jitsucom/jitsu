export const mockConfiguration = process.env.FIREBASE_CONFIG
  ? ({
      authorization: "firebase",
      users: true,
      smtp: false,
      selfhosted: false,
      support_widget: true,
      default_s3_bucket: true,
      support_tracking_domains: true,
      telemetry_usage_disabled: false,
      docker_hub_id: "jitsucom",
    } as const)
  : ({
      authorization: "redis",
      users: true,
      smtp: false,
      selfhosted: true,
      support_widget: false,
      default_s3_bucket: false,
      support_tracking_domains: false,
      telemetry_usage_disabled: false,
      docker_hub_id: "jitsu",
    } as const)

export const mockUserInfo = {
  $type: "User",
  _created: "2021-06-21T05:57:09.430Z",
  _email: "taletski@jitsu.com",
  _emailOptout: false,
  _forcePasswordChange: false,
  _name: "Kirill Taletski",
  _onboarded: true,
  _project: {
    $type: "Project",
    _id: "n0h0s",
    _name: "Jitsu",
    _planId: null,
  },
  _suggestedInfo: {
    companyName: "Jitsu",
    email: "taletski@jitsu.com",
    name: "Kirill Taletski",
  },
  _uid: "ZMsokTbfoQN85RG2UEh4dFG5Yvr2",
} as const

export const mockStatistics = {
  status: "ok",
  data: [
    {
      key: "2021-07-05T00:00:00+0000",
      events: 1,
    },
  ],
} as const

export const mockDestinationTest = {
  status: "Connection established",
} as const

export const mockApiKeys = {
  keys: [
    {
      jsAuth: "js.n0h0s.8p3dqboqllxsgggnfpg3h7",
      origins: [],
      serverAuth: "s2s.n0h0s.afm065jswml5zbsnp8zgbw",
      uid: "n0h0s.0zf4ws",
    },
  ],
} as const

export const mockDestinationsList = {
  destinations: [
    {
      _comment:
        "We set up a test postgres database for you. It's hosted by us and has a 10,000 rows limitation. It's ok to try with service with it. However, don't use it in production setup. To reveal credentials, click on the 'Edit' button",
      _connectionTestOk: true,
      _formData: {
        mode: "stream",
        pgdatabase: "db_n0h0s",
        pghost: "pg1.eventnative.com",
        pgpassword: "py9lgSQ3Txgy9y2f",
        pgport: 5432,
        pguser: "u_n0h0s",
      },
      _id: "demo_postgres",
      _mappings: null,
      _onlyKeys: ["n0h0s.0zf4ws", "n0h0s.0zf4ws", "n0h0s.0zf4ws", "n0h0s.0zf4ws"],
      _sources: [],
      _type: "postgres",
      _uid: "jnpbw855i6rnlo3c9q0a8d",
    },
    {
      _id: "clickhouse",
      _uid: "8wpu5z8mq4xf6vl5g2wacb",
      _type: "clickhouse",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        ch_dsns_list: ["source1"],
        ch_cluster: "",
        ch_database: "database1",
      },
      _sources: [],
      _connectionTestOk: false,
      _connectionErrorMessage: "DSNs must have http:// or https:// prefix (#400)",
    },
    {
      _id: "facebook",
      _uid: "9sn5oyv020cje9uqyjupq",
      _type: "facebook",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        fbPixelId: "pixel_id_1",
        fbAccessToken: "access_token_fb",
      },
      _connectionTestOk: false,
      _connectionErrorMessage: "Access token is invalid: Invalid OAuth access token. (#400)",
    },
    {
      _id: "webhook",
      _uid: "gu1dl12x8wwq1cplm8wjm",
      _type: "webhook",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        url: "webhook_url",
        method: "GET",
        body: "{}",
        headers: [],
      },
      _connectionTestOk: true,
    },
    {
      _id: "snowflake",
      _uid: "9u6rnu7t9ircx84bacnuk",
      _type: "snowflake",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        snowflakeAccount: "account_sf",
        snowflakeWarehouse: "sf_warehouse",
        snowflakeDB: "sf_database",
        snowflakeSchema: "PUBLIC",
        snowflakeUsername: "taletski@jitsu.com",
        snowflakePassword: "sfpass",
        snowflakeStageName: "",
        snowflakeStageType: "s3",
        snowflakeJSONKey: '""',
        snowflakeGCSBucket: "",
        snowflakeS3Region: "us-west-1",
        snowflakeS3Bucket: "",
        snowflakeS3AccessKey: "",
        snowflakeS3SecretKey: "",
      },
      _connectionTestOk: false,
      _connectionErrorMessage:
        "260008 (08004): failed to connect to db. verify account name is correct. HTTP: 403, URL: https://account_sf.snowflakecomputing.com:443/session/v1/login-request?databaseName=sf_database&requestId=ab51e6fe-17f1-470e-9409-af8108405060&request_guid=bc609e54-1137-4173-9a8e-8bf99ec9b5ce&schemaName=PUBLIC&warehouse=sf_warehouse (#400)",
    },
    {
      _id: "google_analytics",
      _uid: "eq9728am8lj94pk33z5cz7",
      _type: "google_analytics",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        gaTrackingId: "ga_tracking_id",
      },
      _connectionTestOk: true,
    },
    {
      _id: "redshift",
      _uid: "mku34bi9obqczbv0i2g8t5",
      _type: "redshift",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        redshiftHost: "rs_host",
        redshiftDB: "rs_database",
        redshiftSchema: "public",
        redshiftUser: "taletski@jitsu.com",
        redshiftPassword: "rspass",
        redshiftUseHostedS3: false,
        redshiftS3Region: "us-west-1",
        redshiftS3Bucket: "",
        redshiftS3AccessKey: "",
        redshiftS3SecretKey: "",
      },
      _connectionTestOk: false,
      _connectionErrorMessage: "dial tcp: lookup rs_host on 172.26.0.2:53: no such host (#400)",
    },
    {
      _id: "bigquery",
      _uid: "azt6p5wwa1rjj7ibek66f",
      _type: "bigquery",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        bqProjectId: "bq_project_id",
        bqDataset: "default",
        bqJSONKey: '{\n    "key": "bq_access_key"\n}',
        bqGCSBucket: "",
      },
      _connectionTestOk: false,
      _connectionErrorMessage:
        "Error creating BigQuery client: bigquery: constructing client: missing 'type' field in credentials (#400)",
    },
    {
      _id: "postgres",
      _uid: "haldg9alvkihr75adez2v8",
      _type: "postgres",
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: [],
      _formData: {
        mode: "stream",
        tableName: "events",
        pghost: "pg_host",
        pgport: 5432,
        pgdatabase: "pgdb",
        pgschema: "public",
        pguser: "taletski@jitsu.com",
        pgpassword: "desqIw-0pyspi-bezqah",
        pgdisablessl: false,
      },
      _sources: undefined,
      _connectionTestOk: false,
      _connectionErrorMessage: "dial tcp: lookup pg_host on 172.26.0.2:53: no such host (#400)",
    },
  ],
} as const

export const mockSources = {
  sources: [
    {
      config: {
        config: {
          access_token: "sdfsadfasdfsaf",
          repository: "sdfasfasfasf",
          start_date: "2018-01-01T00:00:00.000Z",
        },
        tap: "tap-github",
      },
      connected: true,
      connectedErrorMessage: null,
      destinations: ["jnpbw855i6rnlo3c9q0a8d"],
      schedule: "*/5 * * * *",
      sourceId: "singer-tap-github",
      sourceProtoType: "singer_tap_github",
      sourceType: "singer",
    },
    {
      collections: [
        {
          name: "facebook_marketing_insights",
          parameters: {
            fields: ["account_id"],
            level: "ad",
          },
          schedule: "*/5 * * * *",
          type: "insights",
        },
      ],
      config: {
        access_token: "asdfasfsafsafasdgshdgfj",
        account_id: "sdfasfsafsadfsfsaf",
      },
      connected: false,
      connectedErrorMessage:
        "facebook: Invalid OAuth access token. (code: 190; error_subcode: 0, error_user_title: , error_user_msg: ) (#400)",
      destinations: ["jnpbw855i6rnlo3c9q0a8d"],
      sourceId: "facebook_marketing",
      sourceProtoType: "facebook_marketing",
      sourceType: "facebook_marketing",
    },
    {
      collections: [
        {
          name: "firebase_users",
          parameters: {},
          schedule: "*/5 * * * *",
          type: "users",
        },
      ],
      config: {
        auth: {
          type: "Service Account",
        },
        key: '{"key": "test_firebase_key"}',
        project_id: "test_firebase_id",
      },
      connected: false,
      connectedErrorMessage: "missing 'type' field in credentials (#400)",
      destinations: undefined,
      sourceId: "firebase",
      sourceProtoType: "firebase",
      sourceType: "firebase",
    },
    {
      collections: [
        {
          name: "google_analytics_report",
          parameters: {
            dimensions: [
              "ga:userType",
              "ga:visitorType",
              "ga:sessionCount",
              "ga:visitCount",
              "ga:daysSinceLastSession",
              "ga:userDefinedValue",
              "ga:userBucket",
            ],
            metrics: [
              "ga:newUsers",
              "ga:percentNewSessions",
              "ga:7dayUsers",
              "ga:exits",
              "ga:uniquePageviews",
              "ga:redirectionTime",
              "ga:avgServerConnectionTime",
              "ga:eventValue",
              "ga:transactions",
              "ga:totalValue",
            ],
          },
          schedule: "*/5 * * * *",
          type: "report",
        },
        {
          name: "google_analytics_report1",
          parameters: {
            dimensions: ["ga:daysSinceLastSession", "ga:source", "ga:adContent", "ga:socialNetwork"],
            metrics: [
              "ga:percentNewVisits",
              "ga:7dayUsers",
              "ga:sessionDuration",
              "ga:costPerTransaction",
              "ga:adCost",
              "ga:CPC",
            ],
          },
          schedule: "*/5 * * * *",
          type: "report",
        },
      ],
      config: {
        auth: {
          client_id: "ga_src_test-client_id",
          client_secret: "ga_src_test-oauth_client",
          refresh_token: "ga_src_test-refresh_token",
          service_account_key: null,
          type: "OAuth",
        },
        view_id: "ga_src_test-view_id",
      },
      connected: false,
      connectedErrorMessage:
        'Post "https://analyticsreporting.googleapis.com/v4/reports:batchGet?alt=json&prettyPrint=false": oauth2: cannot fetch token: 401 Unauthorized\nResponse: {\n  "error": "invalid_client",\n  "error_description": "The OAuth client was not found."\n} (#400)',
      destinations: [],
      sourceId: "google_analytics",
      sourceProtoType: "google_analytics",
      sourceType: "google_analytics",
    },
    {
      collections: [
        {
          name: "google_play_earnings",
          parameters: {},
          schedule: "*/5 * * * *",
          type: "earnings",
        },
      ],
      config: {
        account_id: "gp_src_test-account_id",
        auth: {
          client_id: "gp_src_test-oauth_client_id",
          client_secret: "gp_src_test-oauth_client",
          refresh_token: "ga_src_test-refresh_token",
          service_account_key: null,
          type: "OAuth",
        },
      },
      connected: false,
      connectedErrorMessage:
        'Get "https://storage.googleapis.com/storage/v1/b/pubsite_prod_rev_gp_src_test-account_id/o?alt=json&delimiter=&pageToken=&prefix=&prettyPrint=false&projection=full&versions=false": oauth2: cannot fetch token: 401 Unauthorized\nResponse: {\n  "error": "invalid_client",\n  "error_description": "The OAuth client was not found."\n} (#400)',
      destinations: [],
      sourceId: "google_play",
      sourceProtoType: "google_play",
      sourceType: "google_play",
    },
    {
      config: {
        config: {
          client_id: "gs_src_test-oauth_client_id",
          client_secret: "gs_src_test-oauth_client",
          refresh_token: "gs_src_test-refresh_token",
          spreadsheet_id: "gs_src_test-google",
          start_date: "2018-01-01T00:00:00.000Z",
          type: "OAuth",
          user_agent: "Jitsu Bot (https://jitsu.com)",
        },
        tap: "tap-google-sheets",
      },
      connected: true,
      connectedErrorMessage: null,
      destinations: [],
      schedule: "*/5 * * * *",
      sourceId: "singer-tap-google-sheets",
      sourceProtoType: "singer_tap_google_sheets",
      sourceType: "singer",
    },
    {
      config: {
        config: {
          exclude_archived: false,
          join_public_channels: false,
          private_channels: false,
          start_date: "2018-01-01T00:00:00.000Z",
          token: "slack_src_test-access_token",
        },
        tap: "tap-slack",
      },
      connected: true,
      connectedErrorMessage: null,
      destinations: [],
      schedule: "*/5 * * * *",
      sourceId: "singer-tap-slack",
      sourceProtoType: "singer_tap_slack",
      sourceType: "singer",
    },
    {
      collections: [
        {
          name: "redis_undefined",
          parameters: {
            redis_key: "redis_src_test-key_pattern",
          },
          schedule: "*/5 * * * *",
        },
      ],
      config: {
        host: "redis_src_test-host",
        password: "",
        port: 6379,
      },
      connected: false,
      connectedErrorMessage:
        "Error testing Redis connection: dial tcp: lookup redis_src_test-host on 172.26.0.2:53: no such host (#400)",
      destinations: [],
      sourceId: "redis",
      sourceProtoType: "redis",
      sourceType: "redis",
    },
  ],
} as const
