# Reverse ETL through MCP

Models use the existing resource tools with `type: "model"`; use
`get_resource_schema` to inspect their configuration. Warehouse and destination
credentials remain in saved destination resources.

A typical workflow:

1. Choose a workspace with `list_workspaces`, then list its models and destinations
   with `list_resources`.
2. Inspect a saved model with `get_model_columns`, or preview a query with
   `preview_model`. Preview returns up to 100 source rows; column inspection does
   not return row values. Both require edit permission and have a 30-second timeout.
3. Call `get_reverse_sync_schema` to discover destinations and streams. Supply a
   destination type, stream ID and current options to see conditional requirements,
   required alternatives and object-composition properties. Map fields to column
   names using `mapping`, or compose supported objects using `objectMappings`.
4. Call `create_reverse_sync` with a new UUID `requestId` and
   `sync: { fromId: modelId, toId: destinationId, data: options }`. Set
   `data.disabled: true` to save paused. Reuse the UUID only to retry the same
   creation. Creating an enabled scheduled sync allows automatic execution.
5. Use `update_reverse_sync` to enable it, then `run_reverse_sync` for an immediate
   run. Updates accept either a complete configuration or partial scheduling/pause
   settings. The same saved-state protections as the console UI apply.
6. Use `list_reverse_sync_tasks` for task status, delivery statistics, latest log
   level and `canRefresh`; use `get_reverse_sync_logs` for diagnostic logs.
   Refresh and logs take the logical task ID, not an attempt ID.
7. `refresh_reverse_sync` reconciles an existing task, appending to its logs. It
   can resume unfinished submissions or mirror cleanup. It does not extract a new
   model snapshot. After an ambiguous controller error, inspect tasks before
   retrying; the original request may have succeeded.
8. To remove a sync, pause it with `update_reverse_sync`, cancel active/pending
   tasks with `cancel_reverse_sync`, wait for them to stop, then use
   `delete_reverse_sync`. Deletion retains state and task history and does not
   delete the destination audience.

Task queries return at most 100 records; use time filters to narrow history. Logs
return at most 500 lines, newest first, across the logical task's attempts.
`PENDING` also matches legacy `WAITING`, and `COMPLETE` matches legacy `SUCCESS`.

The shared `ReverseEtlService` backs both HTTP and MCP. It preserves workspace
permissions, validation, audit provenance, provisioning and controller admission.
Maintenance/read-only mode blocks MCP mutations and warehouse probes. These tools
need only a console deployment; no new database schema or runner deployment is
required.
