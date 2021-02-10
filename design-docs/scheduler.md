# Scheduler

This design document describes how the EventNative should execute periodic synchronization tasks (to pull data from API).

## Definitions

* **Collection** — see EventNative [documentation](https://docs.eventnative.org/configuration-1/sources-configuration#collections) 
* **Collection Syncronization Task (aka Task)**  — an atomic task that make sure that the collection is up-to-date. The task may call external resources (API). All tasks should be single-threaded
* **Task Log** — log that was written during execution of the task: all stdout output that was produced by synchronization thread. Log consists from log entries: `{time: "<utc_timestamp>", message: "<message>"}`
* **Tasks History** — a collection of tasks that has been already executed (succesfully on un-sucessfully — doesn't matter)
* **Task Queue** — a queue of tasks that should be executed
* **Task Worker** — a thread that pulls tasks from queue and executes it. Each EventNative node can have several task workers
* **UTC Timestamp** — if time is referenced as utc_timestamp, the format should be ISO

## Task Execution

Each task should be serializable to JSON and added to the queue (see Task Scheduling on how tasks are being added to queue). Task JSON structure:

```json
{
  "id": "<unique_id>",
  "source": "<source_id>",
  "collection": "<collection_id>",
  "priority": "postive number",
  "time_added": "<utc_timestamp>",
  "time_stated": "<utc_timestamp or null if not started yet>",
  "time_finished": "<utc_timestamp or null if not finished yet>",
  "status": 'SCHEDULED' | 'FAILED' | 'SUCCESS' | 'RUNNING'
}
```

Tasks should be kept in redis queue with priorities. Priority is defined by uint64 `task_priority * 10^12 + time_added_unix` where `time_added_unix` is a `time_added` as unix epoch time (in seconds)

Each Task Worker on each EventNative node should be pulling tasks from queue. Once task is pulled:

- It should be moved to **Task History** collection and status should be set to **RUNNING**; time_started should be set to current time
- A separate thread should start an execution. Stdout should be listened and put to **Task Logs Collection**

## Task History

All information about tasks history should be kept in collections (note: task becomes "history" once the execution started)

* **Task History Collection**. A sorted set where score is time_started and value us Task JSON
* **Task Logs** a collection of logs as task_id → [{time, message}]. Key is a task and value is a sorted set of {time, message} where time is score



### Task Logs Collection

TODO

## API calls

All API calls should be autentificated via standard [Admin authorization mechanism](https://docs.eventnative.org/other-features/admin-endpoints)

#### /tasks/task?id={id}

Gets a task JSON (see above). Applies to all task statuses, so implementation should search in **Task History** and **Task Queue** collections 

#### /tasks/logs?id={id}&from={utc_timestamp}&to={utc_timestamp}

Retrieves task logs as set of log entries `[{time: "<utc_timestamp>", message: "<message>"}]`. Parameters:

* **id** (required) —  task id
* **from, to** (optiona) — if set only logs entries within this period should be returned

#### /tasks/list?from={utc_timestamp}&to={utc_timestamp}&status={status}&source={}&collection={}

Gets a task JSON (see above). Applies to all task statuses, so implementation should search in **Task History** and **Task Queue** collections and apply filters later. 

* **from**, **to** are required
* **status**, **source** and **collection** are optional

## Task Scheduling

Task scheduling can be done both automatically and manually. In both ways scheduling is merely constructing Task JSON and adding it to Task Execution queue.

### Manual Scheduling

Manual scheduling is done via `/tasks/schedule?source={}&collection={}` response should return newrly created task id

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



