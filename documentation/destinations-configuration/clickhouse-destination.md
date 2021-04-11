import {Hint} from "../../../components/documentationComponents";

# ClickHouse

**EventNative** supports [ClickHouse](https://clickhouse.tech/) as a destination. For more information about
ClickHouse [see docs](https://clickhouse.tech/docs/en/).

## Configuration

ClickHouse destination config consists of following schema:

```yaml
destinations:
  clickhouse_1:
    type: clickhouse
    clickhouse:
      dsns:
        - "https://username:password@host1:8443/mydb?read_timeout=5m&timeout=5m&enable_http_compression=1&tls_config=maincert"
        - "https://username:password@host2:8443/mydb?read_timeout=5m&timeout=5m&enable_http_compression=1&tls_config=maincert"
        - "https://username:password@host3:8443/mydb?read_timeout=5m&timeout=5m&enable_http_compression=1&tls_config=maincert"
      db: mydb
      cluster: mycluster
      engine:
        raw_statement: 'ENGINE = ReplacingMergeTree(_timestamp) ORDER BY (eventn_ctx_event_id)' #optional
        nullable_fields:
          - middle_name
          - event_description
        partition_fields:
          - function: toYYYYMMDD
            field: _timestamp
          - field: event_type
        order_fields:
          - function: intHash32
            field: id
        primary_keys:
          - eventn_ctx_event_id
      tls:
        maincert: path_to_crt_file
```

## Fields

| Field \(\*required\) | Type | Description | Default value |
| :--- | :--- | :--- | :--- |
| **dsns\*** | string array | Array of connection strings. Must contain at least one connection string. | - |
| **db\*** | string | Database name. | - |
| **cluster\*** | string | Required. Run `SELECT * from system.clusters` to get  the list of all available clustes | - |
| **engine** | object | Tables engine configuration.  | see below |
| **tls**  | object | TLS configuration. Map of cert names and paths to cert files. Cert names will be used in **tls\_config** query parameter in dsns. | - |

If **engine** wasn't provided default one \(depends on cluster configuration\) will be used:

```yaml
#if ClickHouse single server (dsns = 1)
ReplacingMergeTree(_timestamp) PARTITION BY toYYYYMM(_timestamp) ORDER BY (eventn_ctx_event_id) 

#if ClickHouse cluster (dsns > 1)
ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/$db/$tablename', '{replica}', _timestamp) PARTITION BY toYYYYMM(_timestamp) ORDER BY (eventn_ctx_event_id) 
```


## Engine

<table>
  <thead>
    <tr>
      <th>Field (*required)</th>
      <th>Type</th>
      <th>Description</th>
      <th>Default value</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>raw_statement</b>
      </td>
      <td>string</td>
      <td>
          Engine raw statement which will be used in
        <p>CREATE TABLE db.name (a type,b type) $raw_statement.</p>
        <p>Must begin with &apos;ENGINE=&apos;. Could include ORDER BY, PARTITION
          BY, etc.</p>
      </td>
      <td>-</td>
    </tr>
    <tr>
      <td><b>nullable_fields</b>
      </td>
      <td>string array</td>
      <td>Array of nullable fields. All fields are created as non-null by default.</td>
      <td>-</td>
    </tr>
    <tr>
      <td><b>partition_fields</b>
      </td>
      <td>field object array</td>
      <td>Array of <b>field</b>  <b>objects</b> will be used in PARTITION BY ($partition_fields)
        statement</td>
      <td><code inline={true}>toYYYYMM(_timestamp)</code>
      </td>
    </tr>
    <tr>
      <td><b>order_fields</b>
      </td>
      <td>field object array</td>
      <td>Array of <b>field</b>  <b>objects</b> will be used in ORDER BY ($order_fields)
        statement</td>
      <td><code inline={true}>eventn_ctx_event_id</code>
      </td>
    </tr>
    <tr>
      <td><b>primary_keys</b>
      </td>
      <td>string array</td>
      <td>Array of field names will be used in PRIMARY KEY ($primary_keys) statement</td>
      <td
     >-</td>
    </tr>
  </tbody>
</table>

<Hint>
Please note, if <b>raw_statement</b> exists than config keys <b>partition_fields</b>, <b>order_fields</b>,
<b>primary_keys</b> will be skipped.
</Hint>

## Field object

| Field \(\*required\) | Type | Description | Default value |
| :--- | :--- | :--- | :--- |
| **function** | string | ClickHouse function name which will be applied to the field \(e.g. toYYYYMMDD, intHash32\) | - |
| **field\*** | string | Field name | - |

