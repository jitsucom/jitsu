import * as logos from "./logos"
import { SdkSource } from "../types"
import * as React from "react"

export const allSdkSources: SdkSource[] = [
  {
    id: "sdk-airtable",
    pic: logos.airtable,
    package_name: "jitsu-airtable-source",
    package_version: "latest",
    displayName: "Airtable",
    stable: true,
  }
]

