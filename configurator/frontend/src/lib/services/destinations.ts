/* eslint-disable */
import { isNullOrUndef, randomId } from '../commons/utils';
import { FieldMappings } from './mappings';
import Marshal from "@./lib/commons/marshalling";

export class DestinationConfigFactory<T extends DestinationConfig> {
  private readonly _name: string;
  private readonly _type: string;
  private readonly _factory: (id) => T;

  constructor(name: string, type: string, factory: (id) => T) {
    this._type = type;
    this._factory = factory;
    this._name = name;
  }

  get type(): string {
    return this._type;
  }

  get name(): string {
    return this._name;
  }

  get factory(): (id) => T {
    return this._factory;
  }
}

export const destinationConfigTypes = [
  new DestinationConfigFactory('PostgresSQL', 'postgres', (id) => new PostgresConfig(id)),
  new DestinationConfigFactory('ClickHouse', 'click-house', (id) => new ClickHouseConfig(id)),
  new DestinationConfigFactory('BigQuery', 'big-query', (id) => new BQConfig(id)),
  new DestinationConfigFactory('Redshift', 'redshift', (id) => new RedshiftConfig(id)),
  new DestinationConfigFactory('Snowflake', 'snowflake', (id) => new SnowflakeConfig(id)),
  new DestinationConfigFactory('GoogleAnalytics', 'google-analytics', (id) => new GoogleAnalyticsConfig(id)),
  new DestinationConfigFactory('Facebook', 'facebook', (id) => new FacebookConversionConfig(id))
];

export const destinationsByTypeId = destinationConfigTypes.reduce(
  (map: Record<string, DestinationConfigFactory<any>>, obj) => {
    map[obj.type] = obj;
    return map;
  },
  {}
);

export type ConnectionDescription = {
  displayURL: string;
  commandLineConnect: string;
};

export abstract class DestinationConfig {
  private _mappings: FieldMappings = new FieldMappings([], true);
  protected readonly _uid = randomId();
  protected readonly _id: string;
  private _comment: string = null;
  protected readonly _type: string;
  protected readonly _onlyKeys = [];
  protected _formData: any = {};
  private _connectionTestOk: boolean = true;
  private _connectionErrorMessage: string = null;

  constructor(type: string, id: string) {
    this._id = id;
    this._type = type;
    this.fillInitialValues(this._formData);
  }

  public setConnectionTestResult(connectionErrorMessage: string) {
    this._connectionTestOk = !connectionErrorMessage;
    this._connectionErrorMessage = connectionErrorMessage;
  }

  public update(formValues: any): void {
    this._formData = formValues;
  }

  get id(): string {
    return this._id;
  }

  get uid(): string {
    return this._uid;
  }

  get type(): string {
    return this._type;
  }

  get comment(): string {
    return this._comment;
  }

  set comment(value: string) {
    this._comment = value;
  }

  get formData(): any {
    return this._formData;
  }

  /**
   * Trims all the string fields of _formData
   */
  public trim() {
    for (const key in this._formData) {
      if (this._formData.hasOwnProperty(key)) {
        let val = this._formData[key];
        if (typeof val === 'string') {
          this._formData[key] = val.trim();
        }
      }
    }
  }

  get mappings(): FieldMappings {
    this.fixMappings();
    return this._mappings;
  }

  /**
   * Fix type of mapping fields. Due to previous bug that
   * might have corrupted the data
   */
  private fixMappings() {
    if (!this._mappings) {
      this._mappings = new FieldMappings([], true);
    } else if (this._mappings.constructor.name != 'FieldMappings') {
      this._mappings = Marshal.newKnownInstance(FieldMappings, this._mappings)
    }
  }

  set mappings(value: FieldMappings) {
    this._mappings = value;
  }

  get connectionTestOk(): boolean {
    return this._connectionTestOk;
  }

  get connectionErrorMessage(): string {
    return this._connectionErrorMessage;
  }

  get mode(): string {
    return this.formData['mode'];
  }

  abstract describe(): ConnectionDescription;

  protected fillInitialValues(_formData: any) {
    _formData['mode'] = 'stream';
    _formData['tableName'] = 'events';
  }
}

export class PostgresConfig extends DestinationConfig {
  constructor(id: string) {
    super('postgres', id);
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `${this.formData['pghost']}`,
      commandLineConnect: `PGPASSWORD="${this.formData['pgpassword']}" psql -U ${this.formData['pguser']} -d ${this.formData['pgdatabase']} -h ${this.formData['pghost']} -p ${this.formData['pgport']} -c "SELECT 1"`
    };
  }

  fillInitialValues(_formData: any) {
    super.fillInitialValues(_formData);
    _formData['pgport'] = 5432;
    _formData['pgschema'] = 'public';
  }
}

export class ClickHouseConfig extends DestinationConfig {
  constructor(id: string) {
    super('clickhouse', id);
  }

  describe(): ConnectionDescription {
    this.migrateData();
    let dsn = this.formData['ch_dsns_list'].length > 0 ? this.formData['ch_dsns_list'][0] : 'Unknown';
    return {
      displayURL: dsn,
      commandLineConnect: `echo 'SELECT 1' | curl '${dsn}' --data-binary @-`
    };
  }

  update(formValues: any) {
    if (formValues['ch_dsns_list']) {
      formValues['ch_dsns'] = formValues['ch_dsns_list'].join(',');
    }
    super.update(formValues);
  }

  public migrateData() {
    if (isNullOrUndef(this.formData['ch_dsns_list'])) {
      if (!isNullOrUndef(this.formData['ch_dsns']) && this.formData['ch_dsns'].toString().length > 0) {
        this.formData['ch_dsns_list'] = this.formData['ch_dsns'].toString().split(',');
        this.formData['ch_dsns'] = null;
      } else {
        this.formData['ch_dsns_list'] = [];
      }
    }
  }
}

export class GoogleAnalyticsConfig extends DestinationConfig {
  constructor(id: string) {
    super('google_analytics', id);
  }

  update(formValues: any): void {
    super.update(formValues);
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `${this.formData['gaTrackingId']}`,
      commandLineConnect: null
    };
  }
}

export class FacebookConversionConfig extends DestinationConfig {
  constructor(id: string) {
    super('facebook', id);
  }

  update(formValues: any): void {
    super.update(formValues);
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `Pixel ID: ${this.formData['fbPixelId']}`,
      commandLineConnect: null
    };
  }
}

export class SnowflakeConfig extends DestinationConfig {
  constructor(id: string) {
    super('snowflake', id);
  }

  update(formValues: any): void {
    super.update(formValues);
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `${this.formData['snowflakeWarehouse']} / ${this.formData['snowflakeDB']}`,
      commandLineConnect: null
    };
  }
}

export class RedshiftConfig extends DestinationConfig {
  constructor(id: string) {
    super('redshift', id);
  }

  protected fillInitialValues(_formData: any) {
    super.fillInitialValues(_formData);
    _formData['redshiftS3Region'] = 'us-west-1';
    _formData['redshiftUseHostedS3'] = false;
    _formData['redshiftSchema'] = 'public';
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `${this.formData['redshiftHost']}`,
      commandLineConnect: `PGPASSWORD="${this.formData['redshiftPassword']}" psql -U ${this.formData['redshiftUser']} -d ${this.formData['redshiftDB']} -h ${this.formData['redshiftHost']} -p 5439 -c "SELECT 1"`
    };
  }
}

export class BQConfig extends DestinationConfig {
  constructor(id: string) {
    super('bigquery', id);
  }

  describe(): ConnectionDescription {
    return {
      displayURL: `${this.formData['bqProjectId']}`,
      commandLineConnect: `echo '${this.formData['bqJSONKey'].replaceAll('\n', ' ')}' > bqkey.json;\\\ngcloud auth activate-service-account --key-file bqkey.json;\\\nbq query "SELECT 1;"`
    };
  }
}
