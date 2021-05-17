import postgresDestination from './postgres';
import bigQueryDestination from './bigquery';
import redshiftDestination from './redshift';
import clickHouseDestination from './clickhouse';
import snowflakeDestination from './snowflake';

import facebookDestination from './facebook';
import googleAnalyticsDestination from './googleAnalytics';
import webhookDestination from "@catalog/destinations/lib/webhook";

export {
  postgresDestination,
  bigQueryDestination,
  redshiftDestination,
  clickHouseDestination,
  snowflakeDestination,
  facebookDestination,
  googleAnalyticsDestination,
  webhookDestination
}