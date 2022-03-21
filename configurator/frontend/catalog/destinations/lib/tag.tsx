import { modeParameter } from "./common"
import { descriptionType, htmlType, stringType } from "../../sources/types"

const icon = (
  <svg
    version="1.1"
    id="Capa_1"
    xmlns="http://www.w3.org/2000/svg"
    x="0px"
    y="0px"
    width="100%"
    height="100%"
    viewBox="0 0 550.801 550.801"
  >
    <g>
      <g>
        <path
          fill="white"
          d="M475.095,131.986c-0.032-2.525-0.844-5.015-2.568-6.992L366.324,3.684c-0.021-0.029-0.053-0.045-0.084-0.071
			c-0.633-0.712-1.36-1.289-2.141-1.803c-0.232-0.15-0.465-0.29-0.707-0.422c-0.686-0.372-1.393-0.669-2.131-0.891
			c-0.2-0.058-0.379-0.145-0.59-0.188C359.87,0.114,359.037,0,358.203,0H97.2C85.292,0,75.6,9.688,75.6,21.601v507.6
			c0,11.907,9.692,21.601,21.6,21.601H453.6c11.908,0,21.601-9.693,21.601-21.601V133.197
			C475.2,132.791,475.137,132.393,475.095,131.986z M97.2,21.601h250.203v110.51c0,5.962,4.831,10.8,10.8,10.8H453.6l0.011,223.837
			H97.2V21.601z M180.457,499.311h-21.642v-41.26h-35.744v41.26h-21.769v-98.613h21.769v37.895h35.744v-37.895h21.642V499.311z
			 M265.874,419.429h-26.188v79.882h-21.779v-79.882h-25.763v-18.731h73.73V419.429z M359.416,499.311l-1.424-37.747
			c-0.422-11.85-0.854-26.188-0.854-40.532h-0.422c-2.996,12.583-6.982,26.631-10.685,38.19l-11.665,38.476H317.43l-10.252-38.18
			c-3.133-11.56-6.412-25.608-8.69-38.486h-0.285c-0.564,13.321-1.002,28.535-1.692,40.827l-1.72,37.457h-20.07l6.117-98.613h28.903
			l9.397,32.917c2.995,11.412,5.975,23.704,8.121,35.264h0.422c2.711-11.417,5.975-24.427,9.112-35.406l10.252-32.774h28.329
			l5.263,98.613h-21.221V499.311z M457.238,499.311h-59.938v-98.613h21.779v79.882h38.153v18.731H457.238z"
        />
        <polygon
          fill="white"
          points="154.132,249.086 236.872,287.523 236.872,269.254 174.295,241.851 174.295,241.505 236.872,214.094
			236.872,195.827 154.132,234.262 		"
        />
        <polygon fill="white" points="249.642,294.416 267.047,294.416 303.93,169.452 286.527,169.452 		" />
        <polygon
          fill="white"
          points="313.938,214.094 377.895,241.505 377.895,241.851 313.938,269.254 313.938,287.523 396.668,249.605
			396.668,233.745 313.938,195.827 		"
        />
      </g>
    </g>
  </svg>
)

const tagDestination = {
  description: (
    <>
      Destination Tag installs provided HTML/Javascript tag to the website page. Destination triggered by incoming event
      from Javascript SDK.
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "tag",
  type: "other",
  displayName: "Destination Tag",
  defaultTransform: "",
  hidden: false,
  deprecated: false,
  parameters: [
    {
      id: "_formData.description",
      displayName: "Description",
      required: false,
      type: descriptionType,
      defaultValue: (
        <span>
          Destination Tag installs provided HTML/Javascript tag to the website page.
          <br />
          Destination triggered by incoming event from Javascript SDK.
          <br />
          <br />
          Required version of Javascript SDK {">="} 2.5.0
          <br />
          <br />
          Read more in{" "}
          <a target={"_blank"} href={"https://jitsu.com/docs/other-features/destination-tags"}>
            Documentation
          </a>
        </span>
      ),
    },
    modeParameter("synchronous"),
    {
      id: `_formData.tagId`,
      displayName: "Tag ID",
      documentation: (
        <>
          Unique ID of Tag. By default:
          <br />
          <code>tagid = destinationId</code>
          <br />
          Can be used during debugging.
        </>
      ),
      required: false,
      type: stringType,
    },
    {
      id: `_formData.filter`,
      displayName: "Events Filter",
      jsDebugger: "string",
      defaultValue: '$.event_type == "pageview"',
      documentation: (
        <>
          Run this tag only for certain events. Use javascript expression to filter evens. E.g. based on event type:{" "}
          <code>$.event_type == "pageview"</code>
          <br />
          Empty value means that tag will be triggered by all events.
        </>
      ),
      required: false,
      type: stringType,
    },
    {
      id: "_formData.template",
      displayName: "HTML/Javascript code",
      required: true,
      type: htmlType,
      documentation: (
        <>
          HTML/Javascript code of your tag. Be sure to wrap Javascript snippets with <code>{"<script></script>"}</code>.
          <br />
          You can use variables from incoming event. E.g.:
          <br />
          <code>{"{{ .user.id }}"}</code>
        </>
      ),
    },
  ],
  ui: {
    icon,
    title: cfg => "",
    connectCmd: null,
  },
} as const

export default tagDestination
