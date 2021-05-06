declare type DestinationType = 'postgres' | 'bigquery' | 'redshift' | 'clickhouse' | 'snowflake' | 'facebook' | 'google_analytics';

declare interface DestinationData {
  readonly _type: DestinationType;

  _mappings: Mapping;
  _id: string;
  _uid: string;
  _comment: string;
  _connectionTestOk: boolean;
  _connectionErrorMessage?: string;
  _formData: {
    mode: 'batch' | 'stream';
    [key: string]: any;
  };
  _onlyKeys: string[];
  _sources: string[];
}
