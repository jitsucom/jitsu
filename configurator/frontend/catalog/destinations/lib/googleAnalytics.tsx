import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { stringType } from "../../sources/types"

const icon = (
  <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 64 64">
    <g transform="matrix(.363638 0 0 .363636 -3.272763 -2.909091)">
      <path
        d="M130 29v132c0 14.77 10.2 23 21 23 10 0 21-7 21-23V30c0-13.54-10-22-21-22s-21 9.33-21 21z"
        fill="#f9ab00"
      />
      <g fill="#e37400">
        <path d="M75 96v65c0 14.77 10.2 23 21 23 10 0 21-7 21-23V97c0-13.54-10-22-21-22s-21 9.33-21 21z" />
        <circle cx="41" cy="163" r="21" />
      </g>
    </g>
  </svg>
)

const googleAnalytics = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to Google Analytics API. The common use-case is to send
      conversions or/and page views to Google to use that data for targeting and ad optimization
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "google_analytics",
  type: "other",
  displayName: "GoogleAnalytics",
  defaultTransform: `// Code of Google Analytics transform:
// https://github.com/jitsucom/jitsu/blob/master/server/storages/transform/google_analytics.js
return toGoogleAnalytics($)`,
  hidden: false,
  deprecated: false,
  parameters: [
    modeParameter("stream"),
    tableName(filteringExpressionDocumentation),
    {
      id: "_formData.gaTrackingId",
      displayName: "Tracking ID",
      required: true,
      type: stringType,
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => cfg["_formData"]["gaTrackingId"],
  },
} as const

export default googleAnalytics
