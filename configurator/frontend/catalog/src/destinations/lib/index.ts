import postgresDestination from "./postgres"
import mysqlDestination from "./mysql"
import bigQueryDestination from "./bigquery"
import redshiftDestination from "./redshift"
import clickHouseDestination from "./clickhouse"
import snowflakeDestination from "./snowflake"

import facebookDestination from "./facebook"
import googleAnalyticsDestination from "./googleAnalytics"
import webhookDestination from "./webhook"
import amplitudeDestination from "./amplitude"
import hubspotDestination from "./hubspot"
import dbtcloudDestination from "./dbtcloud"
import s3Destination from "./s3"
import gcsDestination from "./googleCloudStorage"
import mixpanelDestination from "./mixpanel"
import mixpanel2Destination from "./mixpanel2"
import bentoDestination from "./bento"
import plausibleDestination from "./plausible"
import elasticsearchDestination from "./elasticsearch"

import npmDestination from "./npm"

import { Destination } from "../types"
import tagDestination from "./tag"

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
  s3Destination,
  gcsDestination,
  mixpanelDestination,
  mixpanel2Destination,
  tagDestination,
  bentoDestination,
  plausibleDestination,
  elasticsearchDestination,
}

export const destinationsReferenceMap: { [key: string]: Destination } = {
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
  s3: s3Destination,
  gcs: gcsDestination,
  mixpanel: mixpanelDestination,
  mixpanel2: mixpanel2Destination,
  tag: tagDestination,
  bento: bentoDestination,
  plausible: plausibleDestination,
  elasticsearch: elasticsearchDestination,
}

export const destinationsReferenceList = Object.values(destinationsReferenceMap)

export type DestinationType = typeof destinationsReferenceList[number]["id"]
