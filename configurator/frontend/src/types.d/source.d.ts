/**
 * Collections have been renamed to Streams as of September 2021
 */
declare interface CollectionSource {
  name: string;
  type: string;
  parameters: Array<{
    [key: string]: string[];
  }>;
  /**
   * @deprecated
   * Schedule is set in SourceData `config` field.
   */
  schedule: string;
}

declare type AirbyteStreamData = {
  sync_mode: string;
  destination_sync_mode: string;
  stream: {
    name: string;
    namespace?: string;
    json_schema: UnknownObject;
    supported_sync_modes: string[];
    [key: string]: unknown;
  };
};

declare type SourceData = NativeSourceData & AirbyteSourceData;
declare interface NativeSourceData {
  collections: CollectionSource[];
  config: {
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues;
  };
  schedule?: string;
  destinations: string[];
  sourceId: string;
  sourceName?: string;
  connected: boolean;
  connectedErrorMessage?: string;
  /**
   * Source type, either `airbyte`, `singer` or `{source_type}` if source is native
   */
  sourceType: 'airbyte' | 'singer' | string;
  /**
   * Snake-cased catalog source id
   */
  sourceProtoType: string;
}

declare interface AirbyteSourceData {
  /**
   * @deprecated as of October 2021.
   * The new path for streams is config.catalog.streams
   */
  catalog?: {
    streams: Array<AirbyteStreamData>;
  };
  config: {
    config: PlainObjectWithPrimitiveValues;
    catalog?: {
      streams: Array<AirbyteStreamData>;
    };
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues;
  };
}
