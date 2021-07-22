import {
  amplitudeDestination,
  bigQueryDestination,
  clickHouseDestination,
  facebookDestination,
  hubspotDestination,
  googleAnalyticsDestination,
  postgresDestination,
  mysqlDestination,
  redshiftDestination,
  snowflakeDestination,
  webhookDestination
} from 'catalog/destinations/lib';

export const destinationsReferenceMap = {
  postgres: postgresDestination,
  mysql: mysqlDestination,
  bigquery: bigQueryDestination,
  redshift: redshiftDestination,
  clickhouse: clickHouseDestination,
  snowflake: snowflakeDestination,
  facebook: facebookDestination,
  google_analytics: googleAnalyticsDestination,
  webhook: webhookDestination,
  amplitude: amplitudeDestination,
  hubspot: hubspotDestination
} as const;

export const destinationsReferenceList = Object.values(destinationsReferenceMap);

export type DestinationStrictType = typeof destinationsReferenceMap[keyof typeof destinationsReferenceMap];