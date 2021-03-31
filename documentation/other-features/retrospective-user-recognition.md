import {Hint} from "../../../components/documentationComponents";

# Retrospective User Recognition

**EventNative** supports storing all events from anonymous users and updates them in DWH with user id after user identification. At present this functionality is supported only for [Postgres](/docs/destinations-configuration/postgres), [Redshift](/docs/destinations-configuration/redshift), and [ClickHouse](/docs/destinations-configuration/clickhouse-destination).

### Example

| event\_id | anonymous\_id | email |
| :--- | :--- | :--- |
| **event1** | 1 |  |
| **event2** | 1 |  |
| **event2** | 1 | a@b.com |
| **event4** | 1 | a@b.com |

Right after **event3** **EventNative** amends **event1** and **event2** and adds email=[a@b.com](mailto:a@b.com). As a result, there will be the following events in DWH:

| event\_id | anonymous\_id | email |
| :--- | :--- | :--- |
| **event1** | 1 | **a@b.com** |
| **event2** | 1 | **a@b.com** |
| **event2** | 1 | a@b.com |
| **event4** | 1 | a@b.com |

<Hint>
    Fields anonymous_id and email are configurable.
</Hint>

### Configuration

For enabling this feature, a global `users_recognition` must present in the configuration. The global configuration is applied to all destinations. It means that all events which are supposed to be stored into destinations of Postgres and ClickHouse types will be sent through the users recognition pipeline and all anonymous events will be stored into meta storage. Configuration per destination overrides the global one.

<Hint>
    This feature requires: meta.storage and primary_key_fields configuration in Postgres destination.
    Read more about those settings on <a href="/docs/configuration/">General Configuration</a>
</Hint>



```yaml
server:
...

destinations:
  my_postgres:
    type: postgres
    datasource:
      host: my_postgres_host
      db: my-db
      ...
    data_layout:
      primary_key_fields: #Required for Postgres, Redshift users recognition feature
        - eventn_ctx_event_id  
    #override global configuration completely (all fields)
    #omit this for applying global configuration
    users_recognition: #Optional
      enabled: true #set false for disabling
      anonymous_id_node: /user/anonymous_id #Required if enabled
      user_id_node: /user/id #Required if enabled
      
meta:
  storage:
    redis:
      host: redis_host
      port: 6379
      password: secret_password
 
#global configuration
#is applied to all destinations           
users_recognition:
  enabled: true      
  anonymous_id_node: /user/anonymous_id #Optional. Default value: /eventn_ctx/user/anonymous_id
  user_id_node: /user/id #Optional. Default value: /eventn_ctx/user/internal_id
```

<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Type</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>enabled</b>
      </td>
      <td>boolean</td>
      <td>Enabling/disabling this feature globally or for a certain destination</td>
    </tr>
    <tr>
      <td>
          <b>anonymous_id_node</b>
        <br />
        <em>(required)</em>
      </td>
      <td>string</td>
      <td>JSON path to user anonymous id. This value will be used as a part of the
        Meta storage key. Optional in global configuration, but required in destination
        configuration</td>
    </tr>
    <tr>
      <td>
        <b>user_id_node</b>
          <br />
        <em>(required)</em>
      </td>
      <td>string</td>
      <td>JSON path to user id. If exists the recognition pipeline will be started.
        If doesn&apos;t exist - an event will be stored in the Meta storage as
        anonymous. Optional in global configuration, but required in destination
        configuration</td>
    </tr>
  </tbody>
</table>



