import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { stringType } from "../../sources/types"
import { Destination } from "../types"

const icon = (
  <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 48 48">
    <linearGradient
      id="Ld6sqrtcxMyckEl6xeDdMa"
      x1="9.993"
      x2="40.615"
      y1="9.993"
      y2="40.615"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" stopColor="#2aa4f4" />
      <stop offset="1" stopColor="#007ad9" />
    </linearGradient>
    <path
      fill="url(#Ld6sqrtcxMyckEl6xeDdMa)"
      d="M24,4C12.954,4,4,12.954,4,24s8.954,20,20,20s20-8.954,20-20S35.046,4,24,4z"
    />
    <path
      fill="#fff"
      d="M26.707,29.301h5.176l0.813-5.258h-5.989v-2.874c0-2.184,0.714-4.121,2.757-4.121h3.283V12.46 c-0.577-0.078-1.797-0.248-4.102-0.248c-4.814,0-7.636,2.542-7.636,8.334v3.498H16.06v5.258h4.948v14.452 C21.988,43.9,22.981,44,24,44c0.921,0,1.82-0.084,2.707-0.204V29.301z"
    />
  </svg>
)

const facebookDestination: Destination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to Facebook Marketing API. The common use-case is to send
      conversions or/and page views to Facebook to use that data for targeting and ad optimization
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "facebook",
  type: "other",
  displayName: "Facebook",
  defaultTransform: `// Code of Facebook transform:
// https://github.com/jitsucom/jitsu/blob/master/server/storages/transform/facebook.js
return toFacebook($)`,
  ui: {
    icon,
    title: cfg => `Pixel ID: ${cfg._formData.fbPixelId}`,
    connectCmd: _ => null,
  },
  parameters: [
    modeParameter("stream"),
    tableName(filteringExpressionDocumentation),
    {
      id: "_formData.fbPixelId",
      displayName: "Pixel ID",
      required: true,
      type: stringType,
      documentation: (
        <>
          Your Facebook Pixel ID or{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={"https://www.facebook.com/ads/manager/pixel/facebook_pixel/"}
          >
            create a new one
          </a>
          .
          <br />
          Read more about{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={"https://developers.facebook.com/docs/marketing-api/conversions-api/get-started#-------"}
          >
            Facebook conversion API
          </a>
        </>
      ),
    },
    {
      id: "_formData.fbAccessToken",
      displayName: "Access Token",
      required: true,
      type: stringType,
      documentation: (
        <>
          Your Facebook Access Token.
          <br />
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={"https://developers.facebook.com/docs/marketing-api/conversions-api/get-started#--------------"}
          >
            Read more
          </a>
        </>
      ),
    },
  ],
}

export default facebookDestination
