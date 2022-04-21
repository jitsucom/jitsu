/**
 * Stream configuration of a Native source
 *
 * Note: collections have been renamed to Streams as of September 2021
 */
declare interface CollectionSource {
  name: string
  type: string
  mode?: "full_sync" | "incremental"
  parameters: Array<{
    [key: string]: string[]
  }>
  /**
   * @deprecated
   * Individual schedules for collections are no longer supported.
   * Schedule to be set globally in SourceData `config` field.
   */
  schedule?: string
}

type SdkSourceStreamConfigurationParameter = {
  id: string;
  type?: string;
  displayName: string;
  required?: boolean;
  defaultValue?: any;
  documentation?: string;
}

declare type StreamData = AirbyteStreamData | SingerStreamData | SDKSourceStreamData

declare type SDKSourceStreamData = {
    type: string
    supported_modes?: ["full_sync"] | ["full_sync", "incremental"] | ["incremental"]
    params: SdkSourceStreamConfigurationParameter[]
}
/**
 * Configured Airbyte stream data format used internally in the UI.
 *
 * Corresponds to the [ConfiguredAirbyteStream schema](https://docs.airbyte.com/understanding-airbyte/catalog#configuredairbytestream)
 */
declare type AirbyteStreamData = {
  sync_mode: "full_refresh" | "incremental"
  cursor_field: string[]
  destination_sync_mode: string
  stream: {
    name: string
    namespace?: string
    json_schema: UnknownObject
    /**
     * Can be either `full_refresh` or `incremental`
     *
     * Incremental sync modes requires choosing a cursor field which is used as comparable to determine which records are the new or updated since the last sync.
     * Learn more in the [Airbyte docs](https://docs.airbyte.com/understanding-airbyte/catalog#cursor).
     * */
    supported_sync_modes?: ["full_refresh"] | ["full_refresh", "incremental"]
    /**
     * Works only for the `incremental` sync mode.
     *
     * If `true`, then the source determines the cursor field internally. It cannot be overriden.
     *
     * Cursor field is used as comparable to determine which records are the new or updated since the last sync.
     * Learn more in the [Airbyte docs](https://docs.airbyte.com/understanding-airbyte/catalog#cursor).
     **/
    source_defined_cursor?: boolean
    /**
     * Works only for the `incremental` sync mode.
     *
     * Cursor field that will be used if the sync mode is `incremental` and the source_defined_cursor is `true`.
     *
     * Cursor field is used as comparable to determine which records are the new or updated since the last sync.
     * Learn more in the [Airbyte docs](https://docs.airbyte.com/understanding-airbyte/catalog#cursor).
     **/
    default_cursor_field?: string[]
    [key: string]: unknown
  }
}

declare type SingerStreamData = {
  tap_stream_id: string
  stream: string
  key_properties: string[]
  schema: UnknownObject
  metadata: {
    breadcrumb: string[]
    metadata: UnknownObject
  }[]
}

/**
 * Format for storing configured streams data on backend.
 */
declare type StreamConfig = SingerStreamConfig | AirbyteStreamConfig

/** General form of the Stream applicable to both Airbyte and Singer */
declare type SingerStreamConfig = {
  name?: string
  namespace?: string
  [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
}


/** Configured Airbyte stream to send to backend */
declare type AirbyteStreamConfig = {
  name: string
  namespace?: string
  /**
   * Can be either `full_refresh` or `incremental`
   *
   * Incremental sync modes requires choosing a cursor field which is used as comparable to determine
   * which records are the new or updated since the last sync.
   * Learn more in the [Airbyte docs](https://docs.airbyte.com/understanding-airbyte/catalog#cursor).
   * */
  sync_mode: "full_refresh" | "incremental"
  /**
   * Field that will be used as comparable to determine which records are the new or updated since the last sync.
   * Stored in the form of array that reads the path to field, e.g.
   *
   * @example
   * type StreamJsonStructure = {
   *  field1: string
   *  field2: number
   *  field3: {
   *    id: string
   *    content: string
   *  }
   * }
   *
   * const cursor_field = ["field3", "id"] // cursor field will be field3 ID field
   *
   * @see
   * Learn more in the [Airbyte docs](https://docs.airbyte.com/understanding-airbyte/catalog#cursor).
   */
  cursor_field?: string[]
}

declare type SourceData = NativeSourceData | AirbyteSourceData | SingerSourceData | SDKSourceData

declare type CommonSourceData = {
  /** Source unique identifier */
  sourceId: string
  /** name displayed on a source. Used only in UI */
  displayName?: string
  /**
   * Source type, either `airbyte`, `singer` or `{source_type}` if source is native
   */
  sourceType: "airbyte" | "singer" | string
  /**
   * Snake-cased source id from the Catalog
   */
  sourceProtoType: string
  /** Shows whether the latest "Test connection" was successful */
  connected: boolean
  /** Stores the error message from the latest "Test connection" */
  connectedErrorMessage?: string
  /** List of connected destinations UIDs */
  destinations: string[]
  /** Sync schedule */
  schedule?: string
}
declare interface NativeSourceData extends CommonSourceData {
  /** List of data streams.  */
  protoType: "native"
  collections: CollectionSource[]
  config: {
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}

declare interface AirbyteSourceData extends CommonSourceData {
  /**
   * @deprecated as of October 2021.
   * The new path for streams is config.catalog.streams
   */
  protoType: "airbyte"
  catalog?: {
    streams: Array<AirbyteStreamData>
  }
  config: {
    config: PlainObjectWithPrimitiveValues
    /**
     * @deprecated as of November 2021.
     * Catalog isn't stored into sources anymore. Now only selectedStreams are saved
     */
    catalog?: {
      streams: Array<AirbyteStreamData>
    }
    selected_streams?: Array<AirbyteStreamConfig>
    docker_image?: string
    image_version?: string
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}

declare interface SDKSourceData extends CommonSourceData {
  protoType: "sdk_source"
  collections?: CollectionSource[]
  config: {
    package_name?: string
    package_version?: string
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}

declare interface SingerSourceData extends CommonSourceData {
  protoType: "singer"
  config: {
    config: PlainObjectWithPrimitiveValues
    /**
     * @deprecated as of November 2021.
     * Catalog isn't stored into sources anymore. Now only selectedStreams are saved
     */
    catalog?: {
      streams: Array<SingerStreamData>
    }
    selected_streams?: Array<SingerStreamConfig>
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}
