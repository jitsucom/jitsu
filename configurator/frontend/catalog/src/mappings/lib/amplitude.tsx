import { DestinationConfigurationTemplate } from "../types"

const mapping: DestinationConfigurationTemplate = {
  displayName: "Amplitude",
  comment: (
    <>
      This templates converts incoming events to{" "}
      <a target="_blank" href="https://developers.amplitude.com/docs/http-api-v2">
        Amplitude
      </a>{" "}
      API calls. Make sure you use Amplitude destination, otherwise configuration won't make much sense
    </>
  ),
  keepUnmappedFields: false,
  mappings: [
    {
      src: "/eventn_ctx/user/email",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/user/email",
      dst: "/user_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/anonymous_id",
      dst: "/device_id",
      action: "move",
    },
    {
      src: "/user/anonymous_id",
      dst: "/device_id",
      action: "move",
    },
    {
      src: "/event_type",
      dst: "/event_type",
      action: "move",
    },
    {
      src: "/eventn_ctx/parsed_ua/os_family",
      dst: "/os_name",
      action: "move",
    },
    {
      src: "/parsed_ua/os_family",
      dst: "/os_name",
      action: "move",
    },
    {
      src: "/eventn_ctx/parsed_ua/os_version",
      dst: "/os_version",
      action: "move",
    },
    {
      src: "/parsed_ua/os_version",
      dst: "/os_version",
      action: "move",
    },
    {
      src: "/eventn_ctx/parsed_ua/device_brand",
      dst: "/device_brand",
      action: "move",
    },
    {
      src: "/parsed_ua/device_brand",
      dst: "/device_brand",
      action: "move",
    },
    {
      src: "/eventn_ctx/parsed_ua/device_family",
      dst: "/device_manufacturer",
      action: "move",
    },
    {
      src: "/parsed_ua/device_family",
      dst: "/device_manufacturer",
      action: "move",
    },
    {
      src: "/eventn_ctx/parsed_ua/device_model",
      dst: "/device_model",
      action: "move",
    },
    {
      src: "/parsed_ua/device_model",
      dst: "/device_model",
      action: "move",
    },
    {
      src: "/eventn_ctx/location/country",
      dst: "/country",
      action: "move",
    },
    {
      src: "/location/country",
      dst: "/country",
      action: "move",
    },
    {
      src: "/eventn_ctx/location/region",
      dst: "/region",
      action: "move",
    },
    {
      src: "/location/region",
      dst: "/region",
      action: "move",
    },
    {
      src: "/eventn_ctx/location/city",
      dst: "/city",
      action: "move",
    },
    {
      src: "/location/city",
      dst: "/city",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_language",
      dst: "/language",
      action: "move",
    },
    {
      src: "/user_language",
      dst: "/language",
      action: "move",
    },
    {
      src: "/eventn_ctx/location/latitude",
      dst: "/location_lat",
      action: "move",
    },
    {
      src: "/location/latitude",
      dst: "/location_lat",
      action: "move",
    },
    {
      src: "/eventn_ctx/location/longitude",
      dst: "/location_lng",
      action: "move",
    },
    {
      src: "/location/longitude",
      dst: "/location_lng",
      action: "move",
    },
    {
      src: "/source_ip",
      dst: "/ip",
      action: "move",
    },
    {
      src: "/eventn_ctx/event_id",
      dst: "/insert_id",
      action: "move",
    },
    {
      src: "/eventn_ctx_event_id",
      dst: "/insert_id",
      action: "move",
    },
    {
      src: "/url",
      dst: "/event_properties/url",
      action: "move",
    },
    {
      src: "/eventn_ctx/url",
      dst: "/event_properties/url",
      action: "move",
    },
    {
      src: "/utm",
      dst: "/event_properties/utm",
      action: "move",
    },
    {
      src: "/eventn_ctx/utm",
      dst: "/event_properties/utm",
      action: "move",
    },
    {
      src: "/click_id",
      dst: "/event_properties/click_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/click_id",
      dst: "/event_properties/click_id",
      action: "move",
    },
    {
      src: "/doc_host",
      dst: "/event_properties/host",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_host",
      dst: "/event_properties/host",
      action: "move",
    },
    {
      src: "/doc_path",
      dst: "/event_properties/path",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_path",
      dst: "/event_properties/path",
      action: "move",
    },
    {
      src: "/doc_search",
      dst: "/event_properties/search",
      action: "move",
    },
    {
      src: "/eventn_ctx/doc_search",
      dst: "/event_properties/search",
      action: "move",
    },
    {
      src: "/app",
      dst: "/event_properties/app",
      action: "move",
    },
    {
      src: "/referer",
      dst: "/event_properties/referrer",
      action: "move",
    },
    {
      src: "/eventn_ctx/referer",
      dst: "/event_properties/referrer",
      action: "move",
    },
    {
      src: "/page_title",
      dst: "/event_properties/title",
      action: "move",
    },
    {
      src: "/eventn_ctx/page_title",
      dst: "/event_properties/title",
      action: "move",
    },
    {
      src: "/src",
      dst: "/event_properties/src",
      action: "move",
    },
    {
      src: "/user_agent",
      dst: "/event_properties/user_agent",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_agent",
      dst: "/event_properties/user_agent",
      action: "move",
    },
    {
      src: "/user_agent",
      dst: "/user_agent",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_agent",
      dst: "/user_agent",
      action: "move",
    },
    {
      src: "/vp_size",
      dst: "/event_properties/vp_size",
      action: "move",
    },
    {
      src: "/local_tz_offset",
      dst: "/event_properties/local_tz_offset",
      action: "move",
    },
    {
      src: "/eventn_ctx//local_tz_offset",
      dst: "/event_properties/local_tz_offset",
      action: "move",
    },
  ],
}

export default mapping
