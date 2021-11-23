// @Libs
import { merge } from "lodash"
// @Utils
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
// @Types
import { SourceEditorState } from "./SourceEditor"
import { SourceConnector } from "catalog/sources/types"
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

    streams.selectedStreams

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
    //TODO check maybe remove it
    if (!updatedSourceData?.config?.selectedStreams && initialSourceData?.config?.selectedStreams) {
      updatedSourceData["config"]["selectedStreams"] = initialSourceData.config.selectedStreams
    }

    return updatedSourceData
  },

  /*streamConfigArrayReducer: (selectedStreams: SelectedStreams, streamConfig: StreamConfig): SelectedStreams => {
    selectedStreams[this.getSelectedStreamKey(streamConfig)] = streamConfig;
    return selectedStreams;
  },*/

  /*streamDataToSelectedStreamsReducer: (selectedStreams: SelectedStreams, streamData: StreamData): SelectedStreams => {
    selectedStreams[this.getStreamUid(streamData)] = this.createStreamConfig(streamData);
    return selectedStreams;
  },*/

  streamDataToSelectedStreamsMapper: (streamData: StreamData): StreamConfig => {
    if (this.isAirbyteStream(streamData)) {
      streamData = (streamData as AirbyteStreamData)
      return {
        name: streamData.stream.name,
        namespace: streamData.stream.namespace,
        sync_mode: streamData.sync_mode,
      }
    } else if (this.isSingerStream(streamData)) {
      streamData = (streamData as SingerStreamData)
      return {
        name: streamData.stream,
        namespace: streamData.tap_stream_id,
        sync_mode: "",
      }
    }
  },

  /** Reformat old catalog (full schema JSON) into SelectedStreams or backend representation StreamConfig[] -> SelectedStreams */
  reformatCatalogIntoSelectedStreams: (sourceData: SourceData): SourceData => {
    if (!sourceData?.config?.selectedStreams?.length){
      if (sourceData?.config?.catalog){
        sourceData.config.selectedStreams = sourceData.config.catalog.streams.map(this.streamDataToSelectedStreamsMapper)
        return sourceData
        /*switch (sourceData.sourceType) {
        case "airbyte":

          sourceData.config.selectedStreams = (sourceData as AirbyteSourceData).config.catalog.streams.map(streamData => {
           return {
             name: streamData.stream.name,
             namespace: streamData.stream.namespace,
             sync_mode: streamData.sync_mode,
           }
          });
          return sourceData
        case "singer":
          sourceData.config.selectedStreams = (sourceData as SingerSourceData).config.catalog.streams.map(streamData => {
            return {
              name: streamData.stream,
              namespace: streamData.tap_stream_id,
              sync_mode: "",
            }
          })
          return sourceData
        }*/
      }else if (sourceData?.catalog){
        sourceData.config.selectedStreams = sourceData.catalog.streams.map(this.streamDataToSelectedStreamsMapper)
        /*
        sourceData.config.selectedStreams = (sourceData as AirbyteSourceData).catalog.streams.map(streamData => {
          return {
            name: streamData.stream.name,
            namespace: streamData.stream.namespace,
            sync_mode: streamData.sync_mode,
          }
        });*/
        return sourceData
      }
    }

    return sourceData
  },

  createStreamConfig: (stream: StreamData): StreamConfig => {
    return { sync_mode: this.getStreamSyncMode(stream) }
  },

  getStreamUid: (stream: StreamData): string => {
    if (this.isAirbyteStream(stream)) {
      return this.getAirbyteStreamUniqueId(stream)
    } else if (this.isSingerStream(stream)) {
      return this.getSingerStreamUniqueId(stream)
    }
  },

  getStreamSyncMode: (data: StreamData): string => {
    if (this.isAirbyteStream(data)) {
      const airbyteData = (data as AirbyteStreamData)
      return airbyteData.sync_mode
    } else if (this.isSingerStream(data)) {
      return ""
    }
  },

  isAirbyteStream: (stream: StreamData): stream is AirbyteStreamData => {
    return "stream" in stream && typeof stream.stream === "object"
  },

  isSingerStream: (stream: StreamData): stream is SingerStreamData => {
    return "tap_stream_id" in stream
  },

  getAirbyteStreamUniqueId: (data: AirbyteStreamData): string => {
    return `${data.stream?.name}${STREAM_UID_DELIMITER}${data.stream.namespace}`
  },

  getSingerStreamUniqueId: (data: SingerStreamData): string => {
    return `${data.stream}${STREAM_UID_DELIMITER}${data.tap_stream_id}`
  },

  getSelectedStreamKey: (streamConfig: StreamConfig): string => {
    return `${streamConfig.name}${STREAM_UID_DELIMITER}${streamConfig.namespace}`
  },

  streamsAreEqual: (streamA: StreamConfig, streamB: StreamConfig) => {
    `${streamA.name}${STREAM_UID_DELIMITER}${streamA.namespace}` === `${streamB.name}${STREAM_UID_DELIMITER}${streamB.namespace}`
  }
}

export const createInitialSourceData = (sourceCatalogData: SourceConnector) =>
  ({
    sourceId: sourcePageUtils.getSourceId(
      sourceCatalogData.id,
      sourcesStore.sources.map(source => source.sourceId)
    ),
    schedule: COLLECTIONS_SCHEDULES[0].value,
    connected: false,
    connectedErrorMessage: "",
  } as const)
