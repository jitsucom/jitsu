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
import * as logos from "../../sources/lib/logos"
import { Destination } from "../types"

const icon = logos.bento

const bentoDestination: Destination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to Bento API filling as much Bento Events Properties as possible
      from original event data.
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "bento",
  type: "other",
  displayName: "Bento",
  community: true,
  parameters: [
    {
      id: "_super_type",
      constant: "npm",
    },
    {
      id: "_package",
      constant: "@tangible/jitsu-bento-destination@^1.0.0",
    },
    {
      id: "_formData.meta_package",
      displayName: "Community Package",
      type: descriptionType,
      defaultValue: (
        <>
          Implementation is based on <b>npm-package:</b>{" "}
          <a target={"_blank"} href={"https://www.npmjs.com/package/@tangible/jitsu-bento-destination"}>
            @tangible/jitsu-bento-destination
          </a>{" "}
          (version: ^1.0.0)
          <br />
          Developed by{" "}
          <a target={"_blank"} href={"https://teamtangible.com"}>
            Tangible Inc
          </a>
        </>
      ),
    },
    {
      id: "_formData.description",
      displayName: "Description",
      type: descriptionType,
      defaultValue: (
        <span>
          Jitsu can send events from JS SDK or Events API to Bento API filling as much Bento Events Properties as
          possible from original event data.
        </span>
      ),
    },
    {
      id: "_formData.site_key",
      displayName: "Bento Site Key/UUID",
      required: true,
      type: stringType,
    },
    {
      id: "_formData.your_integration_name",
      displayName: "Your integration name",
      required: true,
      type: stringType,
      documentation: <>Your integration name configured in Bento</>,
    },
    {
      id: "_formData.anonymous",
      displayName: "Send anonymous data",
      required: false,
      type: booleanType,
      documentation: <>Send anonymous data to Bento if true or all data including user data if false.</>,
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => "bento site key: " + cfg["_formData"]["site_key"],
  },
}

export default bentoDestination
