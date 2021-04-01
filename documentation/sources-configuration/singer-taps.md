import {Hint} from "../../../components/documentationComponents";

# Singer

[Singer](https://www.singer.io/) is an open-source project that has 100+ API connectors(taps) to different platforms. EventNative supports Singer as a source. Singer configuration contains four JSON files/objects depends on the tap type according to the [specification](https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#singer-specification):

| Name | Description |
| :--- | :--- |
| [Config](https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#config) (required) | JSON payload contains authorization keys, account ids, start date (date for downloading since). JSON structure depends on the tap. |
| [Catalog](https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#catalog) (required) | JSON payload contains all streams (object types) and fields to download. JSON structure is standardized, but stream and field names depend on the tap. |
| [State](https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state) | JSON payload contains bookmarks that specify an initial state. It is used when you need to download not all data. |
| Properties | `Deprecated`. JSON payload contains streams and fields schema like Catalog. Used by some legacy taps (e.g. [Facebook tap](https://github.com/singer-io/tap-facebook)) |

### Configuration

```yaml

singer-bridge:
  python: /path/to/python #Optional. Default value is 'python3'
  venv_dir: /path/to/venv_dir #Optional. Default value is './venv'
  log:
    path: /home/eventnative/logs #or "global" constant for writing logs to stdout
    rotation_min: 60 #Optional. Default value is 1440 (24 hours)
    max_backups: 5 #Optional. Default value is 0 (no limit)


sources:
  ...
  jitsu_singer_facebook:
    type: singer
    destinations: [ "postgres_destination_id" ]
    config:
      tap: tap-facebook
      config: /home/eventnative/app/res/facebook_config.json
      properties: /home/eventnative/app/res/facebook_props.json
      initial_state: /home/eventnative/app/res/facebook_initial_state.json
  jitsu_singer_shopify:
    type: singer
    destinations: [ "clickhouse_destination_id" ]
    config:
      tap: tap-shopify
      config: '{"config_key1":"value"}'
      catalog: '{"field_1":"value"}'
  
```

Singer source might write logs to `global` EventNative application logs or to a dedicated file.

<Hint>
    JSON configuration parameters such as <code inline="true">config</code>, <code inline="true">catalog</code>, <code inline="true">state</code> and <code inline="true">properties</code> might be a raw JSON or JSON string or path to local JSON file
</Hint>