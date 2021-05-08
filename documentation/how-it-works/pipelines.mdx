# Pipelines

As it was mentioned, **EventNative** supports two destination modes and data processing depends on them:

### Batch processing

* First, an event is being written in `events/incoming` directory to the current log file
* Log files are being rotated once in N (=5 by default) minutes and processed in a separate thread
* Log files processing. Get all unprocessed logs (all files in `events/incoming` that not in process)
* * Multiplex records to destinations
  * For each destination: evaluate `table_name_template` expression to get a destination table name. If the result is an empty string, skip this destination. If evaluation failed, the event is written to `events/failed`
  * For each destination/table pair:
  * * Check status in the status file of the log. If a pair has been processed, ignore it
    * Apply LookupEnrichment step 
    * Apply MappingStep (get BatchHeader)
    * Maintain up-to date BatchHeader in memory. If a new field appears add it with type to BatchHeader
    * On type conflict: apply [Type Promotion](/docs/other-features/typecast#from-input-data)
  * Once batch objects and BatchHeader are prepared, proceed to **table patching**. For each destination/table pair:
  * * Map BatchHeader into Table structure with SQL column types depends on the destination type and [primary keys](/docs/configuration/primary-keys-configuration) (if configured)
    * Get Table structure from the destination
    * Acquire destination lock ([using distributed lock service](/docs/other-features/scaling-eventnative#coordination))
    * Compare two Table structures (from the destination and from data)
    * Maintain [primary key](/docs/configuration/primary-keys-configuration) (if configured)
    * If a column is missing run ALTER TABLE
    * If a column is present in the table, but missing in BatchHeader - ignore
    * Release destination lock
  * Depend on a destination bulk insert objects to destination with explicit [typecast](/docs/other-features/typecast) (if it is configured in [mapping section](/docs/configuration/schema-and-mappings#configuration)) or write them with json/csv serialization to cloud storage and execute destination load command
  * On success update log status file and mark destination/table pair as OK (mark is as FAILED) otherwise. If all pairs are marked as OK, rotate the log file to `events/archive`

### Stream processing

* Apply multiplexing, put each multiplexed event to the destination queue. Queue items are persisted in `events/queue.dst=${destination_id}` dir.
* Separate thread processes each queue. For each event:
* * Run `table_name_template` expression. If the result is an empty string - skip. If evaluation failed, the event is written to `events/failed`
  * Apply LookupEnrichment step  
  * Apply MappingStep (get BatchHeader)
  * Get Table structure from memory (if memory cache is missing, get the schema from DWH)
  * Do **table patching** (see above in batch step)
  * Insert object with explicit typecast (if it is configured in the [mapping section](/docs/configuration/schema-and-mappings)) using INSERT statement.
  * If INSERT failed, refresh schema from DWH and repeat the step
  * If failed, write the record to `events/failed`
  * If success, write the event to `events/archive`