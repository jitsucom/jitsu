import { makeObjectFromFieldsValues } from "./marshalling"
// import { form_marshalling_test_data } from './marshalling.test.data';

const form_marshalling_test_data: {
  [key: string]: { input: unknown; expectedOutput: unknown }
} = {
  test_redis_source__config: {
    input: {
      sourceId: "test_configs",
      schedule: "@daily",
      "config.host": "example.com",
      "config.port": 6379,
      "config.password": "hidden",
    },
    expectedOutput: {
      sourceId: "test_configs",
      schedule: "@daily",
      config: {
        host: "example.com",
        port: 6379,
        password: "hidden",
      },
    },
  },
  test_redis_source__streams: {
    input: {
      collections: [
        {
          name: "api_keys",
          parameters: {
            redis_key: "config#api_keys",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "destinations",
          parameters: {
            redis_key: "config#destinations",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "users_info",
          parameters: {
            redis_key: "config#users_info",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "sources",
          parameters: {
            redis_key: "config#sources",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "source_events",
          parameters: {
            redis_key: "daily_events:source*",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "push_source_events",
          parameters: {
            redis_key: "daily_events:push_source*",
          },
          schedule: "*/5 * * * *",
        },
      ],
    },
    expectedOutput: {
      collections: [
        {
          name: "api_keys",
          parameters: {
            redis_key: "config#api_keys",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "destinations",
          parameters: {
            redis_key: "config#destinations",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "users_info",
          parameters: {
            redis_key: "config#users_info",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "sources",
          parameters: {
            redis_key: "config#sources",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "source_events",
          parameters: {
            redis_key: "daily_events:source*",
          },
          schedule: "*/5 * * * *",
          type: "hash",
        },
        {
          name: "push_source_events",
          parameters: {
            redis_key: "daily_events:push_source*",
          },
          schedule: "*/5 * * * *",
        },
      ],
    },
  },
  test_redis_source__destinations: {
    input: {
      destinations: ["somerandomasdfasdfasdf"],
    },
    expectedOutput: {
      destinations: ["somerandomasdfasdfasdf"],
    },
  },

  test_firebase_auth_users_source__config: {
    input: {
      sourceId: "test_firebase_auth_users",
      schedule: "@daily",
      "config.auth.type": "Service Account",
      "config.key":
        '{\n    "type":"some_type","project_id":"MY_PROJECT_ID","private_key_id":"PRIVATE_KEY","private_key":"-----BEGIN PRIVATE KEY-----\\sdfasdfasdfasdfsdfasdf\\part_two+part_three/part_four+part_five\\part_six\\sdfasdfasdfg;j345245323451234dfagqew\\rest_of_the_key\\-------END PRIVATE KEY-----\\n","client_email":"example@MY_PROJECT_ID.iam.example.com","client_id":"88005553535","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/example%40MY_PROJECT_ID.iam.example.com"\n}',
      "config.project_id": "MY_PROJECT_ID",
    },
    expectedOutput: {
      sourceId: "test_firebase_auth_users",
      schedule: "@daily",
      config: {
        auth: {
          type: "Service Account",
        },
        key: '{\n    "type":"some_type","project_id":"MY_PROJECT_ID","private_key_id":"PRIVATE_KEY","private_key":"-----BEGIN PRIVATE KEY-----\\sdfasdfasdfasdfsdfasdf\\part_two+part_three/part_four+part_five\\part_six\\sdfasdfasdfg;j345245323451234dfagqew\\rest_of_the_key\\-------END PRIVATE KEY-----\\n","client_email":"example@MY_PROJECT_ID.iam.example.com","client_id":"88005553535","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/example%40MY_PROJECT_ID.iam.example.com"\n}',
        project_id: "MY_PROJECT_ID",
      },
    },
  },
  test_firebase_auth_users_source__streams: {
    input: {
      collections: [
        {
          name: "firebase_user",
          parameters: {},
          schedule: "*/5 * * * *",
          type: "users",
        },
      ],
    },
    expectedOutput: {
      collections: [
        {
          name: "firebase_user",
          parameters: {},
          schedule: "*/5 * * * *",
          type: "users",
        },
      ],
    },
  },

  test_airbyte_hubspot__config: {
    input: {
      sourceId: "test_hubspot",
      schedule: "*/5 * * * *",
      "config.docker_image": "source-hubspot",
      "config.config.credentials.credentials_title": "API Key Credentials",
      "config.config.start_date": "2017-01-25T00:00:00Z",
      "config.config.credentials.api_key": "some_hidden_api_key_hubspot",
    },
    expectedOutput: {
      sourceId: "test_hubspot",
      schedule: "*/5 * * * *",
      config: {
        docker_image: "source-hubspot",
        config: {
          credentials: {
            credentials_title: "API Key Credentials",
            api_key: "some_hidden_api_key_hubspot",
          },
          start_date: "2017-01-25T00:00:00Z",
        },
      },
    },
  },
  test_airbyte_hubspot__destinations: {
    input: {
      destinations: ["44c3n5p4v86h4qpf6k6rqh"],
    },
    expectedOutput: {
      destinations: ["44c3n5p4v86h4qpf6k6rqh"],
    },
  },

  test_slack_source__config: {
    input: {
      sourceId: "jitsu_slack",
      schedule: "@hourly",
      "config.tap": "tap-slack",
      "config.config.token": "hidden_asdfasfd35425fs",
      "config.config.start_date": "1917-07-01T00:00:00.000Z",
      "config.config.exclude_archived": false,
      "config.config.join_public_channels": true,
      "config.config.private_channels": true,
    },
    expectedOutput: {
      sourceId: "jitsu_slack",
      schedule: "@hourly",
      config: {
        tap: "tap-slack",
        config: {
          token: "hidden_asdfasfd35425fs",
          start_date: "1917-07-01T00:00:00.000Z",
          exclude_archived: false,
          join_public_channels: true,
          private_channels: true,
        },
      },
    },
  },

  test_airbyte_postgres_source__config: {
    input: {
      sourceId: "airbyte-source-postgres",
      schedule: "@hourly",
      "config.docker_image": "source-postgres",
      "config.config.host": "hidden.hidden.florida-south-42.rds.amazonaws.com",
      "config.config.port": 8800,
      "config.config.database": "hidden_asdfe34521",
      "config.config.username": "hidden_342554dfdf",
      "config.config.password": "hidden_dgsdfg54663546345634t34563456",
      "config.config.ssl": true,
      "config.config.replication_method.method": "Standard",
      "config.config.tunnel_method.tunnel_method": "NO_TUNNEL",
    },
    expectedOutput: {
      sourceId: "airbyte-source-postgres",
      schedule: "@hourly",
      config: {
        docker_image: "source-postgres",
        config: {
          host: "hidden.hidden.florida-south-42.rds.amazonaws.com",
          port: 8800,
          database: "hidden_asdfe34521",
          username: "hidden_342554dfdf",
          password: "hidden_dgsdfg54663546345634t34563456",
          ssl: true,
          replication_method: {
            method: "Standard",
          },
          tunnel_method: {
            tunnel_method: "NO_TUNNEL",
          },
        },
      },
    },
  },

  // @Destinations

  test_bigquery_destination__config: {
    input: {
      $type: "BQConfig",
      "_formData.mode": "stream",
      "_formData.tableName": "some_table_name",
      "_formData.bqProjectId": "tracker-88005553535",
      "_formData.bqDataset": "integration_tests",
      "_formData.bqJSONKey":
        '{\n  "type": "some_type",\n  "project_id": "tracker-88005553535",\n  "private_key_id": "hidden_dfag345234jkAD3n$",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\sdflkjas;dlkgjdjf_sad\\asdfsadf\\loooooooong_private_key\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "tracker@tracker-88005553535.iam.example.com",\n  "client_id": "88005553535",\n  "auth_uri": "https://accounts.google.com/o/oauth2/auth",\n  "token_uri": "https://oauth2.googleapis.com/token",\n  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",\n  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/tracker%40tracker-88005553535.iam.example.com"\n}',
    },
    expectedOutput: {
      $type: "BQConfig",
      _formData: {
        mode: "stream",
        tableName: "some_table_name",
        bqProjectId: "tracker-88005553535",
        bqDataset: "integration_tests",
        bqJSONKey:
          '{\n  "type": "some_type",\n  "project_id": "tracker-88005553535",\n  "private_key_id": "hidden_dfag345234jkAD3n$",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\sdflkjas;dlkgjdjf_sad\\asdfsadf\\loooooooong_private_key\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "tracker@tracker-88005553535.iam.example.com",\n  "client_id": "88005553535",\n  "auth_uri": "https://accounts.google.com/o/oauth2/auth",\n  "token_uri": "https://oauth2.googleapis.com/token",\n  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",\n  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/tracker%40tracker-88005553535.iam.example.com"\n}',
      },
    },
  },

  test_snowflake_destination__config: {
    input: {
      "_formData.mode": "hidden",
      "_formData.tableName": "test_hidden_snowflake",
      "_formData.snowflakeAccount": "abc424242",
      "_formData.snowflakeWarehouse": "SOME_VALUE",
      "_formData.snowflakeDB": "SOME_DB_NAME",
      "_formData.snowflakeSchema": "HIDDEN",
      "_formData.snowflakeUsername": "hidden_user_name",
      "_formData.snowflakePassword": "password",
      "_formData.snowflakeStageType": "no_target",
      "_formData.snowflakeJSONKey": '""',
      "_formData.snowflakeS3Region": "by-south-42",
    },
    expectedOutput: {
      _formData: {
        mode: "hidden",
        tableName: "test_hidden_snowflake",
        snowflakeAccount: "abc424242",
        snowflakeWarehouse: "SOME_VALUE",
        snowflakeDB: "SOME_DB_NAME",
        snowflakeSchema: "HIDDEN",
        snowflakeUsername: "hidden_user_name",
        snowflakePassword: "password",
        snowflakeStageType: "no_target",
        snowflakeJSONKey: '""',
        snowflakeS3Region: "by-south-42",
      },
    },
  },
}

describe("makeObjectFromFieldsValues works as expected", () => {
  Object.entries(form_marshalling_test_data).forEach(([name, { input, expectedOutput }]) => {
    it(`maps ${name} as expected`, () => {
      expect(makeObjectFromFieldsValues(input)).toEqual(expectedOutput)
    })
  })
})
