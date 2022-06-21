import { AirbyteSource } from "../../../sources/types"
import * as logos from "../../../sources/lib/logos"

export const allMockAirbyteSources: AirbyteSource[] = [
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-hubspot",
    displayName: "Hubspot",
    stable: false,
  },
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-mysql",
    displayName: "MySQL",
    stable: false,
  },
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-mongodb",
    displayName: "MongoDB",
    stable: false,
  },
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-freshdesk",
    displayName: "Freshdesk",
    stable: false,
  },
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-mailchimp",
    displayName: "Mailchimp",
    stable: false,
  },
  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-instagram",
    displayName: "Instagram",
    stable: false,
  },

  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-google-ads",
    displayName: "Google Ads",
    stable: false,
  },

  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-microsoft-teams",
    displayName: "Microsoft Teams",
    stable: false,
  },

  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-postgres",
    displayName: "Postgres",
    stable: false,
  },

  {
    pic: logos.airbyte,
    docker_image_name: "airbyte/source-braintree",
    displayName: "Braintree",
    stable: false,
  },
]
