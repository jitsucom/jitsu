declare type DestinationType = 'postgres' | 'bigquery' | 'redshift' | 'clickhouse' | 'snowflake' | 'facebook' | 'google_analytics' | 'webhook' | 'mysql';

declare interface DestinationData {
  readonly _type: DestinationType;
  readonly _id: string;
  readonly _uid: string;

  _mappings: DestinationMapping;
  _comment: string;
  _connectionTestOk: boolean;
  _connectionErrorMessage?: string;
  _formData: {
    mode: 'batch' | 'stream';
    [key: string]: any;
  };
  _onlyKeys: string[];
  _sources?: string[];
}
