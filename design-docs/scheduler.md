# Scheduler

This design document describes how the EventNative should execute periodic synchronization tasks (to pull data from API).

## Definitions

* **Collection** — see EventNative [documentation](https://docs.eventnative.org/configuration-1/sources-configuration#collections) 
* **Collection Synchronization Task (aka Task)**  — an atomic task that make sure that the collection is up-to-date. The task may call external resources (API). All tasks should be single-threaded
* **Task Log** — log that was written during execution of the task: all stdout output that was produced by synchronization thread. Log consists from log entries: `{time: "<utc_timestamp>", message: "<message>", level: "<level>"}` (log level `info` or `error`)
* **Task History** — a collection of tasks that has been created
* **Task Queue** — a queue of tasks that should be executed
* **Task Worker** — a thread that pulls tasks from the queue and executes it. Each EventNative node can have `16` task workers by default
* **UTC Timestamp** — if time is referenced as utc_timestamp, the format should be ISO

## Task Execution

Each task should be serializable to JSON and added to the queue (see Task Scheduling on how tasks are being added to queue). Task JSON structure:

```json
{
  "id": "<$sourceId_$collectionId_$UUID>",
  "source": "<source_id>",
  "collection": "<collection_id>",
  "priority": "positive number",
  "created_at": "<utc_timestamp>",
  "started_at": "<utc_timestamp or empty string if not started yet>",
  "finished_at": "<utc_timestamp or empty string if not finished yet>",
  "status": 'SCHEDULED' | 'RUNNING' | 'FAILED' | 'SUCCESS' 
}
```

Tasks should be kept in redis queue (redis type: `sorted set`, redis key: `sync_tasks_priority_queue`, redis score: `priority`, redis value: `task id`) with priorities. Priority is defined by uint64 `task_priority * 10^12 - created_at_unix` where `created_at_unix` is a `created_at` as unix epoch time (in seconds)

Each Task Worker on each EventNative node should be pulling tasks from the queue. Once task is pulled:

- Status should be set to **RUNNING**; `started_at` should be set to current time
- A separate thread should start an execution. Stdout should be listened and put to **Task Logs Collection**

## Task History

All information about tasks history should be kept in redis

* **Task History Collection**
  - Redis type: `sorted set`, redis key: `sync_tasks_index:source#$sourceId:collection#$collectionId`, redis score: `created_at_unix`, redis value: `task id`
  - Redis type: `hash table`, redis key: `sync_tasks#$taskId`, redis hash field: `task field name`, redis value: `task field value`

### Task Logs Collection

* **Task Logs** a collection of logs as task_id → [{time, message, level}]. Key is a task and value is a sorted set of {time, message, level} where time is score
    - Redis type: `sorted set`, redis key: `sync_tasks#$taskId:logs`, redis score: `time unix`, redis value: `{time, message, level}` json

## API calls

All API calls should be autentificated via standard [Admin authorization mechanism](https://docs.eventnative.org/other-features/admin-endpoints)

#### GET /tasks/${task_id}

Gets a task JSON (see above) 

#### GET /tasks/${task_id}/logs?start={utc_timestamp}&end={utc_timestamp}

Retrieves task logs as set of log entries `{"logs":[{time: "<utc_timestamp>", message: "<message>", level: "<level>"}]}`. Parameters:

* **task_id** (required) —  task id
* **start, end** (optional) — if set only logs entries within this period should be returned

#### GET /tasks?start={utc_timestamp}&end={utc_timestamp}&status={status}&source={}&collection={}

Retrieves tasks array `{"tasks":[{task1}, {task2}]}`. Task object structure see below. Parameters: 

* **source**, **start**, **end** are required
* **status** and **collection** are optional

By default, all tasks from all collections are returned

## Task Scheduling

Task scheduling can be done both automatically and manually. In both ways scheduling is merely constructing Task JSON and adding it to Task Execution queue.

### Manual Scheduling

Manual scheduling is done via `POST /tasks/?source={}&collection={}` response should return newrly created task id `{"task_id": "new_task_id_1"}` and `HTTP 201 Created`
or if requested source + collection have being already syncing return existing task id `{"task_id": "existing_task_id_1"}` and `HTTP 200 OK` 

### Automatic Scheduling

Automatic scheduling could be done via yml configuration:

```YAML
sources:
  source_id:
    collections:
      - name: "sample_collection"
        schedule: "0/1 * 0 ? * * *" #cron expression — every minute
```

Since EventNative cluster can have a several nodes, coordination should be done via "double locking" (logic given in Java-like pseudo-code):

```java
        if (!taskIsRunning(sourceId, collectionId)) {
            Lock lock = getTaskLock(sourceId, collectionId);
            if (lock.tryLock()) {
                try {
                    if (!taskIsRunning(sourceId, collectionId)) {
                        scheduleTask(sourceId, collectionId);
                    }
                } finally {
                    lock.unlock();
                }
            }
        }
```



