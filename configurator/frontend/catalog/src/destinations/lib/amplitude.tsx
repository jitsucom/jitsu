import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { stringType } from "../../sources/types"

const icon = (
  <svg
    id="Layer_1"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    height="100%"
    width="100%"
    x="0px"
    y="0px"
    viewBox="0 0 200 200"
    enableBackground="new 0 0 200 200"
    xmlSpace="preserve"
  >
    <g id="Random-Assignments_2_">
      <g id="Amplitude-logomark" transform="translate(-10.000000, -10.000000)">
        <g id="Amplitude_logomark" transform="translate(10.000000, 10.000000)">
          <path
            id="Shape"
            fill="#00A7CF"
            d="M89.3,50.5c-0.5-0.7-1.1-1-1.7-1c-0.5,0-0.9,0.2-1.3,0.4C81.5,53.7,75,69.6,69.6,90.7l4.8,0.1 c9.4,0.1,19.1,0.2,28.7,0.4c-2.5-9.6-4.9-17.9-7.1-24.5C92.7,56.8,90.6,52.5,89.3,50.5z"
          />
          <path
            id="Shape_1_"
            fill="#00A7CF"
            d="M100,10c-49.7,0-90,40.3-90,90s40.3,90,90,90s90-40.3,90-90S149.7,10,100,10z M164.7,101.6 L164.7,101.6c-0.1,0.1-0.2,0.2-0.3,0.2l-0.1,0.1c-0.1,0-0.1,0.1-0.2,0.1c-0.1,0-0.1,0.1-0.2,0.1l0,0c-0.7,0.4-1.4,0.5-2.2,0.5 H119c0.3,1.4,0.7,3,1.1,4.8c2.3,10.1,8.5,36.9,15.1,36.9h0.1h0.1h0.1c5.1,0,7.8-7.4,13.5-23.8l0.1-0.2c0.9-2.6,2-5.6,3.1-8.7 l0.3-0.8l0,0c0.4-1,1.5-1.5,2.5-1.1c1,0.3,1.6,1.4,1.4,2.4l0,0l-0.2,0.8c-0.6,1.9-1.2,4.6-2,7.6c-3.4,14.2-8.6,35.7-21.9,35.7 h-0.1c-8.6-0.1-13.7-13.8-15.9-19.7c-4.1-11-7.2-22.7-10.2-34H66.9l-8.1,26.1l-0.1-0.1c-1,1.6-2.9,2.3-4.6,1.8s-3-2.1-3-4v-0.1 l0.5-2.9c1.1-6.7,2.5-13.7,4-20.7H38.9l-0.1-0.1c-3.1-0.5-5.3-3.1-5.3-6.2c0-3,2.1-5.6,5.1-6.1c0.6-0.1,1.3-0.1,1.9-0.1h0.8 c5.3,0.1,10.8,0.2,16.9,0.3c8.7-35.1,18.7-53,29.8-53c11.9,0,20.8,27.2,27.9,53.7l0,0.1c14.5,0.3,30.1,0.7,45.1,1.8l0.6,0.1 c0.2,0,0.5,0,0.7,0.1h0.1l0.1,0h0c1.8,0.4,3.3,1.7,3.7,3.5C166.8,98.6,166.2,100.5,164.7,101.6z"
          />
        </g>
      </g>
    </g>
  </svg>
)

const amplitudeDestination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to{" "}
      <a target="_blank" href="https://developers.amplitude.com/docs/http-api-v2>">
        Amplitude API
      </a>
      . Amplitude is an real-time analytics platform for marketers that can build dashboards to filter new users by
      country, user activity, retention rate and funnel audiences by custom events
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "amplitude",
  type: "other",
  displayName: "Amplitude",
  defaultTransform: `// Code of Amplitude transform:
// https://github.com/jitsucom/jitsu/blob/master/server/storages/transform/amplitude.js
return toAmplitude($)`,
  hidden: false,
  deprecated: false,
  ui: {
    icon,
    title: cfg => `API Key: ${cfg._formData.apiKey.substr(0, cfg._formData.apiKey.length / 2)}*****`,
    connectCmd: _ => null,
  },
  parameters: [
    modeParameter("stream"),
    tableName(filteringExpressionDocumentation),
    {
      id: "_formData.apiKey",
      displayName: "API Key",
      required: true,
      type: stringType,
      documentation: (
        <>
          Your Amplitude API Key from{" "}
          <a target="_blank" href="https://analytics.amplitude.com/">
            Project Settings
          </a>{" "}
          page.
        </>
      ),
    },
    {
      id: "_formData.endpoint",
      displayName: "API Endpoint",
      required: false,
      type: stringType,
      documentation: (
        <>
          Alternative Amplitude API endpoint
          <br />
          For project with EU data residency set:
          <br />
          <code>https://api.eu.amplitude.com/2/httpapi</code>
        </>
      ),
    },
  ],
} as const

export default amplitudeDestination
