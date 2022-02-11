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
import { useEffect } from "react"
import { CommonSourcePageProps } from "ui/pages/SourcesPage/SourcesPage"
import { withHome as breadcrumbsWithHome } from "ui/components/Breadcrumbs/Breadcrumbs"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"

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
    if (!sourceData?.config?.selected_streams?.length) {
      if (sourceData?.config?.catalog) {
        sourceData.config.selected_streams = sourceData.config.catalog.streams.map(
          sourceEditorUtils.streamDataToSelectedStreamsMapper
        )
      } else if (sourceData?.catalog) {
        sourceData.config.selected_streams = sourceData.catalog.streams.map(
          sourceEditorUtils.streamDataToSelectedStreamsMapper
        )
      }
    }

    //remove massive deprecated catalog from config
    if (sourceData?.["catalog"]) {
      delete sourceData["catalog"]
    }
    if (sourceData?.config?.["catalog"]) {
      delete sourceData.config["catalog"]
    }

    return sourceData
  },

  createStreamConfig: (stream: StreamData): StreamConfig => {
    return { sync_mode: sourceEditorUtils.getStreamSyncMode(stream) }
  },

  getStreamUid: (stream: StreamData): string => {
    if (sourceEditorUtils.isAirbyteStream(stream)) {
      return sourceEditorUtils.getAirbyteStreamUniqueId(stream as AirbyteStreamData)
    } else if (sourceEditorUtils.isSingerStream(stream)) {
      return sourceEditorUtils.getSingerStreamUniqueId(stream as SingerStreamData)
    }
  },

  getStreamSyncMode: (data: StreamData): string => {
    if (sourceEditorUtils.isAirbyteStream(data)) {
      const airbyteData = data as AirbyteStreamData
      return airbyteData.sync_mode
    } else if (sourceEditorUtils.isSingerStream(data)) {
      return ""
    }
  },

  streamDataToSelectedStreamsMapper: (streamData: StreamData): StreamConfig => {
    if (sourceEditorUtils.isAirbyteStream(streamData)) {
      streamData = streamData as AirbyteStreamData
      return {
        name: streamData.stream.name,
        namespace: streamData.stream.namespace,
        sync_mode: streamData.sync_mode,
      }
    } else if (sourceEditorUtils.isSingerStream(streamData)) {
      streamData = streamData as SingerStreamData
      return {
        name: streamData.stream,
        namespace: streamData.tap_stream_id,
        sync_mode: "",
      }
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

  getSelectedStreamUid: (streamConfig: StreamConfig): string => {
    return `${streamConfig.name}${STREAM_UID_DELIMITER}${streamConfig.namespace}`
  },

  streamsAreEqual: (streamA: StreamConfig, streamB: StreamConfig) => {
    return streamA.name == streamB.name && streamA.namespace == streamB.namespace
  },
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

/** Hook for setting the Source Editor breadcrumbs */
export const useBreadcrubmsEffect: UseBreadcrubmsEffect = parameters => {
  useEffect(() => {
    parameters.setBreadcrumbs(
      breadcrumbsWithHome({
        elements: [
          { title: "Sources", link: sourcesPageRoutes.root },
          {
            title: (
              <PageHeader
                title={parameters.sourceDataFromCatalog?.displayName}
                icon={parameters.sourceDataFromCatalog?.pic}
                mode={parameters.editorMode}
              />
            ),
          },
        ],
      })
    )
  }, [parameters.editorMode, parameters.sourceDataFromCatalog, parameters.setBreadcrumbs])
}
type UseBreadcrubmsEffect = (parameters: CommonSourcePageProps & { sourceDataFromCatalog: SourceConnector }) => void
