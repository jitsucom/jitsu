declare type DestinationType = 'postgres' | 'bigquery' | 'redshift' | 'clickhouse' | 'snowflake' | 'facebook' | 'google_analytics';

declare interface DestinationData {
  // private _mappings: FieldMappings = new FieldMappings([], true);
  // protected readonly _uid = randomId();
  // private _comment: string = null;
  // protected readonly _type: string;
  // protected readonly _onlyKeys = [];

  _type: DestinationType;
  _id: string;
  _uid: string;
  _comment: string;
  _connectionTestOk: boolean;
  _connectionErrorMessage: React.ReactNode;
  _mode: 'batch' | 'stream';
  _formData: {
    [key: string]: any;
  };
}
