# EventNative Diagnostics

## Context and scope

This document describes the design of _diagnostics service_. This service
is responsible for answering to "What's going on now?" question: number and types of 
error, last events and so on.

## Interface

The service accepts events at different stages of [pipeline](pipeline.md) (see types in [pipeline.proto](proto/pipeline.proto)).

|Event Type                          | When                       |
|----------                          | ---                        |
|{Raw JSON, destination}             | Right after multiplexing   |
|{EventError, destination}           |                            |
|{InsertFailed, destination}         |                            |


## Internal storage

EventNative uses Redis as an internal storage for counting success and failed events per destination as well as
for caching last N events (Raw JSON, Mapped JSON with SQL types and errors if occurred). 

### Counters

Counters are stored as Redis hash tables with day and hour granularity. They have following keys structure:
```
daily_events:destination#${destination_id}:month#${YYYYMM}:success
daily_events:destination#${destination_id}:month#${YYYYMM}:errors

hourly_events:destination#${destination_id}:day#${YYYYMMDD}:success
hourly_events:destination#${destination_id}:day#${YYYYMMDD}:errors
```

Where `${destination_id}` is your destination id from the config.

### Cached events

Last N events are stored as Redis hash tables with `original`, `success`, `error` fields and events ids are stored in index. 
They have following keys structure:

```
last_events_index:destination#${destination_id}

last_events:destination#${destination_id}:id#${event_id}
```

Index is a Redis sorted set of eventIds sorted by timestamps.

Quantity of last events is managed by the index with the following pipeline:
  * Once an event is received EventNative checks the index size: 
    * If > N than remove 1 event from the index and from Redis than write a new one
    * Otherwise, write the event to index and to `original` field
  * Once an event is successfully mapped and stored into the destination write it with SQL types to `success` field
  * If error is occurred write error text to `error` field


## Diagnostics API

GET http://instance/api/v1/events/cache?token=a123&destination_ids=id1,id2

token: admin authorization token
destination_ids: comma-separated list of destination ids (required at least one)

```json
{
  "total_events": 95,
  "response_events": 2,
  "events": [
    {
      "original": {
        "api_key": "api_secret",
        "event_type": "pageview",
        "eventn_ctx": {}
      },
      "error": "error msg"
    },
    {
      "original": {
        "api_key": "api_secret",
        "event_type": "pageview",
        "eventn_ctx": {}
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
          }
        ]
      }
    }
  ]
}  
```
