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

const icon = logos.plausible

const plausibleDestination: Destination = {
  description: (
    <>
      Jitsu can send events from JS SDK or Events API to Plausible API filling as much Plausible Events Properties as
      possible from original event data.
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "plausible",
  type: "other",
  community: true,
  displayName: "Plausible",
  parameters: [
    {
      id: "_super_type",
      constant: "npm",
    },
    {
      id: "_package",
      constant: "@tangible/jitsu-plausible-destination@^1.1.0",
    },
    {
      id: "_formData.meta_package",
      displayName: "Community Package",
      type: descriptionType,
      defaultValue: (
        <>
          Implementation is based on <b>npm-package:</b>{" "}
          <a target={"_blank"} href={"https://www.npmjs.com/package/@tangible/jitsu-plausible-destination"}>
            @tangible/jitsu-plausible-destination
          </a>{" "}
          (version: ^1.1.0)
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
          Jitsu can send events from JS SDK or Events API to Plausible API filling as much Plausible Events Properties
          as possible from original event data.
        </span>
      ),
    },
    {
      id: "_formData.plausible_domain",
      displayName: "Plausible Server base URL",
      required: true,
      type: stringType,
      defaultValue: "https://plausible.io",
      documentation: (
        <>
          Plausible server URL including protocol, e.g.: <code>https://plausible.io</code>
        </>
      ),
    },
    {
      id: "_formData.plausible_port",
      displayName: "Plausible server port",
      required: true,
      type: stringType,
      documentation: <>Plausible server port</>,
      defaultValue: "443",
    },
    {
      id: "_formData.anonymous",
      displayName: "Send anonymous data",
      required: false,
      type: booleanType,
      documentation: <>Send anonymous data to Plausible if true or all data including user data if false</>,
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => "",
  },
}

export default plausibleDestination
