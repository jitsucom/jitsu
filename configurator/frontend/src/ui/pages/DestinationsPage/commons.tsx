import {
  BQConfig,
  ClickHouseConfig,
  DestinationConfig,
  FacebookConversionConfig,
  GoogleAnalyticsConfig,
  PostgresConfig,
  RedshiftConfig,
  SnowflakeConfig
} from '@./lib/services/destinations';
import { FieldMappings, Mapping } from '@./lib/services/mappings';
import ApplicationServices from '@./lib/services/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
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

export const SERIALIZABLE_CLASSES = [
  DestinationConfig,
  PostgresConfig,
  ClickHouseConfig,
  RedshiftConfig,
  FieldMappings,
  Mapping,
  SnowflakeConfig,
  BQConfig,
  GoogleAnalyticsConfig,
  FacebookConversionConfig
];

export async function loadDestinations(appServices: ApplicationServices): Promise<DestinationConfig[]> {
  let destinations = await appServices.storageService.get('destinations', appServices.activeProject.id);

  return destinations && destinations.destinations
    ? Marshal.newInstance(destinations.destinations, SERIALIZABLE_CLASSES)
    : [];
}

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
