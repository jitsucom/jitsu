declare type DestinationType = 'postgres' | 'bigquery' | 'redshift' | 'clickhouse' | 'snowflake' | 'facebook' | 'google_analytics';

declare interface DestinationData {
  readonly _type: DestinationType;

  _mappings: any;
  _id: string;
  _uid: string;
  _comment: string;
  _connectionTestOk: boolean;
  _connectionErrorMessage: React.ReactNode;
  _mode: 'batch' | 'stream';
  _formData: {
    [key: string]: any;
  };
  _onlyKeys: string[];
  _sources: string[];
}
