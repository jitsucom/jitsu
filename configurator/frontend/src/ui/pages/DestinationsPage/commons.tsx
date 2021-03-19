import {
  BQConfig,
  ClickHouseConfig,
  DestinationConfig, FacebookConversionConfig, GoogleAnalyticsConfig,
  PostgresConfig,
  RedshiftConfig,
  SnowflakeConfig
} from "@./lib/services/destinations";
import { FieldMappings, Mapping } from "@./lib/services/mappings";
import ApplicationServices from "@./lib/services/ApplicationServices";
import Marshal from "@./lib/commons/marshalling";

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
  let serializedDestinations = destinations && destinations.destinations
    ? Marshal.newInstance(destinations.destinations, SERIALIZABLE_CLASSES)
    : [];
  return serializedDestinations;
}