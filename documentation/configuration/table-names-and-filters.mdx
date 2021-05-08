import {Hint} from "../../../components/documentationComponents";

# Table Names and Filters

**EventNative** supports splitting events stream into different tables in DWH based on event JSON payload. It works by applying [GO text template](https://golang.org/pkg/text/template/) expressions to incoming JSON objects. It can select a table name or pass a constant or even filter certain events from the destination. It is configured in the destination section and each destination has its own rules. 

## **Table Name Selection**

By default table name will be `events` constant. It can be overridden in several ways:

Constant table name. In this case, all incoming events for `destination_1` will be stored in a single table with `constant` name.

```yaml
destinations:
  destination_1:
    data_layout:
      table_name_template: 'constant'
```

Table names are based on field values.

```yaml
destinations:
  destination_1:
    data_layout:
      #tables will be created with 'event_type' names
      table_name_template: '{{.event_type}}' 
      #or
      #tables will have 'event_type_YYYY_MM' format based on 'event_type' and date
      table_name_template: '{{.event_type}}_{{._timestamp.Format "2006_01"}}' 
```

<Hint>
    Timestamp formatting is based on <a href="https://user-images.githubusercontent.com/18486255/98962749-fd5ae480-2517-11eb-9448-93aafdf6f97f.png">GO lang time layouts</a>.
</Hint>

## Events Filtering

`table_name_template` might be used for filtering certain events from the destination.
<Hint>
    If <code inline={true}>table_name_template</code> returns an empty string then the event will be skipped.
    <code inline={true}>table_name_template</code>
</Hint>

For example all `pageview` events might be skipped:

```yaml
destinations:
  destination_1:
    data_layout:
      table_name_template: '{{if eq .event_type "pageview"}}{{else}}{{.event_type}}{{end}}'
```

Expressions might be more complex. For example, keep only conversion events
\(skip other\) in case when a user isn't Google Analytics known user:

```yaml
destinations:
  destination_1:
    data_layout:
      table_name_template: |
        {{if .event_type}}
            {{if and (eq .event_type "conversion") (and (.eventn_ctx)
                 (or (not .eventn_ctx.ids) (not .eventn_ctx.ids.ga)))}}
              {{.event_type}}
            {{else}}
        {{end}}
        {{else}}{{end}}
```

