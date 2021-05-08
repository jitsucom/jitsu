import {Hint} from "../../../components/documentationComponents";

# Google Analytics

**EventNative** supports [Google Analytics](https://analytics.google.com/) as a destination and
sends data via [Measurement protocol](https://developers.google.com/analytics/devguides/collection/protocol/v1/reference).
All event fields after [Mapping Step](/docs/how-it-works/architecture#mapping-step) will be
formatted as URL values and will be sent to Google Analytics with HTTP GET request.

<Hint>
Google Analytics destination supports only `stream` mode and <b>should have</b> mapping rules
    compatible with Measurement protocol requirements.
</Hint>

## Filtering events

For filtering events stream to prevent sending all events in GoogleAnalytics
`table_name_template` is used. For more information see
[Table Names and Filters](/docs/configuration/table-names-and-filters#events-filtering).

## Configuration

Google Analytics destination config consists of the following schema:

```yaml
destinations:
  my_google_analytics:
    type: google_analytics
    mode: stream
    google_analytics:
      tracking_id: UA-121905385-1
    data_layout:
      table_name_template: '{{text template}}' #Optional. It is used for filtering events.
      mappings:
        keep_unmapped: false
        fields:
          - src: /event_type
            dst: /t
            action: move
          - dst: /aip
            action: constant
            value: false
          - dst: /ds
            action: constant
            value: false
          - src: /eventn_ctx/user/anonymous_id
            dst: /cid
            action: move
          - src: /eventn_ctx/user/id
            dst: /uid
            action: move
          - src: /eventn_ctx/user_agent
            dst: /ua
            action: move
          - src: /source_ip
            dst: /uip
            action: move
          - src: /eventn_ctx/referer
            dst: /dr
            action: move
          - src: /eventn_ctx/utm/campaign
            dst: /cn
            action: move
          - src: /eventn_ctx/utm/source
            dst: /cs
            action: move
          - src: /eventn_ctx/utm/medium
            dst: /cm
            action: move
          - src: /eventn_ctx/utm/term
            dst: /ck
            action: move
          - src: /eventn_ctx/utm/content
            dst: /cc
            action: move
          - src: /eventn_ctx/click_id/gclid
            dst: /gclid
            action: move
          - src: /eventn_ctx/click_id/dclid
            dst: /dclid
            action: move
          - src: /eventn_ctx/screen_resolution
            dst: /sr
            action: move
          - src: /eventn_ctx/vp_size
            dst: /vp
            action: move
          - src: /eventn_ctx/doc_encoding
            dst: /de
            action: move
          - src: /eventn_ctx/url
            dst: /dl
            action: move
          - src: /eventn_ctx/doc_host
            dst: /dh
            action: move
          - src: /eventn_ctx/doc_path
            dst: /dp
            action: move
          - src: /eventn_ctx/page_title
            dst: /dt
            action: move
          - src: /eventn_ctx/user_language
            dst: /ul
            action: move
          - src: /conversion/transaction_id
            dst: /ti
            action: move
          - src: /conversion/affiliation
            dst: /ta
            action: move
          - src: /conversion/revenue
            dst: /tr
            action: move
          - src: /conversion/shipping
            dst: /ts
            action: move
          - src: /conversion/tt
            dst: /tt
            action: move
```

### google_analytics

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
      <td>
          <b>tracking_id</b>
          <br />
          <em>(required)</em>
      </td>
      <td>string</td>
      <td>Google Analytics Tracking ID. Can be taken from Google Analytics UI or
        from javascript pixel.</td>
    </tr>
  </tbody>
</table>

