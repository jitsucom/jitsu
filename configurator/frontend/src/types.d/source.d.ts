/**
 * Collections have been renamed to Streams as of September 2021
 */
declare interface CollectionSource {
  name: string
  type: string
  parameters: Array<{
    [key: string]: string[]
  }>
  /**
   * @deprecated
   * Individual schedules for collections are no longer supported.
   * Schedule to be set globally in SourceData `config` field.
   */
  schedule: string
}

declare type StreamData = AirbyteStreamData | SingerStreamData

declare type AirbyteStreamData = {
  sync_mode: string
  destination_sync_mode: string
  stream: {
    name: string
    namespace?: string
    json_schema: UnknownObject
    supported_sync_modes?: string[]
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

declare type SourceData = NativeSourceData & AirbyteSourceData & SingerSourceData
declare interface NativeSourceData {
  //name displayed on a source. Used only in UI
  displayName?: string
  collections: CollectionSource[]
  config: {
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
  schedule?: string
  destinations: string[]
  sourceId: string
  sourceName?: string
  connected: boolean
  connectedErrorMessage?: string
  /**
   * Source type, either `airbyte`, `singer` or `{source_type}` if source is native
   */
  sourceType: "airbyte" | "singer" | string
  /**
   * Snake-cased catalog source id
   */
  sourceProtoType: string
}

declare interface AirbyteSourceData {
  /**
   * @deprecated as of October 2021.
   * The new path for streams is config.catalog.streams
   */
  catalog?: {
    streams: Array<AirbyteStreamData>
  }
  config: {
    config: PlainObjectWithPrimitiveValues
    catalog?: {
      streams: Array<AirbyteStreamData>
    }
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}

declare interface SingerSourceData {
  config: {
    config: PlainObjectWithPrimitiveValues
    catalog?: {
      streams: Array<SingerStreamData>
    }
    [key: string]: string | number | boolean | PlainObjectWithPrimitiveValues
  }
}
