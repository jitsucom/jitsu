import {
  bigQueryDestination,
  clickHouseDestination,
  facebookDestination,
  googleAnalyticsDestination,
  postgresDestination,
  redshiftDestination,
  snowflakeDestination,
  webhookDestination
} from '@catalog/destinations/lib';

export const destinationsReferenceMap = {
  postgres: postgresDestination,
  bigquery: bigQueryDestination,
  redshift: redshiftDestination,
  clickhouse: clickHouseDestination,
  snowflake: snowflakeDestination,
  facebook: facebookDestination,
  google_analytics: googleAnalyticsDestination,
  webhook: webhookDestination
};

export const destinationsReferenceList = Object.keys(destinationsReferenceMap).map(key => destinationsReferenceMap[key]);
