import {
  bigQueryDestination,
  clickHouseDestination,
  facebookDestination,
  googleAnalyticsDestination,
  postgresDestination,
  redshiftDestination,
  snowflakeDestination
} from '@catalog/destinations/lib';
import { generatePath } from 'react-router-dom';
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';

export const destinationsReferenceMap = {
  postgres: postgresDestination,
  bigquery: bigQueryDestination,
  redshift: redshiftDestination,
  clickhouse: clickHouseDestination,
  snowflake: snowflakeDestination,
  facebook: facebookDestination,
  google_analytics: googleAnalyticsDestination
};

export const destinationsReferenceList = Object.keys(destinationsReferenceMap).map(key => destinationsReferenceMap[key]);

export const getGeneratedPath = (id: string) => generatePath(destinationPageRoutes.newDestination, { type: id });
