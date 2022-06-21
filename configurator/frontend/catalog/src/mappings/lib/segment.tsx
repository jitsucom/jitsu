import { DestinationConfigurationTemplate } from "../types"

const mapping: DestinationConfigurationTemplate = {
  keepUnmappedFields: false,
  tableNameTemplate:
    '{{if or (eq .event_type "user_identify") (eq .event_type "identify")}}{{"identifies"}}{{else}}{{if or (eq .event_type "page") (eq .event_type "pageview")}}{{"pages"}}{{else}}{{.event_type}}{{end}}{{end}}',
  comment: (
    <>
      Template for Segment compatibility implementation. Use this template to cast Jitsu events to Segment-like schema.{" "}
      <a target="_blank" href="https://jitsu.com/docs/other-features/segment-compatibility">
        More on Segment compatibility here
      </a>
    </>
  ),
  mappings: [
    {
      src: "/src_payload/name",
      dst: "/name",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/title",
      dst: "/title",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/url",
      dst: "/url",
      action: "move",
    },
    {
      src: "/src_payload/obj/userId",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/src_payload/obj/anonymousId",
      dst: "/anonymous_id",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/library/version",
      dst: "/context_library_version",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/referrer",
      dst: "/context_page_referrer",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/url",
      dst: "/context_page_url",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/userAgent",
      dst: "/context_user_agent",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/referrer",
      dst: "/referrer",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/search",
      dst: "/context_page_search",
      action: "move",
    },
    {
      src: "/src_payload/obj/timestamp",
      dst: "/timestamp",
      action: "move",
      type: "timestamp",
    },
    {
      src: "/source_ip",
      dst: "/context_ip",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/library/name",
      dst: "/context_library_name",
      action: "move",
    },
    {
      src: "/src_payload/obj/messageId",
      dst: "/id",
      action: "move",
    },
    {
      src: "/src_payload/obj/sentAt",
      dst: "/sent_at",
      action: "move",
      type: "timestamp",
    },
    {
      src: "/src_payload/obj/context/locale",
      dst: "/context_locale",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/path",
      dst: "/context_page_path",
      action: "move",
    },
    {
      src: "/src_payload/obj/context/page/title",
      dst: "/context_page_title",
      action: "move",
    },
    {
      src: "/src_payload/obj/traits/name",
      dst: "/name",
      action: "move",
    },
    {
      src: "/src_payload/obj/traits/email",
      dst: "/email",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/campaign",
      dst: "/context_campaign_source",
      action: "move",
    },
    {
      src: "/app",
      dst: "/app",
      action: "move",
    },
    {
      src: "/source_ip",
      dst: "/context_ip",
      action: "move",
    },
    {
      src: "/eventn_ctx/url",
      dst: "/url",
      action: "move",
    },
    {
      src: "/url",
      dst: "/url",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/id",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/user/id",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/internal_id",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/user/internal_id",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_agent",
      dst: "/context_user_agent",
      action: "move",
    },
    {
      src: "/user_agent",
      dst: "/context_user_agent",
      action: "move",
    },
    {
      src: "/eventn_ctx/utc_time",
      dst: "/sent_at",
      action: "move",
      type: "timestamp",
    },
    {
      src: "/utc_time",
      dst: "/sent_at",
      action: "move",
      type: "timestamp",
    },
    {
      src: "/eventn_ctx/user_language",
      dst: "/context_locale",
      action: "move",
    },
    {
      src: "/user_language",
      dst: "/context_locale",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_path",
      dst: "/path",
      action: "move",
    },
    {
      src: "/doc_path",
      dst: "/path",
      action: "move",
    },
    {
      src: "/eventn_ctx/page_title",
      dst: "/title",
      action: "move",
    },
    {
      src: "/page_title",
      dst: "/title",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/anonymous_id",
      dst: "/anonymous_id",
      action: "move",
    },
    {
      src: "/user/anonymous_id",
      dst: "/anonymous_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/referer",
      dst: "/referrer",
      action: "move",
    },
    {
      src: "/referer",
      dst: "/referrer",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/email",
      dst: "/email",
      action: "move",
    },
    {
      src: "/user/email",
      dst: "/email",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_search",
      dst: "/search",
      action: "move",
    },
    {
      src: "/doc_search",
      dst: "/search",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/source",
      dst: "/context_utm_source",
      action: "move",
    },
    {
      src: "/utm/source",
      dst: "/context_utm_source",
      action: "move",
    },
  ],
}

export default mapping
