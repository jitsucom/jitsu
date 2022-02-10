import {
  hubspot,
  mysql,
  mongodb,
  mailchimp,
  feshdesk,
  instagram,
  googleAds,
  microsoftTeams,
  postgres,
  braintree,
  github,
} from "./airbyte"

export const allMockAirbyteSourcesSpecs = Object.freeze({
  hubspot,
  mysql,
  mongodb,
  mailchimp,
  feshdesk,
  instagram,
  googleAds,
  microsoftTeams,
  postgres,
  braintree,
  github,
} as const)
