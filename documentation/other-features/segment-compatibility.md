# Segment Compatibility

**EventNative** can serve as a Segment replacement.

For that, we provide to different approaches:

 * If you're using analytics.js on frontend already, EventNative can intercept all events you send to analytics.js. Check
[Events Inteception page](/docs/sending-data/javascript-reference/events-interception) for more details
 * If you're sending events directly from [JS SDK](/docs/sending-data/javascript-reference/npm-or-yarn)
or [through API](/docs/sending-data/api) Segment compatible data still can be produced.

For both approaches you'll need to configure fields [mapping](/docs/configuration/schema-and-mappings).
See [Mappings for Segment Compatibility](#mappings-for-segment-compatibility) section.

Also, you'll need to create a view to mimic Segment's `users` table. See below

## Segment Tables

By default, Segment creates 1 table per 1 event type. For keeping these table names - configure `table_name_template` (see examples below).
Also, Segment creates `users` table as unique records from `identifies` table. For keeping it as well - create an SQL view with the
following statement:

```sql
create view users as
select distinct on (email) _timestamp,
                           context_page_url,
                           context_user_agent,
                           email,
                           name,
                           context_locale,
                           context_page_path,
                           context_page_title,
                           context_ip,
                           context_page_search,
                           context_page_referrer,
                           anonymous_id,
                           user_id,
                           context_campaign_source,
                           context_utm_source
from identifies;
```

## Mappings for Segment Compatibility

If you're using analytics.js on frontend already - **EventNative** javascript should be configured according to [the following javascript reference](../sending-data/javascript-reference/events-interception).
If you're sending events directly - **EventNative** javascript should be set up, tracking event calls should be placed according to your requirements and the destination should contain the following mapping configuration:

Destination configuration should have the following mapping configuration:

```yaml
server:
  ...

destinations:
  destination_to_write_segment_data:
    type: ...
    ...
    data_layout:
      table_name_template: |
        {{if or (eq .event_type "user_identify") (eq .event_type "identify")}}
          {{"identifies"}}
        {{else}}
          {{if or (eq .event_type "page") (eq .event_type "pageview")}}
            {{"pages"}}
          {{else}}
            {{.event_type}}
          {{end}}
        {{end}}
      mappings:
        #Use true if you would like to have Segment like DB schema + all other fields.
        #Use false for having only Segment data.
        keep_unmapped: false
        fields:
          #ip
          - src: /source_ip
            dst: /context_ip
            action: move
          #context_library_name
          - src: /src_payload/obj/context/library/name
            dst: /context_library_name
            action: move
          #search + context_page_search
          - src: /src_payload/obj/context/page/search
            dst: /context_page_search
            action: move
          - src: /src_payload/obj/context/page/search
            dst: /search
            action: move
          - src: /eventn_ctx/doc_search
            dst: /search
            action: move
          - src: /eventn_ctx/doc_search
            dst: /context_page_search
            action: move
          #title + context_page_title
          - src: /src_payload/obj/context/page/title
            dst: /title
            action: move
          - src: /src_payload/obj/context/page/title
            dst: /context_page_title
            action: move
          - src: /eventn_ctx/page_title
            dst: /title
            action: move
          - src: /eventn_ctx/page_title
            dst: /context_page_title
            action: move
          #name
          - src: /src_payload/obj/name
            dst: /name
            action: move
          - src: /src_payload/obj/traits/name
            dst: /name
            action: move
          - src: /eventn_ctx/user/name
            dst: /name
            action: move
          #url + context_page_url
          - src: /src_payload/obj/context/page/url
            dst: /url
            action: move
          - src: /src_payload/obj/context/page/url
            dst: /context_page_url
            action: move
          - src: /eventn_ctx/url
            dst: /url
            action: move
          - src: /eventn_ctx/url
            dst: /context_page_url
            action: move
          #path + context_page_path
          - src: /src_payload/obj/context/page/path
            dst: /path
            action: move
          - src: /src_payload/obj/context/page/path
            dst: /context_page_path
            action: move
          - src: /eventn_ctx/doc_path
            dst: /path
            action: move
          - src: /eventn_ctx/doc_path
            dst: /context_page_path
            action: move
          #user_id
          - src: /src_payload/obj/userId
            dst: /user_id
            action: move
          - src: /eventn_ctx/user/internal_id
            dst: /user_id
            action: move
          #anonymous_id
          - src: /src_payload/obj/anonymousId
            dst: /anonymous_id
            action: move
          - src: /eventn_ctx/user/anonymous_id
            dst: /anonymous_id
            action: move
          #context_library_version
          - src: /src_payload/obj/context/library/version
            dst: /context_library_version
            action: move
          #context_locale
          - src: /src_payload/obj/context/locale
            dst: /context_locale
            action: move
          - src: /eventn_ctx/user_language
            dst: /context_locale
            action: move
          #context_user_agent
          - src: /src_payload/obj/context/page/userAgent
            dst: /context_user_agent
            action: move
          - src: /eventn_ctx/user_agent
            dst: /context_user_agent
            action: move
          #referrer + context_page_referrer
          - src: /src_payload/obj/context/page/referrer
            dst: /context_page_referrer
            action: move
          - src: /src_payload/obj/context/page/referrer
            dst: /referrer
            action: move
          - src: /eventn_ctx/referer
            dst: /referrer
            action: move
          - src: /eventn_ctx/referer
            dst: /context_page_referrer
            action: move
          #context_campaign_source
          - src: /eventn_ctx/utm/campaign
            dst: /context_campaign_source
            action: move
          - src: /src_payload/obj/context/campaign/name
            dst: /context_campaign_source
            action: move
          #email
          - src: /src_payload/obj/traits/email
            dst: /email
            action: move
          - src: /eventn_ctx/user/email
            dst: /email
            action: move
          #context_utm_source
          - src: /src_payload/obj/context/campaign/source
            dst: /context_utm_source
            action: move
          - src: /eventn_ctx/utm/source
            dst: /context_utm_source
            action: move
          #sent_at
          - src: /src_payload/obj/sentAt
            dst: /sent_at
            action: move
            type: timestamp
          - src: /eventn_ctx/utc_time
            dst: /sent_at
            action: move
            type: timestamp
```