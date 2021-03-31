import {APIParam, APIMethod} from "../../../components/documentationComponents";
import {Hint} from "../../../components/documentationComponents";

# Sources Configuration

### Sources

Sources are used to import data from platforms API (Google Analytics, Facebook, etc) or databases (redis, firebase, etc) into [destinations](/docs/destinations-configuration).
Specific data can be stored into your data warehouse for analytics or other needs.

### Collections

As the source may contain inhomogeneous data, it may be split into multiple `collections`. Each collection represents some subset of data that would be stored to the same structure within the destination (in the case of SQL database, this is a table).

Collections may be static or configurable. For instance, **Firebase** collections are static while **Google Analytics** report is parametrized (**Google Analytics** has `dimensions` and `metrics`).

Full description of the collection:

```yaml
collections:
  - name: "some_name"
    type: "collection_type_id"
    table_name: "table_name_for_data"
    start_date: "2020-06-01"
    schedule: '@daily' #cron expression. see below
    parameters:
      field1: "value"
      field2: ["values"]
      field3: 
        some_object:
      ...
```

| Parameter | Description |
| :--- | :--- |
| `name` (required)  | is a unique identifier of collection within a list of collections |
| `type`  | determines which data subset must be synchronized. If type absents, type equals to `name` parameter |
| `table_name` | name of the table to keep synchronized data. If not set, equals to the name of collection |
| `start_date` | start date string of data to download in `YYYY-MM-DD` format. Default values is `365` days ago |
| `schedule` (available in beta)| [cron expression](https://en.wikipedia.org/wiki/Cron) automatic collection synchronization schedule. If not set - only manual collection synchronization(by HTTP API) will be available |
| `parameters` | if the collection is parametrized, parameter values are set here. A value may be of any type (`string`, `number`, `boolean`, `list`, `object`) |

If the collection has no parameters, it may be configured only by its name as a string argument. For example:

```yaml
collections: ["collection1_id", "collection2_id"]
```

### Configuration

<Hint>
    This feature requires:
    <li><code inline="true">meta.storage</code> <a href="/docs/configuration">configuration</a></li>
    <li><code inline="true">primary_key_fields</code> <a href="/docs/configuration/primary-keys-configuration">configuration</a> (in Postgres destination case)</li>
</Hint>

Example of source configuration:

```yaml
sources:
  firebase_example_id:
    type: firebase
    destinations:
      - "<DESTINATION_ID>"
    collections:
      - "<FIRESTORE_COLLECTION_ID>"
    config:
      project_id: "<FIREBASE_PROJECT_ID>"
      key: '<GOOGLE_SERVICE_ACCOUNT_KEY_JSON>'
  google_analytics_example_id:
    type: google_analytics
    destinations:
      - "<DESTINATION_ID>"
    collections:
      - name: "report_test"
        type: "report"
        schedule: '45 23 * * 6'
        parameters:
          dimensions:
            - "ga:country"
            - "ga:yearMonth"
          metrics:
            - "ga:sessions"
    config:
      view_id: "<VIEW_ID_VALUE>"
      auth:
        service_account_key: "<GOOGLE_SERVICE_ACCOUNT_KEY_JSON>"
  ...

```

Common yaml properties for all sources (**all yaml properties are required**):

| Property | Description |
| :--- | :--- |
| `type`  | determines the type of a data source from which data would be imported (like `google_analytics` or `firebase`) |
| `destinations`  | list of destination ids where result must be stored |
| `collections`  | list of collections to synchronize |
| `config` | custom parameters for each source type |

To see how to configure some type of source, please visit documentation pages for exact source types.

### Sync tasks (available at beta)

EventNative supports automatic collection synchronization as well as manual. For using automatic collection synchronization
there must be configured `schedule` property in the `collection` section of configuration (see above).

For using manual collection synchronization(HTTP API) there must be admin token configuration.

```yaml
server:
  admin_token: your_admin_token
  
sources:
  source_id:
    type: ...
    ...
```
<br/>

<APIMethod method="POST" path="/api/v1/tasks" title="Running sync task"/>

Since there can be only one task per source - collection pair in the task queue, EventNative returns ID of an existing task, or a new one.
(HTTP responses will have different HTTP codes - see example below)
Authorization admin token might be provided either as query parameter or HTTP header.

<h4>Parameters</h4>

<APIParam name={"source"} dataType="string" required={true} type="queryString" description="Source ID from 'sources' configuration section"/>
<APIParam name={"collection"} dataType="string" required={true} type="queryString" description="Collection name from 'sources' configuration section"/>
<APIParam name={"X-Admin-Token"} dataType="string" required={true} type="header" description="Admin token"/>
<APIParam name={"token"} dataType="string" required={true} type="queryString" description="Admin token"/>

<h4>Response</h4>

Task has been created:

```json
HTTP 201 Created

{
    "task_id": "$sourceId_$collectionName_$UUID"
}
```

Task already exists:

```json
HTTP 200 OK

{
    "task_id": "$sourceId_$collectionName_$UUID" #id of an existing task
}
```

<h4>Error Response</h4>

Source wasn't found:

```json
{
    "message": "Error getting source",
    "error": "Source [jitsu_firebase] doesn't exist"
}
```

<h4>Authorization Error Response</h4>

```json
{
    "message": "Admin token does not match"
}
```

<h4> CURL example</h4>

```bash
curl --location --request POST 'https://<your_server>/api/v1/tasks?source=<your_source_id>&collection=<your_collection_name>&token=<admin_token>'
```

<br/>

<APIMethod method="GET" path="/api/v1/tasks" title="Get all sync tasks"/>

Authorization admin token might be provided either as query parameter or HTTP header

<h4>Parameters</h4>

<APIParam name={"source"} dataType="string" required={true} type="queryString" description="Source ID from 'sources' configuration section"/>
<APIParam name={"collection"} dataType="string" required={false} type="queryString" description="Collection name from 'sources' configuration section. Default value: all collections"/>
<APIParam name={"start"} dataType="string" required={true} type="queryString" description="Start of time interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format" />
<APIParam name={"end"} dataType="string" required={true} type="queryString" description="End of time interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format" />
<APIParam name={"status"} dataType="string" required={false} type="queryString" description="Task status filter. Available values: [scheduled, running, failed, success]. Default value: all statuses" />
<APIParam name={"X-Admin-Token"} dataType="string" required={true} type="header" description="Admin token"/>
<APIParam name={"token"} dataType="string" required={true} type="queryString" description="Admin token"/>

<h4>Response</h4>

Sync tasks list

```json
{
    "tasks": [
        {
            "id": "$sourceId_$collectionName_$UUID",
            "source": "$sourceId",
            "collection": "$collectionName",
            "priority": 299998384585588,
            "created_at": "2021-03-10T22:13:32.433956Z",
            "started_at": "2021-03-10T22:13:32.567439Z",
            "finished_at": "2021-03-10T22:13:34.116187Z",
            "status": "SUCCESS"
        },
        {
            "id": "$sourceId_$collectionName_$UUID",
            "source": "$sourceId",
            "collection": "$collectionName",
            "priority": 299998384585588,
            "created_at": "2021-03-11T00:13:32.433956Z",
            "started_at": "2021-03-11T00:13:32.567439Z",
            "status": "RUNNING"
        }
    ]
}
```

<h4>Error Response</h4>

Source wasn't found:

```json
{
    "message": "Error getting source",
    "error": "Source [jitsu_firebase_auth_uses] doesn't exist"
}
```

<h4>Authorization Error Response</h4>

```json
{
    "message": "Admin token does not match"
}
```

<h4> CURL example</h4>

```bash
curl -X GET 'https://<your_server>/api/v1/tasks?source=<your_source_id>&token=<admin_token>&start=2020-01-01T00:00:00Z&end=2024-12-31T23:59:59Z'
```

<br/>

<APIMethod method="GET" path="/api/v1/tasks/:taskId" title="Get sync task by ID"/>

Authorization admin token might be provided either as query parameter or HTTP header

<h4>Parameters</h4>

<APIParam name={"taskId"} dataType="string" required={true} type="pathParam" description="Task ID"/>
<APIParam name={"X-Admin-Token"} dataType="string" required={true} type="header" description="Admin token"/>
<APIParam name={"token"} dataType="string" required={true} type="queryString" description="Admin token"/>

<h4>Response</h4>

Sync task payload

```json
{
    "id": "$sourceId_$collectionName_$UUID",
    "source": "$sourceId",
    "collection": "$collectionName",
    "priority": 299998384583699,
    "created_at": "2021-03-10T22:45:01.512528Z",
    "status": "SCHEDULED"
}
```

<h4>Error Response</h4>

Source wasn't found:

```json
{
    "message": "Error getting source",
    "error": "Source [jitsu_firebase_auth_uses] doesn't exist"
}
```

<h4>Authorization Error Response</h4>

```json
{
    "message": "Admin token does not match"
}
```

<h4> CURL example</h4>

```bash
curl -X GET 'https://<your_server>/api/v1/tasks/<your_task_id>?token=<admin_token>'
```

<br/>

<APIMethod method="GET" path="/api/v1/tasks/:taskId/logs" title="Get sync task logs"/>

Authorization admin token might be provided either as query parameter or HTTP header

<h4>Parameters</h4>

<APIParam name={"taskId"} dataType="string" required={true} type="pathParam" description="Task ID"/>
<APIParam name={"start"} dataType="string" required={false} type="queryString" description="Start of time interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format. Default value: Unix start epoch (1970-01-01..)" />
<APIParam name={"end"} dataType="string" required={false} type="queryString" description="End of time interval in ISO 8601 ('2006-01-02T15:04:05.000000Z') format. Default value: time.Now() UTC" />
<APIParam name={"X-Admin-Token"} dataType="string" required={true} type="header" description="Admin token"/>
<APIParam name={"token"} dataType="string" required={true} type="queryString" description="Admin token"/>

<h4>Response</h4>

Sync task log messages

```json
{
    "logs": [
        {
            "time": "2021-03-10T22:45:02.578999Z",
            "message": "[$sourceId_$collectionName_$UUID] Running task...",
            "level": "info"
        },
        {
            "time": "2021-03-10T22:45:02.588929Z",
            "message": "[$sourceId_$collectionName_$UUID] Total intervals: [1]",
            "level": "info"
        },
        {
            "time": "2021-03-10T22:45:03.870479Z",
            "message": "[$sourceId_$collectionName_$UUID] FINISHED SUCCESSFULLY in [1.28] seconds (~ 0.02 minutes)",
            "level": "info"
        }
    ]
}
```

<h4>Error Response</h4>

Source wasn't found:

```json
{
    "message": "Error getting source",
    "error": "Source [jitsu_firebase_auth_uses] doesn't exist"
}
```

<h4>Authorization Error Response</h4>

```json
{
    "message": "Admin token does not match"
}
```

<h4> CURL example</h4>

```bash
curl -X GET 'https://<your_server>/api/v1/tasks/<your_task_id>/logs?token=<admin_token>'
```

### How it works

Data may be synchronized by time chunks (if data source supports data loading by time intervals) or all data is loaded together. This depends on the type of data source and defined at driver implementation (an entity that loads data). EventNative stores information about synchronized chunks at `meta storage` (meta storage configuration is described at [General Configuration](/docs/configuration)). Time chunk is synchronized if

* it is not synchronized yet
* time chunk covers the current moment
* time chunk covers the previous period to the current one (in case some data is loaded after the period ends)

The result of synchronization is a replica of data from the data source with some enriched fields. 

* `eventn_ctx_collection_id` contains the type of collection (see documentation on collections [below](/docs/sources-configuration#collections))
* `eventn_ctx_event_id` a hash of the synchronized object
* `eventn_ctx_time_interval` field stores information about what synchronization interval
* `eventn_ctx_interval_start` field stores information about start of synchronization interval
* `eventn_ctx_interval_end` field stores information about the end of synchronization interval