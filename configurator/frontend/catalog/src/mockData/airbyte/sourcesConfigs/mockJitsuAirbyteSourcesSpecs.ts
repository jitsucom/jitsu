import { hubspot, mysql, mongodb, googleAds, postgres, braintree, github } from "./jitsu"

export const allMockJitsuAirbyteSourceConnectors = Object.freeze({
  hubspot,
  mysql,
  mongodb,
  googleAds,
  postgres,
  braintree,
  github,
} as const)
