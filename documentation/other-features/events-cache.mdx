import {APIMethod, APIParam, Hint} from "../../../components/documentationComponents";

# Events Cache

**EventNative** supports caching last events in storage \(currently only Redis is supported\). All income events will be stored in meta storage as well as processed events with DB data types and errors if occurred. Default cache size is **100** events per destination. It is configured in `server.cache.events.size`.

<Hint>
This feature requires meta.storage configuration.
</Hint>

```yaml
server:
...

destinations:
...

meta:
  storage:
    redis:
      host: redis_host
      port: 6379
      password: secret_password
```

### **Endpoint**

**EventNative** has an endpoint that return last events from cache. Last event structure:

| Field | Type | Description |
| :--- | :--- | :--- |
| **original** | json object | Raw event. |
| **success** | json object | Successfully processed event \(after enrichments, flattening, mappings, typecasting\). Contains **destination\_id**_,_ **table\_name**, and array of **fields** where every field contains **name**, **type**, **value.** |
| **error** | string | Error if occurred. |

<APIMethod method="GET" path="/api/v1/events/cache" />

Method returns last events per destination in time interval with limit

<APIParam dataType="string" required={true} type="header" name="X-Admin-Token" description={<>Admin token authorization (read more about <a href="/docs/other-features/admin-endpoints">admin auth</a>)</>} />

<APIParam dataType="integer" required={false} type="queryString" name="limit" description={<>Limit per destination</>} />

<APIParam dataType="string" required={false} type="queryString" name="destination_ids" description="Comma-separated destination ids array" />

<APIParam dataType="string" required={false} type="queryString" name="start" description="start of interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format. Default value: Unix start epoch (1970-01-01..)" />

<APIParam dataType="string" required={false} type="queryString" name="end" description="end of interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format. Default value: time.Now() UTC" />


### Response

Return last events with DB schema and errors

```yaml
{
  "total_events": 95,
  "response_events": 2,
  "events": [
    {
      "original": {
        "api_key": "api_secret",
        "event_type": "pageview",
        "eventn_ctx": {
          "click_id": {},
          "event_id": "dna3b213b",
          "ids": {},
          "local_tz_offset": "0",
          "page_title": "Jitsu: Open-source data integration and event collection",
          "referer": "https://referer-site.com/",
          "url": "https://jitsu.com/",
          "user": {
            "anonymous_id": "enoq4o12"
          },
          "user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0",
          "utc_time": "2020-11-30T21:48:12.754000Z",
          "utm": {}
        },
        "eventn_data": {},
        "src": "eventn"
      },
      "error": "Unsupported column [local_tz_offset] type changing from: INT64 to: STRING"
    },
    {
      "original": {
        "api_key": "api_secret",
        "event_type": "pageview",
        "eventn_ctx": {
          "click_id": {},
          "event_id": "213ndisand",
          "ids": {},
          "local_tz_offset": 0,
          "page_title": "Jitsu: Open-source data integration and event collection",
          "referer": "https://referer-site.com/",
          "url": "https://jitsu.com/",
          "user": {
            "anonymous_id": "dano2131"
          },
          "user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0",
          "utc_time": "2020-11-30T21:48:12.754000Z",
          "utm": {}
        },
        "eventn_data": {},
        "src": "eventn"
      },
      "success": {
        "destination_id": "my_destination",
        "table": "jitsu_events",
        "record": [
          {
            "field": "eventn_ctx_utc_time",
            "type": "timestamp",
            "value": "2020-11-30T21:48:12.754000Z"
          },
          {
            "field": "eventn_ctx_user_anonymous_id",
            "type": "character varying(8192)",
            "value": "dano2131"
          },
          {
            "field": "eventn_ctx_page_title",
            "type": "character varying(8192)",
            "value": "Jitsu: Open-source data integration and event collection"
          },
          {
            "field": "eventn_ctx_location_latitude",
            "type": "numeric(38,18)",
            "value": "50.8757"
          },
          {
            "field": "eventn_ctx_location_city",
            "type": "character varying(8192)",
            "value": "Verwood"
          },
          {
            "field": "_timestamp",
            "type": "timestamp",
            "value": "2020-11-30T21:48:13.609858Z"
          },
          {
            "field": "eventn_ctx_parsed_ua_ua_family",
            "type": "character varying(8192)",
            "value": "Firefox"
          },
          {
            "field": "eventn_ctx_parsed_ua_ua_version",
            "type": "character varying(8192)",
            "value": "78.0."
          },
          {
            "field": "eventn_ctx_parsed_ua_os_family",
            "type": "character varying(8192)",
            "value": "Linux"
          },
          {
            "field": "eventn_ctx_event_id",
            "type": "character varying(8192)",
            "value": "213ndisand"
          },
          {
            "field": "eventn_ctx_referer",
            "type": "character varying(8192)",
            "value": "https://referer-site.com/"
          },
          {
            "field": "eventn_ctx_location_zip",
            "type": "character varying(8192)",
            "value": "BH31"
          },
          {
            "field": "eventn_ctx_location_region",
            "type": "character varying(8192)",
            "value": "ENG"
          },
          {
            "field": "eventn_ctx_location_country",
            "type": "character varying(8192)",
            "value": "GB"
          },
          {
            "field": "src",
            "type": "character varying(8192)",
            "value": "eventn"
          },
          {
            "field": "event_type",
            "type": "character varying(8192)",
            "value": "pageview"
          },
          {
            "field": "eventn_ctx_local_tz_offset",
            "type": "bigint",
            "value": "0"
          },
          {
            "field": "eventn_ctx_user_agent",
            "type": "character varying(8192)",
            "value": "Mozilla/5.0 (X11; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0"
          },
          {
            "field": "eventn_ctx_url",
            "type": "character varying(8192)",
            "value": "https://jitsu.com/"
          },
          {
            "field": "source_ip",
            "type": "character varying(8192)",
            "value": "86.149.97.182"
          },
          {
            "field": "api_key",
            "type": "character varying(8192)",
            "value": "api_secret"
          },
          {
            "field": "eventn_ctx_location_longitude",
            "type": "numeric(38,18)",
            "value": "-1.8721"
          }
        ]
      }
    }
  ]
}
```
