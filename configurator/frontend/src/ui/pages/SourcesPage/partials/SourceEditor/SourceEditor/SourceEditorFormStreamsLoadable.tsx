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
import { SourceConnector } from "catalog/sources/types"
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
  initialSourceData: Optional<Partial<SourceData>>
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
    reload: restartPolling,
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
        editorMode === "add" && handleSetControlsDisabled("Loading streams list", controlsDisableRequestId)
      },
      onAfterPollingEnd: () => {
        handleSetControlsDisabled(false, controlsDisableRequestId)
      },
    }),
  })

  const selectAllFieldsByDefault: boolean = !Object.entries(previouslySelectedStreams).length

  const initiallySelectedFields = useMemo<Array<StreamConfig>>(() => {
    return selectAllFieldsByDefault
      ? data
        ? data.map(sourceEditorUtils.streamDataToSelectedStreamsMapper)
        : []
      : previouslySelectedStreams
  }, [selectAllFieldsByDefault, previouslySelectedStreams, data])

  useEffect(() => {
    setSourceEditorState(state => {
      const newState = cloneDeep(state)
      newState.streams.errorsCount = error ? 1 : 0
      return newState
    })
  }, [error])

  return (
    <>
      {data && !error && !isLoading && (
        <SourceEditorFormStreamsLoadableForm
          allStreams={data}
          initiallySelectedStreams={initiallySelectedFields}
          selectAllFieldsByDefault={selectAllFieldsByDefault}
          hide={isLoading || !!error}
          setSourceEditorState={setSourceEditorState}
        />
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
