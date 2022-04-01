import { DestinationConfigurationTemplate } from "../types"

const mapping: DestinationConfigurationTemplate = {
  displayName: "Facebook Pixel",
  comment: (
    <>
      This templates converts incoming events to{" "}
      <a target="_blank" href="https://developers.facebook.com/docs/marketing-api/conversions-api/">
        Facebook conversion (pixel)
      </a>{" "}
      API calls. Make sure you use Facebook destination, otherwise configuration won't make much sense
    </>
  ),
  keepUnmappedFields: false,
  mappings: [
    {
      src: "/event_type",
      dst: "/event_name",
      action: "move",
    },
    {
      src: "/eventn_ctx/event_id",
      dst: "/event_id",
      action: "move",
    },
    {
      src: "/eventn_ctx_event_id",
      dst: "/event_id",
      action: "move",
    },
    {
      src: "/eventn_ctx/url",
      dst: "/event_source_url",
      action: "move",
    },
    {
      src: "/url",
      dst: "/event_source_url",
      action: "move",
    },
    {
      src: "/source_ip",
      dst: "/user_data/client_ip_address",
      action: "move",
    },
    {
      src: "/eventn_ctx/user/email",
      dst: "/user_data/em",
      action: "move",
    },
    {
      src: "/user/email",
      dst: "/user_data/em",
      action: "move",
    },
    {
      src: "/eventn_ctx/user_agent",
      dst: "/user_data/client_user_agent",
      action: "move",
    },
    {
      src: "/user_agent",
      dst: "/user_data/client_user_agent",
      action: "move",
    },
  ],
}

export default mapping
