import { DestinationConfigurationTemplate } from "../types"

const mapping: DestinationConfigurationTemplate = {
  displayName: "Google Analytics",
  comment: (
    <>
      This templates converts incoming events to{" "}
      <a target="_blank" href="https://developers.google.com/analytics/devguides/collection/protocol/v1">
        Google Analytics Measurement API
      </a>{" "}
      calls. Make sure you use Google Analytics destination, otherwise configuration won't make much sense
    </>
  ),
  keepUnmappedFields: false,
  mappings: [
    {
      src: "/event_type",
      dst: "/t",
      action: "move",
    },
    {
      src: null,
      dst: "/aip",
      action: "constant",
      value: 0,
    },
    {
      src: null,
      dst: "/ds",
      action: "constant",
      value: "jitsu",
    },
    {
      src: "/eventn_ctx/user/anonymous_id",
      dst: "/cid",
      action: "move",
    },
    {
      src: "/user/anonymous_id",
      dst: "/cid",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/id",
      dst: "/uid",
      action: "move",
    },
    {
      src: "/user/id",
      dst: "/uid",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_agent",
      dst: "/ua",
      action: "move",
    },
    {
      src: "/user_agent",
      dst: "/ua",
      action: "move",
    },
    {
      src: "/source_ip",
      dst: "/uip",
      action: "move",
    },
    {
      src: "/eventn_ctx/referer",
      dst: "/dr",
      action: "move",
    },
    {
      src: "/referer",
      dst: "/dr",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/campaign",
      dst: "/cn",
      action: "move",
    },
    {
      src: "/utm/campaign",
      dst: "/cn",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/source",
      dst: "/cs",
      action: "move",
    },
    {
      src: "/utm/source",
      dst: "/cs",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/medium",
      dst: "/cm",
      action: "move",
    },
    {
      src: "/utm/medium",
      dst: "/cm",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/term",
      dst: "/ck",
      action: "move",
    },
    {
      src: "/utm/term",
      dst: "/ck",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm/content",
      dst: "/cc",
      action: "move",
    },
    {
      src: "/utm/content",
      dst: "/cc",
      action: "move",
    },
    {
      src: "/eventn_ctx/click_id/gclid",
      dst: "/gclid",
      action: "move",
    },
    {
      src: "/click_id/gclid",
      dst: "/gclid",
      action: "move",
    },
    {
      src: "/eventn_ctx/click_id/dclid",
      dst: "/dclid",
      action: "move",
    },
    {
      src: "/click_id/dclid",
      dst: "/dclid",
      action: "move",
    },
    {
      src: "/eventn_ctx/screen_resolution",
      dst: "/sr",
      action: "move",
    },
    {
      src: "/screen_resolution",
      dst: "/sr",
      action: "move",
    },
    {
      src: "/eventn_ctx/vp_size",
      dst: "/vp",
      action: "move",
    },
    {
      src: "/vp_size",
      dst: "/vp",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_encoding",
      dst: "/de",
      action: "move",
    },
    {
      src: "/doc_encoding",
      dst: "/de",
      action: "move",
    },
    {
      src: "/eventn_ctx/url",
      dst: "/dl",
      action: "move",
    },
    {
      src: "/url",
      dst: "/dl",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_host",
      dst: "/dh",
      action: "move",
    },
    {
      src: "/doc_host",
      dst: "/dh",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_path",
      dst: "/dp",
      action: "move",
    },
    {
      src: "/doc_path",
      dst: "/dp",
      action: "move",
    },
    {
      src: "/eventn_ctx/page_title",
      dst: "/dt",
      action: "move",
    },
    {
      src: "/page_title",
      dst: "/dt",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_language",
      dst: "/ul",
      action: "move",
    },
    {
      src: "/user_language",
      dst: "/ul",
      action: "move",
    },
    {
      src: "/conversion/transaction_id",
      dst: "/ti",
      action: "move",
    },
    {
      src: "/conversion/affiliation",
      dst: "/ta",
      action: "move",
    },
    {
      src: "/conversion/revenue",
      dst: "/tr",
      action: "move",
    },
    {
      src: "/conversion/shipping",
      dst: "/ts",
      action: "move",
    },
    {
      src: "/conversion/tt",
      dst: "/tt",
      action: "move",
    },
  ],
}

export default mapping
