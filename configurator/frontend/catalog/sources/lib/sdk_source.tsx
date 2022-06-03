import * as logos from "./logos"
import { SdkSource } from "../types"
import * as React from "react"

export const allSdkSources: SdkSource[] = [
  {
    id: "sdk-airtable",
    pic: logos.airtable,
    package_name: "jitsu-airtable-source",
    package_version: "^0.7.2",
    displayName: "Airtable",
    stable: true,
  },
  {
    id: "sdk-helpscout",
    pic: logos.tap_helpscout,
    package_name: "jitsu-helpscout-source",
    package_version: "^0.7.3",
    displayName: "Helpscout (SDK)",
    stable: true,
  },
]
