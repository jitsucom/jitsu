# EventNative Data Pipeline

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
   * For every record: apply LookupEnrichment step
   * Multiplex records to destinations
   * For each destination: evaluate `table_name_template` expression to get a destination table name. If result 
   is empty string, skip this destination. If evaluation failed, event is written to `events/failed`
   * For each destination/table pair:
      * Check status in status file of log (see DestinationStatus). If pair has been processed, ignore it
      * Apply LookupEnrichment step  
      * Apply MappingStep (get TypedRecord)
      * Maintain up-to date BatchHeader in memory. If new field appears in TypedRecord, add it to BatchHeader
      * On type conflict: apply type promotion. If conflict types have common ancestor, change the type in BatchHeader to it. Otherwise, skip record
      and write it to `events/failed`
      * Write TypedRecord to corresponding batch file (on local disk or cloud storage - depending on a destination)
   * Once batch file is prepared, proceed to **table patching**. For each destination/table pair:
      * Get table structure
      * Acquire destination lock (using distributed lock service)
      * Compare table structure with batch header
      * If column is missing, run ALTER TABLE
      * If column is present, but type is not the same (_ignore_ so far, run type promotion in next version)
      * If column is present in the table, but missing in BatchHeader - ignore
      * Release destination lock
  * For each batch file: bulk insert it to destination. On success update log status file see (DestinationStatus) and mark destination/table pair as OK (mark is as FAILED) otherwise. If all pairs are marked as OK, rotate log file
  to `events/archive`
      
## Stream processing

* Apply mutliplexing, put each multiplexed event to destination queue. Queue items are persisted in
`events/queue.dst=${destination_id}` dir.
* Separate thread processes each queue. For each event:
  * Run `table_name_template expression`. If result is empty skip this event otherwise construct BatchHeader. If evaluation failed, event is written to `events/failed`
  * Apply LookupEnrichment step to event  
  * Apply MappingStep (get TypedRecord)
  * Merge TypedRecord into BatchHeader (add field types)
  * Get table schema from memory (if memory cache is missing, get schema from DWH)
  * Do **table patching** (see above in batch step)
  * Insert TypedRecord using INSERT statement.
  * If INSERT failed, refresh schema from DB and repeat the step
  * If failed, write the record to `events/failed`
    


## Pipeline steps

### ContextEnrichment step
  
 * Get IP from where request came from
 * If request is processed by JavaScript endpoint - read user agent-header, content-type header and so on
 * If request is processed by Server API - Add /src field
 * Add UTC timestamp (/_timestamp field)
 * etc

### LookupEnrichment step

During this step Enrichment rules are applied. Enrichment rule is a function F(src_node) → dst_node. So far
we support two of them:
 * **IP Lookup** - src_node should be a string node where rule is expected to see IP address. Result node is 
 an object with geo data (country, city, etc)
 * **User Agent Parser** - src_node should be a string node where rule is expected to see user agent string. Result node is 
 an object parsed user agent: vendor, version, etc
 

### Mapping step

During this step JSON object is transformed into a TypedRecord. 

Mapping can configured with YML descriptor (see meaning of config parameters as comments)

```yaml
mapping:
  keep_unmapped: true # if fields that are not explicitly mapped should be kept or removed
  fields:
    - src: /src/field/path # JSON path
      dst: /dst/field/path # could be just_field_name, without leading. Before inserting all / (except
      # first one) will be replaced wth '_'
      action: move | remove | cast #  
      type: Lowcardinality(String) # for 'move' (optional) and 'cast' (required) actions - SQL type (depend on destination)
```
Following field actions are supported:

* **move** — move JSON subtree to another node. 
* **remove** - remove JSON subtree (dst param is not needed)
* **cast** – assign an explicit type to a node (dst param is not needed)

After all mappings are applied, JSON is flattened

#### Implicit type cast

If some fields has not been casted explicitly, casting is done based on JSON node type:
 * **string** is casted to TEXT
 * **double** is casted to DOUBLE PRECISION
 * **integer** is casted to BIGINT
 * **boolean** is casted to BOOLEAN
 * **array** is casted to JSON
 
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
| `events/incoming`    | Incoming events (batch mode only)  | Original JSON after ContextEnrichment step | `incoming.tok=${tok}\|id=${uid}.log` where {tok} is used API token id |
| `events/incoming`<br>(status files)    |Status of each batch: to which destinations and tables data has been sent succesfully  | DestinationStatus JSON | `incoming.tok=${tok}\|id=${uid}.log.status` |
| `events/archive`     | Events that has been already processed  | Original JSON after ContextEnrichment step | `yyyy-mm-dd/tok=${tok}\|${uid}.log` where {tok} is used API token id |
| `events/batches`    | Batches files: collection of TypedRecord after multiplexing and before sending to destination. Only for some destinations which do batch load from local disk (for others same files will be kept on cloud storage). Each file is a function of (BatchHeader, TypedRecord[])  |Specific to destination, usually CSV or JSON| `batch.dst={destination_id}.table={table}.log` where {tok} is used API token id |
| `events/failed`    | Events that haven't been saved to destination due to error   | Collection of EventError (see .proto file): original JSON (after ContextEnrichment step) wrapped with EventError structure | `batch.dst=${destination_id}.log`  |
| `events/queue.dst=${destination_id}`    | Streaming mode only: persistence for event queue   | Binary  | `${partition_number}.dque` and `lock.lock`  |

## Internal data structures

Internal data structures referenced here and above are described in `proto/pipeline.proto` as protobuf3 spec. The spec
and the code acts as  documentation. See the list of all data strucutures:
 * **TypedRecord** - Represents a record which has been already mapped and ready to be insert to SQL. Usually paired with **BatchHeader**
 * **BatchHeader** - describes a structure of batch: fields and types along with destination id and table
 * **EventError** - event that failed to be sent to destination: original JSON (after ContextEnrichment step) with error descriptiom


