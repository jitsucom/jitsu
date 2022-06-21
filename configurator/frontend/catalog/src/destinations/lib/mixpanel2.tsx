import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import {
  arrayOf,
  booleanType,
  descriptionType,
  jsType,
  passwordType,
  selectionType,
  stringType,
} from "../../sources/types"

const icon = (
  <svg width="100%" height="100%" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="28" height="28" rx="4" fill="#4F44E0" />
    <circle cx="8" cy="14" r="3" fill="white" />
    <circle cx="16" cy="14" r="2" fill="white" />
    <circle cx="22" cy="14" r="1" fill="white" />
  </svg>
)

const mixpanelDestination = {
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
  id: "mixpanel2",
  type: "other",
  displayName: "Mixpanel v2",
  defaultTransform: "",
  hidden: false,
  deprecated: false,
  parameters: [
    {
      id: "_super_type",
      constant: "npm",
    },
    {
      id: "_package",
      constant: "jitsu-mixpanel-destination@^0.2.2",
    },
    {
      id: "_formData.description",
      displayName: "Description",
      type: descriptionType,
      defaultValue: (
        <span>
          Jitsu sends events to Mixpanel Ingestion API filling as much Mixpanel Events Properties as possible from
          original event data.
          <br />
          Mixpanel destination may also send User Profiles data to Mixpanel accounts that have User Profiles enabled.
        </span>
      ),
    },
    {
      id: "_formData.meta_package",
      displayName: "Package",
      type: descriptionType,
      defaultValue: (
        <>
          Implementation is based on <b>npm-package:</b>{" "}
          <a target={"_blank"} href={"https://www.npmjs.com/package/jitsu-mixpanel-destination"}>
            jitsu-mixpanel-destination
          </a>{" "}
          (version: ^0.2.2)
          <br />
          Source code on{" "}
          <a target={"_blank"} href={"https://github.com/jitsucom/jitsu-mixpanel"}>
            Jitsu Github
          </a>
        </>
      ),
    },
    {
      id: "_formData.project_id",
      displayName: "Project ID",
      required: true,
      type: stringType,
      documentation: (
        <>
          ID of Mixpanel project. Can be found in the Project Details section of a project's settings overview page:{" "}
          <a target="_blank" href="https://mixpanel.com/settings/project/">
            https://mixpanel.com/settings/project/
          </a>
        </>
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
      id: "_formData.api_secret",
      displayName: "API Secret",
      required: true,
      type: stringType,
      documentation: (
        <>
          <a target="_blank" href="https://developer.mixpanel.com/reference/project-secret">
            API Secret
          </a>
          . A project's API Secret can be found in the Access Keys section of a project's settings overview page:{" "}
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
    title: cfg => "project id: " + cfg["_formData"]["project_id"],
  },
} as const

export default mixpanelDestination
