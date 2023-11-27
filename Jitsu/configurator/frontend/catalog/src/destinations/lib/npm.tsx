import { filteringExpressionDocumentation, modeParameter, tableName } from "./common"
import { arrayOf, jsType, selectionType, stringType } from "../../sources/types"
import { Destination } from "../types"

const icon = (
  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100%" height="100%" viewBox="0 0 18 7">
    <path
      fill="#CB3837"
      d="M0,0h18v6H9v1H5V6H0V0z M1,5h2V2h1v3h1V1H1V5z M6,1v5h2V5h2V1H6z M8,2h1v2H8V2z M11,1v4h2V2h1v3h1V2h1v3h1V1H11z"
    />
    <polygon fill="#FFFFFF" points="1,5 3,5 3,2 4,2 4,5 5,5 5,1 1,1 " />
    <path fill="#FFFFFF" d="M6,1v5h2V5h2V1H6z M9,4H8V2h1V4z" />
    <polygon fill="#FFFFFF" points="11,1 11,5 13,5 13,2 14,2 14,5 15,5 15,2 16,2 16,5 17,5 17,1 " />
  </svg>
)

const npmDestination: Destination = {
  description: <></>,
  syncFromSourcesStatus: "not_supported",
  id: "npm",
  type: "other",
  defaultTransform: "return exports.adapter($, globalThis)",
  displayName: "External package (NPM)",
  hidden: true,
  parameters: [
    modeParameter("stream"),
    {
      id: "_package",
      displayName: "Package",
      required: true,
      type: stringType,
      documentation: <>Package name or tarball URL</>,
    },
  ],
  ui: {
    icon,
    connectCmd: null,
    title: cfg => cfg["_package"],
  },
}

export default npmDestination
