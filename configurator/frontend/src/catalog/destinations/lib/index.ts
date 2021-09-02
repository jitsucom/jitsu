import postgresDestination from './postgres';
import mysqlDestination from './mysql';
import bigQueryDestination from './bigquery';
import redshiftDestination from './redshift';
import clickHouseDestination from './clickhouse';
import snowflakeDestination from './snowflake';

import facebookDestination from './facebook';
import googleAnalyticsDestination from './googleAnalytics';
import webhookDestination from './webhook';
import amplitudeDestination from './amplitude';
import hubspotDestination from './hubspot';
import dbtcloudDestination from './dbtcloud';
import s3Destination from './s3';

export {
  postgresDestination,
  mysqlDestination,
  bigQueryDestination,
  redshiftDestination,
  clickHouseDestination,
  snowflakeDestination,
  facebookDestination,
  googleAnalyticsDestination,
  webhookDestination,
  amplitudeDestination,
  hubspotDestination,
  dbtcloudDestination,
  s3Destination
}

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
  hubspot: hubspotDestination,
  dbtcloud: dbtcloudDestination,
  s3: s3Destination
} as const;

export type DestinationReference =
  typeof destinationsReferenceMap[keyof typeof destinationsReferenceMap];

export const destinationsReferenceList = Object.values(
  destinationsReferenceMap
);