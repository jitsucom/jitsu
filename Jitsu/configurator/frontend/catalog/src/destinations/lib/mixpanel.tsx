import { booleanType, descriptionType, stringType } from "../../sources/types"
import React from "react"
import { Destination } from "../types"

const icon = (
  <svg width="100%" height="100%" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="28" height="28" rx="4" fill="#4F44E0" />
    <circle cx="8" cy="14" r="3" fill="white" />
    <circle cx="16" cy="14" r="2" fill="white" />
    <circle cx="22" cy="14" r="1" fill="white" />
  </svg>
)

const mixpanelDestination: Destination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to Mixpanel Ingestion API filling as much Mixpanel Events
      Properties as possible from original event data.
      <br />
      Implementation is based on npm-package:
      <br />
      https://www.npmjs.com/package/mixpanel-destination
      <br />
      Source code:
      <br />
      https://github.com/jitsucom/jitsu-mixpanel
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "mixpanel",
  type: "other",
  displayName: "Mixpanel",
  deprecated: true,
  deprecatedReplacement: "mixpanel2",
  parameters: [
    {
      id: "_super_type",
      constant: "npm",
    },
    {
      id: "_package",
      constant: "mixpanel-destination",
    },
    {
      id: "_formData.deprecation",
      displayName: "Deprecation Notice",
      type: descriptionType,
      defaultValue: (
        <span className={"text-warning"}>
          <b>
            This version is deprecated because newer version is available. Please replace it with <b>Mixpanel v2</b>{" "}
            destination.
          </b>
        </span>
      ),
    },
    {
      id: "_formData.description",
      displayName: "Description",
      required: false,
      type: descriptionType,
      defaultValue: (
        <span>
          Jitsu sends events to Mixpanel Ingestion API filling as much Mixpanel Events Properties as possible from
          original event data.
          <br />
          Mixpanel destination may also send User Profiles data to Mixpanel accounts that have User Profiles enabled.
          <br />
          <br />
          Implementation is based on <b>npm-package:</b>{" "}
          <a target={"_blank"} href={"https://www.npmjs.com/package/mixpanel-destination"}>
            mixpanel-destination
          </a>
          <br />
          Source code on{" "}
          <a target={"_blank"} href={"https://github.com/jitsucom/jitsu-mixpanel"}>
            Jitsu Github
          </a>
        </span>
      ),
    },
    {
      id: "_formData.token",
      displayName: "Project Token",
      required: true,
      type: stringType,
      documentation: (
        <>
          <a target="_blank" href="https://developer.mixpanel.com/reference/project-token">
            Project Token
          </a>
          . A project's token can be found in the Access Keys section of a project's settings overview page:{" "}
          <a target="_blank" href="https://mixpanel.com/settings/project/">
            https://mixpanel.com/settings/project/
          </a>
        </>
      ),
    },
    {
      id: "_formData.users_enabled",
      displayName: "Enable User Profiles",
      required: false,
      type: booleanType,
      documentation: (
        <>
          Enables Mixpanel destination to work with User Profiles. <br /> See{" "}
          <a target="_blank" href="https://jitsu.com/docs/destinations-configuration/mixpanel#user-profiles">
            User Profiles
          </a>{" "}
          section of Documentation
        </>
      ),
    },
    {
      id: "_formData.anonymous_users_enabled",
      displayName: "User Profiles for anonymous users",
      required: false,
      type: booleanType,
      documentation: (
        <>
          Enables updating User Profiles for anonymous users. Requires <b>Enable User Profiles</b> enabled.
        </>
      ),
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => ".",
  },
}

export default mixpanelDestination
