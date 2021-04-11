import {LargeLink} from "../../../components/documentationComponents";

# Snowflake

**EventNative** supports [Snowflake](https://www.snowflake.com/) as a destination. For more information about
Snowflake [see docs](https://docs.snowflake.com).

## Configuration

Snowflake destination in batch mode can be configured via S3 or Google Cloud Storage. In the stream mode, it can be configured without any. The config consists of the following schema:

```yaml
destinations:
  my_snowflake_via_aws_s3_or_gcp:
    type: snowflake 
    snowflake:
      account: hha56552.us-east-1
      schema: MYSCHEMA
      warehouse: my_warehouse
      db: mydb
      username: user
      password: pass
      parameters:
        name: value
      stage: my_stage
# via s3        
    s3:
      access_key_id: ...
      secret_access_key: ...
      bucket: ...
      region: ...
# or via gcp
    google:
      gcs_bucket: ...
      key_file: ...
```

### snowflake section

| Field \(\*required\) | Type | Description | Default value |
| :--- | :--- | :--- | :--- |
| **account\*** | string | Snowflake global account. | - |
| **port** | int | Port of destination. | `443` |
| **db\*** | string | Database of destination. | - |
| **schema** | string | Schema of destination. | `public` |
| **username\*** | string | Username for authorization in a destination. | - |
| **password** | string | Password for authorization in a destination. | - |
| **warehouse\*** | string | Snowflake warehouse name. |  |
| **parameters** | object | Connection parameters. | `client_session_keep_alive=true` |
| **stage\*\*** | string | Name of [Snowflake stage](https://docs.snowflake.com/en/user-guide/data-load-local-file-system-create-stage.html). It is required in **batch** mode. | - |

### s3 or google sections

See corresponding page

<LargeLink href="/docs/destinations-configuration/s3" title="S3 configuration" />
<LargeLink href="/docs/destinations-configuration/bigquery" title="Google (GCS) configuration" />
