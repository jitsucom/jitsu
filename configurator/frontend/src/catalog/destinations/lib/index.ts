import postgresDestination from './postgres';
import bigQueryDestination from './bigquery';
import redshiftDestination from './redshift';
import clickHouseDestination from './clickhouse';
import snowflakeDestination from './snowflake';

import facebookDestination from './facebook';
import googleAnalyticsDestination from './googleAnalytics';
import webhookDestination from './webhook';
import amplitudeDestination from './amplitude';
import hubspotDestination from './hubspot';

export {
  postgresDestination,
  bigQueryDestination,
  redshiftDestination,
  clickHouseDestination,
  snowflakeDestination,
  facebookDestination,
  googleAnalyticsDestination,
  webhookDestination,
  amplitudeDestination,
  hubspotDestination
}

export const destinationsReferenceMap = {
  postgres: postgresDestination,
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

export const destinationsReferenceList = Object.values(
  destinationsReferenceMap
);

export type DestinationStrictType =
  typeof destinationsReferenceMap[keyof typeof destinationsReferenceMap];