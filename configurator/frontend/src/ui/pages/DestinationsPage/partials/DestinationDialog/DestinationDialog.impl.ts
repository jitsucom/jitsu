import SnowFlakeDestinationDialog from "./SnowFlakeDestinationDialog";
import RedshiftDestinationDialog from "./RedshiftDestinationDialog";
import PostgresDestinationDialog from "./PostgresDestinationDialog";
import GoogleAnalyticsDestinationDialog from "./GoogleAnalyticsDestinationDialog";
import FacebookConversionDestinationDialog  from "./FacebookConversionDestinationDialog";
import ClickHouseDestinationDialog from "./ClickHouseDestinationDialog";
import BigQueryDestinationDialog from "./BiqQueryDestinationDialog";

export const dialogsByType = {
  postgres: PostgresDestinationDialog,
  clickhouse: ClickHouseDestinationDialog,
  redshift: RedshiftDestinationDialog,
  snowflake: SnowFlakeDestinationDialog,
  bigquery: BigQueryDestinationDialog,
  google_analytics: GoogleAnalyticsDestinationDialog,
  facebook: FacebookConversionDestinationDialog
};
