// @Libs
import { merge } from "lodash"
// @Utils
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
// @Types
import { SourceEditorState } from "./SourceEditor"
import { SourceConnector } from "@jitsu/catalog/sources/types"
import { makeObjectFromFieldsValues } from "utils/forms/marshalling"
import { sourcesStore } from "stores/sources"
import { COLLECTIONS_SCHEDULES } from "constants/schedule"

const STREAM_UID_DELIMITER = "__"

export const sourceEditorUtils = {
  getSourceDataFromState: (
    sourceEditorState: SourceEditorState,
    sourceCatalogData: SourceConnector,
    initialSourceData: Partial<SourceData>
  ): SourceData => {
    const { configuration, streams, connections } = sourceEditorState ?? {}

    let updatedSourceData: SourceData = merge(
      makeObjectFromFieldsValues(merge({}, ...Object.values(configuration.config))),
      makeObjectFromFieldsValues(streams.selectedStreams),
      makeObjectFromFieldsValues(connections.connections)
    )

    const catalogSourceData: Pick<SourceData, "sourceType" | "sourceProtoType"> = {
      sourceType: sourcePageUtils.getSourceType(sourceCatalogData),
      sourceProtoType: sourcePageUtils.getSourcePrototype(sourceCatalogData),
    }

    updatedSourceData = { ...(initialSourceData ?? {}), ...catalogSourceData, ...updatedSourceData }
    //backward compatibility: when catalog exists this code will take into account enabled streams from catalog
    if (!updatedSourceData?.config?.selected_streams && initialSourceData?.config?.selected_streams) {
      updatedSourceData["config"]["selected_streams"] = initialSourceData.config.selected_streams
    }

    return updatedSourceData
  },

  /** Reformat old catalog (full schema JSON) into SelectedStreams and always remove old format*/
  reformatCatalogIntoSelectedStreams: (sourceData: SourceData): SourceData => {
    if (sourceEditorUtils.isNativeSource(sourceData) || sourceData?.config?.selected_streams?.length) return sourceData

    if (sourceData?.config?.catalog) {
      sourceData.config.selected_streams = sourceData.config.catalog["streams"].map(
        sourceEditorUtils.mapStreamDataToSelectedStreams
      ) as AirbyteStreamConfig[] | SingerStreamConfig[]

      //remove massive deprecated catalog from config
      delete sourceData.config.catalog
    }

    if (!sourceEditorUtils.isAirbyteSource(sourceData)) return sourceData

    if (sourceData?.catalog) {
      sourceData.config.selected_streams = sourceData.catalog.streams.map(
        sourceEditorUtils.mapStreamDataToSelectedStreams
      )
      //remove massive deprecated catalog from config
      delete sourceData.catalog
    }

    return sourceData
  },

  getStreamUid: (stream: StreamData): string => {
    if (sourceEditorUtils.isAirbyteStream(stream)) {
      return sourceEditorUtils.getAirbyteStreamUniqueId(stream as AirbyteStreamData)
    } else if (sourceEditorUtils.isSDKSourceStream(stream)) {
      return sourceEditorUtils.getSDKSourceUniqueId(stream as SDKSourceStreamData)
    }
    else if (sourceEditorUtils.isSingerStream(stream)) {
      return sourceEditorUtils.getSingerStreamUniqueId(stream as SingerStreamData)
    }
  },

  getStreamSyncMode: (data: StreamData): string => {
    if (sourceEditorUtils.isAirbyteStream(data)) {
      const airbyteData = data as AirbyteStreamData
      return airbyteData.sync_mode
    } else if (sourceEditorUtils.isSDKSourceStream(data)) {
      const sdkSourceData = data as SDKSourceStreamData
      return data.mode
    } else if (sourceEditorUtils.isSingerStream(data)) {
      return ""
    }
  },

  mapStreamDataToSelectedStreams: <T extends StreamData>(
    streamData: T
  ): T extends AirbyteStreamData ? AirbyteStreamConfig : (T extends SDKSourceStreamData ? SDKSourceStreamConfig : SingerStreamConfig) => {
    if (sourceEditorUtils.isAirbyteStream(streamData)) {
      return {
        name: streamData.stream.name,
        namespace: streamData.stream.namespace,
        sync_mode: streamData.sync_mode,
        cursor_field: streamData.cursor_field,
      } as T extends AirbyteStreamData ? AirbyteStreamConfig : (T extends SDKSourceStreamData ? SDKSourceStreamConfig : SingerStreamConfig)
    } else  if (sourceEditorUtils.isSDKSourceStream(streamData)) {
      return {
        name: streamData.name,
        mode: streamData.mode,
        params: streamData.params,
      } as unknown as T extends AirbyteStreamData ? AirbyteStreamConfig : (T extends SDKSourceStreamData ? SDKSourceStreamConfig : SingerStreamConfig)
    } else if (sourceEditorUtils.isSingerStream(streamData)) {
      return {
        name: streamData.stream,
        namespace: streamData.tap_stream_id,
      } as T extends AirbyteStreamData ? AirbyteStreamConfig : (T extends SDKSourceStreamData ? SDKSourceStreamConfig : SingerStreamConfig)
    }
  },

  isNativeSource: (data: SourceData): data is NativeSourceData => {
    return !!data?.["collections"]
  },

  isAirbyteSource: (data: SourceData): data is AirbyteSourceData => {
    return !!data?.config.docker_image
  },

  isSingerSource: (data: SourceData): data is SingerSourceData => {
    return !data?.config.docker_image
  },

  isAirbyteStream: (stream: StreamData): stream is AirbyteStreamData => {
    return "stream" in stream && typeof stream.stream === "object" && "json_schema" in stream.stream
  },

  isSingerStream: (stream: StreamData): stream is SingerStreamData => {
    return "tap_stream_id" in stream
  },

  isSDKSourceStream: (stream: StreamData): stream is SDKSourceStreamData => {
    return "stream" in stream && typeof stream.stream === "object" && "streamName" in stream.stream
  },

  getAirbyteStreamUniqueId: (data: AirbyteStreamData): string => {
    return `${data.stream?.name}${STREAM_UID_DELIMITER}${data.stream.namespace}`
  },

  getSDKSourceUniqueId: (data: SDKSourceStreamData): string => {
    return `${data.name}${STREAM_UID_DELIMITER}${undefined}`
  },

  getSingerStreamUniqueId: (data: SingerStreamData): string => {
    return `${data.stream}${STREAM_UID_DELIMITER}${data.tap_stream_id}`
  },

  getSelectedStreamUid: (streamConfig: StreamConfig): string => {
    return `${streamConfig.name}${STREAM_UID_DELIMITER}${streamConfig.namespace}`
  },

  streamsAreEqual: (
    streamA: Optional<Pick<StreamConfig, "name" | "namespace">>,
    streamB: Optional<Pick<StreamConfig, "name" | "namespace">>
  ) => {
    return streamA.name == streamB.name && streamA.namespace == streamB.namespace
  },
}

export const createInitialSourceData = (sourceCatalogData: SourceConnector) =>
  ({
    sourceId: sourcePageUtils.getSourceId(
      sourceCatalogData.id,
      sourcesStore.list.map(source => source.sourceId)
    ),
    schedule: COLLECTIONS_SCHEDULES[0].value,
    connected: false,
    connectedErrorMessage: "",
  } as const)
