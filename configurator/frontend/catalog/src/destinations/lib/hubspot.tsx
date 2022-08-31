import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { stringType } from "../../sources/types"

const icon = (
  <svg
    id="Layer_1"
    height="100%"
    width="100%"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    x="0px"
    y="0px"
    viewBox="0 0 200 200"
    enableBackground="new 0 0 200 200"
    xmlSpace="preserve"
  >
    <rect fill="#F47622" width={200} height={200} />
    <path
      fill="#FFFFFF"
      d="M158.3,96.4c-2.9-5.5-7.3-9.5-12.8-12.8c-4-2.2-8.4-4-13.1-4.4V62.1c4.7-2.2,7.7-6.6,7.7-11.7 c0-6.9-5.8-12.8-12.8-12.8c-6.9,0-12.8,5.8-12.8,12.8c0,5.1,2.9,9.8,7.7,11.7v16.8c-4,0.7-8,1.8-11.7,3.6 C103.3,77,78.9,58.4,65,47.9c0.4-1.1,0.7-2.6,0.7-3.6C65.4,36.6,59.2,30,51.1,30s-14.2,6.6-14.2,14.2c0,8,6.2,14.2,14.2,14.2 c2.6,0,5.1-0.7,7.3-2.2l2.9,2.2l40.8,29.9c-2.2,1.8-4,4.4-5.8,6.9c-3.3,5.1-5.1,10.9-5.1,17.1c0,0.4,0,0.7,0,1.5 c0,4.4,0.7,8.4,2.2,12.4c1.1,3.3,2.9,6.6,5.1,9.1l-13.5,13.5c-1.1-0.4-2.6-0.7-3.6-0.7c-2.9,0-5.8,1.1-7.7,3.3 c-2.2,2.2-3.3,4.7-3.3,7.7c0,2.9,1.1,5.8,3.3,7.7c2.2,2.2,4.7,3.3,7.7,3.3c2.9,0,5.8-1.1,7.7-3.3c2.2-2.2,3.3-4.7,3.3-7.7 c0-1.1,0-2.2-0.4-3.3l14.2-14.2c1.8,1.5,4,2.6,6.2,3.3c4.4,1.8,9.1,2.9,14.6,2.9c0.4,0,0.7,0,1.1,0c5.8,0,11.3-1.5,16.8-4 c5.5-2.9,9.8-6.9,13.1-12.4c3.3-5.1,5.1-10.9,5.1-17.5v-0.4C162.7,107.7,161.2,101.8,158.3,96.4z M140.8,125.5 c-3.6,4.4-8,6.6-13.1,6.6c-0.4,0-0.4,0-0.7,0c-2.9,0-5.5-0.7-8.4-1.8c-2.9-1.5-5.5-3.6-7.3-6.6s-2.9-5.8-2.9-8.7c0-0.4,0-0.7,0-1.1 c0-3.3,0.7-6.2,2.2-9.1c1.5-2.9,4-5.5,6.9-7.3c2.9-1.8,5.8-2.9,9.5-2.9h0.4c3.3,0,6.2,0.7,8.8,2.2c2.9,1.5,5.1,3.6,6.9,6.2 c1.8,2.6,2.9,5.8,3.3,8.8c0,0.7,0,1.1,0,1.8C145.9,118.2,144.5,121.9,140.8,125.5z"
    />
  </svg>
)

const hubspotDestination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to{" "}
      <a target="_blank" href="https://developers.hubspot.com/docs/api/overview">
        HubSpot
      </a>
      . HubSpot is a marketing and sales platform that helps companies to track and account customers path from website
      visitors, leads to payment clients{" "}
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "hubspot",
  type: "other",
  displayName: "HubSpot",
  defaultTransform: "",
  hidden: false,
  deprecated: false,
  ui: {
    icon,
    title: cfg => `Hub ID: ${cfg._formData.hubID}`,
    connectCmd: _ => null,
  },
  parameters: [
    modeParameter("stream"),
    {
      id: "_formData.accessToken",
      displayName: "Private App Access Token",
      required: false,
      type: stringType,
      documentation: (
        <>
          HubSpot Private App Access Token. Read{" "}
          <a
            target="_blank"
            href="https://developers.hubspot.com/docs/api/private-apps#make-api-calls-with-your-app-s-access-token"
          >
            How to obtain Access Token
          </a>
          . You need to enable following scopes for you private app: <code>crm.objects.contacts.write</code>{" "}
          <code>crm.schemas.contacts.read</code>
        </>
      ),
    },
    {
      id: "_formData.apiKey",
      displayName: "API Key (deprecated)",
      required: false,
      type: stringType,
      documentation: (
        <>
          Your HubSpot API Key. Deprecated in favor of <b>Private App Access Token</b>. Read{" "}
          <a
            target="_blank"
            href="https://developers.hubspot.com/docs/api/migrate-an-api-key-integration-to-a-private-app"
          >
            How to migrate to Private App Access Token
          </a>
        </>
      ),
    },
    {
      id: "_formData.hubID",
      displayName: "Hub ID",
      required: false,
      type: stringType,
      documentation: (
        <>
          Your HubSpot Hub ID (in number format, like 453283). Read{" "}
          <a target="_blank" href="http://help.hubspot.com/articles/KCS_Article/Account/Where-can-I-find-my-HUB-ID">
            How to obtain HubSpot Hub ID
          </a>
        </>
      ),
    },
  ],
} as const

export default hubspotDestination
