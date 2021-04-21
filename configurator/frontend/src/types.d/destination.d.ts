declare interface DestinationData {
  // private _mappings: FieldMappings = new FieldMappings([], true);
  // protected readonly _uid = randomId();
  // private _comment: string = null;
  // protected readonly _type: string;
  // protected readonly _onlyKeys = [];

  _id: string;
  _connectionTestOk: boolean;
  _connectionErrorMessage: React.ReactNode;
  _formData: {
    [key: string]: any;
  };

  [key: string]: any;
}
