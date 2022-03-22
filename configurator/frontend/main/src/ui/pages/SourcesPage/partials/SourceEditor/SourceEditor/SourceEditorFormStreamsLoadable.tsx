// @Libs
import { useEffect, useMemo } from "react"
import { Col, Row } from "antd"
import { cloneDeep, uniqueId } from "lodash"
// @Components
import { ErrorCard } from "lib/components/ErrorCard/ErrorCard"
import { SourceEditorFormStreamsLoadableForm } from "./SourceEditorFormStreamsLoadableForm"
import { LoadableFieldsLoadingMessageCard } from "lib/components/LoadingFormCard/LoadingFormCard"
// @Hooks
import { usePolling } from "hooks/usePolling"
// @Types
import { SourceConnector } from "@jitsu/catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Utils
import {
  PARSING_STREAMS_ERROR_NAME,
  pullAllAirbyteStreams,
  pullAllSingerStreams,
  PullAllStreams,
} from "./SourceEditorPullData"
import { sourceEditorUtils } from "./SourceEditor.utils"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<AirbyteSourceData | SingerSourceData>>
  sourceDataFromCatalog: SourceConnector
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreamsLoadable: React.FC<Props> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleSetControlsDisabled,
  handleBringSourceData,
}) => {
  const previouslySelectedStreams = useMemo<Array<StreamConfig>>(
    () => initialSourceData?.config?.selected_streams ?? [],
    [initialSourceData]
  )

  const pullAllStreams = useMemo<PullAllStreams>(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        return pullAllAirbyteStreams
      case "singer":
        return pullAllSingerStreams
      default:
        throw new Error(
          `Can not display streams list. Expected source of type 'airbyte' or 'singer' but received '${sourceDataFromCatalog.protoType}'`
        )
    }
  }, [])

  const controlsDisableRequestId = uniqueId("streams-")
  const {
    isLoading,
    data,
    error,
    reload: reloadStreamsList,
  } = usePolling<StreamData[]>({
    configure: () => ({
      pollingCallback: (end, fail) => async () => {
        try {
          const result = await pullAllStreams(sourceDataFromCatalog, handleBringSourceData)
          if (result !== undefined) end(result)
        } catch (error) {
          fail(error)
        }
      },
      onBeforePollingStart: () => {
        handleSetControlsDisabled("Loading streams list", controlsDisableRequestId)
      },
      onAfterPollingEnd: () => {
        handleSetControlsDisabled(false, controlsDisableRequestId)
      },
    }),
  })

  const selectAllFieldsByDefault: boolean = editorMode === "add"

  const [initiallySelectedStreams, unavailableStreams] = useMemo<[StreamConfig[], StreamConfig[]]>(() => {
    const allStreamsConfigs = data?.map(sourceEditorUtils.mapStreamDataToSelectedStreams) ?? []
    if (selectAllFieldsByDefault) return [allStreamsConfigs, []]
    if (allStreamsConfigs.length === 0) {
      return [previouslySelectedStreams, []]
    } else {
      const unavailableStreams: StreamConfig[] = []
      const previouslySelectedWithoutUnavailable = previouslySelectedStreams.filter(previouslySelectedStream => {
        const streamIsAvailable = allStreamsConfigs.some(streamConfig =>
          sourceEditorUtils.streamsAreEqual(streamConfig, previouslySelectedStream)
        )
        if (!streamIsAvailable) unavailableStreams.push(previouslySelectedStream)
        return streamIsAvailable
      })
      return [previouslySelectedWithoutUnavailable, unavailableStreams]
    }
  }, [selectAllFieldsByDefault, previouslySelectedStreams, data])

  /** Set global errors counter */
  useEffect(() => {
    setSourceEditorState(state => {
      const newState = cloneDeep(state)
      newState.streams.errorsCount = error ? 1 : 0
      return newState
    })
  }, [error])

  useEffect(() => {
    const forceReloadStreamsList = reloadStreamsList
    setSourceEditorState(state => {
      const newState = { ...state, streams: { ...state.streams, forceReloadStreamsList } }
      return newState
    })
  }, [])

  return (
    <>
      {data && !error && !isLoading && (
        <>
          {!!unavailableStreams.length && <StreamsUnavailableWarning unavailableStreams={unavailableStreams} />}
          <SourceEditorFormStreamsLoadableForm
            allStreams={data}
            initiallySelectedStreams={initiallySelectedStreams}
            selectAllFieldsByDefault={selectAllFieldsByDefault}
            hide={isLoading || !!error}
            setSourceEditorState={setSourceEditorState}
          />
        </>
      )}
      {isLoading ? (
        <Row>
          <Col span={24}>
            <LoadableFieldsLoadingMessageCard
              title="Loading the list of streams"
              longLoadingMessage="This operation may take up to 3 minutes if you are configuring streams of this source type for the first time."
              showLongLoadingMessageAfterMs={10000}
            />
          </Col>
        </Row>
      ) : error ? (
        <Row>
          <Col span={24}>
            <ErrorCard
              title={`Source configuration validation failed`}
              description={
                error && error.name !== PARSING_STREAMS_ERROR_NAME
                  ? `Connection is not configured.${error.stack ? " See more details in the error stack." : ""}`
                  : `Internal error. Please, file an issue.`
              }
              stackTrace={error?.stack}
              className={"form-fields-card"}
            />
          </Col>
        </Row>
      ) : !data ? (
        <Row>
          <Col span={24}>
            <ErrorCard
              title={`Source configuration validation failed`}
              description={`Internal error. Please, file an issue.`}
              className={"form-fields-card"}
            />
          </Col>
        </Row>
      ) : null}
    </>
  )
}

const StreamsUnavailableWarning: React.FC<{ unavailableStreams: StreamConfig[] }> = ({ unavailableStreams }) => {
  return (
    <div className="w-full text-error">
      {`Due to changes in the source configuration, some of the previously selected streams are no longer available.\nPlease, review your streams selection before saving the source`}
      <div className="flex flex-col w-full mt-2 mb-2">
        <span>{`The list of unavalilable streams:`}</span>
        {unavailableStreams.map(({ name, namespace }) => (
          <span className={"ml-2"}>
            {`• name: `}
            <span className="font-bold">{name}</span>
            {namespace ? (
              <>
                {`, namespace: `}
                <span className="font-bold">{namespace}</span>
              </>
            ) : (
              ""
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
