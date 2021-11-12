import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { arrayOf, booleanType, jsType, passwordType, selectionType, stringType } from "../../sources/types"

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
      Jitsu can send events from JS SDK or Events API to Google Analytics API to any HTTP(s) endpoint. Data format is
      fully configurable with an easy template language
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "mixpanel",
  type: "other",
  displayName: "Mixpanel",
  defaultTransform: "return toMixpanel($, /* User Profile data */ {}, /* Override event name*/ '')",
  hidden: false,
  parameters: [
    {
      id: "_super_type",
      constant: "webhook",
    },
    modeParameter("stream"),
    {
      id: "_formData._token",
      displayName: "Project Token",
      required: true,
      type: stringType,
    },
    {
      id: "_formData._users_enabled",
      displayName: "Enable User Profiles",
      required: false,
      type: booleanType,
      documentation: <>Enable sending User Profiles data</>,
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => cfg["_formData"]["_projectId"],
  },
} as const

export default mixpanelDestination
