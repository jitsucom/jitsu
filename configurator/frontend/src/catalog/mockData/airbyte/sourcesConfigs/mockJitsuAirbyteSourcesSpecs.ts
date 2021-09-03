import {
  hubspot,
  mysql,
  mongodb,
  googleAds,
  postgres,
  braintree
} from './jitsu';

export const allMockJitsuAirbyteSourceConnectors = Object.freeze({
  hubspot,
  mysql,
  mongodb,
  googleAds,
  postgres,
  braintree
} as const);
