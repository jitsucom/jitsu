# General Configuration

**EventNative** is configured through a single YAML file. We follow
[convention over configuration](https://en.wikipedia.org/wiki/Convention_over_configuration) so the majority of
parameters are optional. To get a base file, clone it from
[GitHub](https://github.com/jitsucom/eventnative/blob/master/config/config.template.yaml).

Our config file consists of the following sections:

* `server` — General configuration parameters such as port, authorization, application logs configuration, singer bridge configuration, etc.
* `geo` — Geo resolution data (extracting city/state information from the IP address). We currently only support [MaxMind](https://www.maxmind.com/en/home) as a data provider. see [Geo Data resolution](/docs/other-features/geo-data-resolution)
* `log` — EventNative writes all events locally and sends them to their destinations (in batch mode). This is where you configure your local temporary path and push frequency.
* `sql_debug_log` — All SQL statements such as DDL and DML expressions can be stored in separated log files or in stdout. see [SQL Query Logs](/docs/configuration/sql-query-logs)
* `destinations` — A set of targets where the final version of events will be stored. see [Destinations Configuration](/docs/destinations-configuration)
* `sources` — A set of data sources to synchronize from. see [Sources Configuration](/docs/sources-configuration)
* `users_recognition` — EventNative can update past events with user identifiers on user's identification event! see [Retrospective Users Recognition](/docs/other-features/retrospective-user-recognition)
* `coordination` — coordination service configuration. It is used in cluster EventNative deployments. see [Scaling EventNative](/docs/other-features/scaling-eventnative)
* `notifications` — notifier configuration. Server starts, system errors, and panics information will be sent to it. Currently, only Slack notifications are supported.
* `meta.storage` - meta storage configuration. At present EventNative supports only [Redis](https://redis.io/). It is used for last events caching (see [Events Cache](/docs/other-features/events-cache)), sources synchronization (see [Sources Configuration](/docs/sources-configuration/)), and [Retrospective Users Recognition](/docs/other-features/retrospective-user-recognition).

**Example**:

```yaml
server:
  name: instance1.domain.com
  port: 8081
  auth: '193b6281-f211-47a9-b384-102cf4cd2d55'
  public_url: https://instances.domain.com 
  log:
    path: /home/eventnative/logs/
  metrics.prometheus.enabled: true    
    
geo.maxmind_path: /home/eventnative/app/res/

log:
  path: /home/eventnative/logs/events
  rotation_min: 5

sql_debug_log:
  ddl:
  queries:
  
destinations:
  redshift:
  bigquery:

sources:
  facebook:
  google_analytics:

users_recognition:
  enabled: true
  
coordination:
  etcd:
    endpoint: http://your_etcd_host

notifications:
  slack:
    url: https://slack_web_hook_url
    
meta:
  storage:
    redis:
      host: redis_host
      port: 6379
      password: secret_password    
  
```

### Server

All fields from the **server** section are optional:

| Field | Type | Description | Default value |
| :--- | :--- | :--- | :--- |
| **name** | string | Unique instance name. It is used in cluster deployments. | **unnamed-server** |
| **port** | int | TCP port for the server to listen on. | `8001` |
| **auth** | objects array/string | see [Authorization](/docs/configuration/authorization) page. | generated UUID |
| **public\_url** | string | Service public URL. It is used on the [welcome HTML page](/docs/sending-data/javascript-reference/#quickstart). Required in [Heroku deployment](/docs/deployment/deploy-on-heroku). | Will be got from `Host` request header |
| **log.path** | string | Path to application logs. If not set,  app logs will be in stdout. | - |
| **log.rotation\_min** | int | Log files rotation minutes. If **log.path** is configured. | - |
| **auth\_reload\_sec** | int | If an URL is set in **auth** section, authorization will be reloaded every **auth\_reload\_sec** seconds. see [Authorization](/docs/configuration/authorization#http-url) page. | `30` |
| **destinations\_reload\_sec** | int | If an URL is set in **destinations** section, destinations will be reloaded every **destinations\_reload\_sec** seconds. see [Destinations](./#destinations). | `40` |
| **admin\_token** | string | see [Admin Endpoints](/docs/other-features/admin-endpoints) page. | - |
| **metrics.prometheus.enabled** | boolean | see [Application Metrics](/docs/other-features/application-metrics) page. | `false` |
| **telemetry.disabled.usage** | boolean | Flag for disabling telemetry. **EventNative** collects usage metrics about how you use it and how it is working. **We don't collect any customer data**. | `false` |
| **disable\_version\_reminder** | boolean | Flag for disabling log reminder banner about new **EventNatvie** versions availability. | `false` |

### Log

**EventNative** supports destinations in streaming and batch modes. In the case of batch mode, all events are stored in JSON log files locally to **path** directory, and every **rotation\_min** minutes they are processed and pushed to destinations.  
All fields from **log** section are optional:

| Field | Type | Description | Default value |
| :--- | :--- | :--- | :--- |
| **path** | string | Events log files path. | `/home/eventnative/logs/events` |
| **rotation\_min** | int | Log files rotation minutes. | `5` |
| **show\_in\_server** | boolean | Flag for debugging. If true - all events JSON data is written in app logs. | `false` |

