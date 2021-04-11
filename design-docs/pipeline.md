# Jitsu Data Pipeline

## Context and scope

This document describes a design of EventNative data processing pipeline. The text is written in _present
tense_ since it will be base of documentation section on docs.eventnative.org once implementation is
completed.

### Collateral materials

* Please, see a collateral design picture at `pipeline.fig` (designed in Figma) to understand
the context. Without the pictured the design doc might be incomprehensible.
* Data structures can be found in `proto/pipeline.proto` files.

## Definitions

* **Event** — an incoming message as JSON object. Message can be sent to EventNative via API or JavaScript library
* **Destination** — usually a database, but can be different type service as well. Destination is a service that
contains structured records and supports an INSERT-like statement. [Google analytics measurment protocol](https://developers.google.com/analytics/devguides/collection/protocol/v1)
is an example of non-DB destination. It has structured records (events) and INSERT-like inteface
* **Table** — a table in DB or any other structure within destination

## Destination modes

EventNative's destination can operate in two modes:

 * **Stream** — data (events) is being sent to destination as soon as possible
 * **Batch** — data is being written to local disk and sent to destination in batches, once in N (configurable)
 minutes

## Processing pipeline

Once event is accepted by HTTP end-point it undergoes **ContextEnrichment** step. The logic is different for different
sources of event. The purpose of this event is to add addition information to event which can be useful for further processing (see
[detailed description of the step below](#ContextEnrichment-step) ).

After JSON is enriched it goes to Batch or/and Stream pipeline depending on destination type. Partially
multiplexing happens here. If destinations config contains destination of both types, event will be sent to both routes.
Also `only_keys` filtering is applied.

Batch and Stream pipelines are different, however they have same logical steps. See detailed description in [Pipeline steps section](#pipeline-steps)

## Batch processing

 * First, event is being written in `events/incoming` directory to current log file.
 * Log files are being rotated once in N (=5 by default) minutes and processed in a separate thread
 * Log files processing. Get all unprocessed logs (all files in `events/incoming` that not in process)
   * Multiplex records to destinations
   * For each destination: evaluate `table_name_template` expression to get a destination table name. If result
   is empty string, skip this destination. If evaluation failed, event is written to `events/failed`
   * For each destination/table pair:
      * Check status in status file of log (see DestinationStatus in pipeline.proto). If pair has been processed, ignore it
      * Apply LookupEnrichment step
      * Apply MappingStep (get BatchHeader)
      * Maintain up-to date BatchHeader in memory. If new field appears add it with type to BatchHeader
      * On type conflict: apply [Type Promotion](#type-promotion)
   * Once batch objects and BatchHeader are prepared, proceed to **table patching**. For each destination/table pair:
      * Map BatchHeader into Table structure with SQL column types depend on the destination type and primary keys (if configured).
      * Get Table structure from the destination
      * Acquire destination lock (using distributed lock service)
      * Compare two Table structures (from the destination and from data)
      * Maintain primary key (if configured)
      * If column is missing run ALTER TABLE
      * If column is present in the table, but missing in BatchHeader - ignore
      * Release destination lock

  * Depend on a destination bulk insert objects to destination with explicit typecast (if it is configured in mapping section) or write them with json/csv serialization to cloud storage and execute destination load command.
  * On success update log status file see (DestinationStatus) and mark destination/table pair as OK (mark is as FAILED) otherwise. If all pairs are marked as OK, rotate log file
  to `events/archive`

## Stream processing

* Apply mutliplexing, put each multiplexed event to destination queue. Queue items are persisted in
`events/queue.dst=${destination_id}` dir.
* Separate thread processes each queue. For each event:
  * Run `table_name_template expression`. If result is empty skip. If evaluation failed, event is written to `events/failed`
  * Apply LookupEnrichment step to event
  * Apply MappingStep (get BatchHeader)
  * Get Table structure from memory (if memory cache is missing, get schema from DWH)
  * Do **table patching** (see above in batch step)
  * Insert object with explicit typecast (if it is configured in mapping section) using INSERT statement.
  * If INSERT failed, refresh schema from DWH and repeat the step
  * If failed, write the record to `events/failed`
  * If success, write the event to `events/archive`



## Pipeline steps

### ContextEnrichment step

 * Add IP from where request came from (/source_ip field)
 * Add UTC timestamp (/_timestamp field)
 * Add API secret token (/api_key field)
 * If request is processed by JavaScript endpoint - read and add user-agent header (/eventn_ctx/user_agent field)
 * If request is processed by Server API - add 'api' value (/src field) and generated UUID (/eventn_ctx/event_id field)


### LookupEnrichment step

During this step Enrichment rules are applied. Enrichment rule is a function F(src_node) → dst_node. So far
we support two of them:
 * **IP Lookup** - src node `from` should be a string node where rule is expected to see IP address. Result node `to` is
 an object with geo data (country, city, etc)
 * **User Agent Parser** - src_node `from` should be a string node where rule is expected to see user agent string. Result node `to` is
 an object parsed user agent: vendor, version, etc

Two implicit Enrichment rules applied to all JavaScript events as well:
```yaml
 - name: ip_lookup
   from: /source_ip
   to: /eventn_ctx/location
 - name: user_agent_parse
   from: /eventn_ctx/user_agent
   to: /eventn_ctx/parsed_ua
```


### Mapping step

During this step BatchHeader is generated based on JSON object.

Mapping can configured with YML descriptor (see meaning of config parameters as comments)

```yaml
mappings:
  keep_unmapped: true # if fields that are not explicitly mapped should be kept or removed
  fields:
    - src: /src/field/path # JSON path
      dst: /dst/field/path # could be just_field_name, without leading. Before inserting all / (except
      # first one) will be replaced wth '_'
      action: move | remove | cast | constant
      type: Lowcardinality(String) # for 'move' (optional) and 'cast' (required) actions - SQL type (depend on destination)
      value: # Value for setting as constant to 'dst'. Required only for 'constant' action. Other actions will ignore this field.
```
Following field actions are supported:

* **move** — move JSON subtree to another node.
* **remove** - remove JSON subtree (dst param is not needed)
* **cast** – assign an explicit type to a node (dst param is not needed)
* **constant** – assign an explicit type to a node (src param is not needed)

After all mappings are applied, JSON is flattened, all special characters and spaces in field names are replaced with underscore

#### Implicit type cast

If some fields has not been casted explicitly, casting is done based on JSON node type depend on DWH:

|      DWH      | **string** |   **double**   | **integer** | **boolean** | **array** |
| ------------- | ---------- | -------------- | ----------- | ----------- | --------- |
|   Postgres    |    text    | numeric(38,18) |    bigint   |   boolean   |    text   |
|   Redshift    | character varying(65535) | numeric(38,18) |    bigint   |   boolean   |    character varying(65535)   |
|   BigQuery    |    string    | float |    integer   |   boolean   |    string   |
|   ClickHouse    |    String    | Float64 |    Int64   |   UInt8   |    String   |
|   Snowflake    |    text    | numeric(38,18) |    bigint   |   boolean   |    text   |

NOTE: Arrays are serialized in JSON string.

#### Type Promotion

Field can have several JSON node types in two objects in one batch. In this case Type promotion will be applied by finding the lowest common ancestor in the following typecast tree.
For example FLOAT64 and TIMESTAMP in the result will be STRING.
```
     Typecast tree
         STRING
         /    \
    FLOAT64  TIMESTAMP
       |
     INT64
       |
      BOOL
```

Also, if event has come from JavaScript API, following mapping is merged into configured one (configured mapping has priority)

```yaml
fields:
  - src: /eventn_ctx/utc_time
    action: cast
    type: TIMESTAMP
```

Following mapping is applied to any JSON

```yaml
fields:
  - src: /_timestamp
    action: cast
    type: TIMESTAMP
```

## Directory structure

EventNative keeps all data in configurable directory './events'. Here's the layout of sub-directories.

File naming convention. Files usually named as `${file_type}.${var1}=${val1}|${var2}=${val2}.${extention}`. The structure
is very similar to URL query string, but instead of `?` parameters are delimited by `|` and `.` is used instead of `?` (dots can't be a part of
`${file_type}`)

| Sub-dir              | Purpose                            | Data format                                | Filename pattern |
| -------------        | -------------                      |-------------                               | ---------------- |
| `events/incoming`    | Incoming events (batch mode only)  | Original JSON after ContextEnrichment step | `incoming.tok=${tok}.log` where {tok} is used API token id |
| `events/incoming`<br>(status files)    |Status of each batch: to which destinations and tables data has been sent succesfully  | DestinationStatus JSON | `incoming.tok=${tok}.log.status` |
| `events/archive`     | Events that has been already processed  | Original JSON after ContextEnrichment step | `yyyy-mm-dd/incoming.tok=${tok}-yyyy-mm-ddTHH-mm-ss.SSS.log.gz` or `yyyy-mm-dd/streaming-archive.dst=${destination_id}-yyyy-mm-ddTHH-mm-ss.SSS.log.gz` or `yyyy-mm-dd/failed.dst=${destination_id}-yyyy-mm-ddTHH-mm-ss.SSS.log.gz` depend on events from batch destination or stream destination or replaying failed events. Where {tok} is used API token id |
| `events/failed`    | Events that haven't been saved to destination due to error   | Collection of EventError (see .proto file): original JSON (after ContextEnrichment step) wrapped with EventError structure | `failed.dst=${destination_id}.log`  |
| `events/queue.dst=${destination_id}`    | Streaming mode only: persistence for event queue   | Binary  | `${partition_number}.dque` and `lock.lock`  |

## Internal data structures

Internal data structures referenced here and above are described in `proto/pipeline.proto` as protobuf3 spec. The spec
and the code acts as  documentation. See the list of all data structures:
 * **BatchHeader** - describes a structure of batch: fields and types along with table name
 * **Table** - describes a structure of DWH table: columns, sql types and primary keys along with table name
 * **EventError** - event that failed to be sent to destination: original JSON (after ContextEnrichment step) with error description


