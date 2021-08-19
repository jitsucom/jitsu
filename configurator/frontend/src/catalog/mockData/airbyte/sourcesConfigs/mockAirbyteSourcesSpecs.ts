import {
  hubspot,
  mysql,
  mongodb,
  mailchimp,
  feshdesk,
  instagram,
  googleAds,
  microsoftTeams,
  postgres
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
  postgres
} as const);
