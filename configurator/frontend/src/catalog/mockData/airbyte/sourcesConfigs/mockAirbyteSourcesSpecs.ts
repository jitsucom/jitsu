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
  braintree
} from './airbyte';

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
  braintree
} as const);
