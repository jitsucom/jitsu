import { hubspot, mysql, mongodb, googleAds, postgres } from './jitsu';

export const allMockJitsuAirbyteSourceConnectors = Object.freeze({
  hubspot,
  mysql,
  mongodb,
  googleAds,
  postgres
} as const);
