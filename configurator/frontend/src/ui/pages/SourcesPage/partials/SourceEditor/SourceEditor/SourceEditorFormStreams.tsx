// @Libs
import { useEffect, useMemo } from 'react';
import { Col, Row } from 'antd';
import { cloneDeep } from "lodash"
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

type Props = {
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: SourceConnector
  sourceConfigValidatedByStreamsTab: boolean
  setSourceEditorState: SetSourceEditorState
  setControlsDisabled: ReactSetState<boolean>
  setConfigIsValidatedByStreams: (value: boolean) => void
  handleBringSourceData: () => SourceData
}

export const SourceEditorFormStreams: React.FC<Props> = ({
  initialSourceData,
  sourceDataFromCatalog,
  sourceConfigValidatedByStreamsTab,
  setSourceEditorState,
  setControlsDisabled,
  setConfigIsValidatedByStreams,
  handleBringSourceData,
}) => {
  const previouslyCheckedStreams = useMemo<StreamData[]>(
    () => initialSourceData?.config?.catalog?.streams ?? initialSourceData?.catalog?.streams ?? [],
    [initialSourceData]
  )

  const pullAllStreams = useMemo<PullAllStreams>(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        return pullAllAirbyteStreams
      case "singer":
        return pullAllSingerStreams
    }
  }, [])

  const {
    isLoading,
    data,
    error,
    reload: restartPolling,
  } = usePolling<StreamData[]>((end, fail) => async () => {
    try {
      const result = await pullAllStreams(previouslyCheckedStreams, sourceDataFromCatalog, handleBringSourceData)
      if (result !== undefined) end(result)
    } catch (error) {
      fail(error)
    } finally {
      setConfigIsValidatedByStreams(true)
      setControlsDisabled(false)
    }
  })

  const selectAllFieldsByDefault: boolean = !previouslyCheckedStreams.length

  const initallySelectedFields = useMemo<StreamData[]>(() => {
    return selectAllFieldsByDefault ? data : previouslyCheckedStreams
  }, [selectAllFieldsByDefault, previouslyCheckedStreams, data])

  useEffect(() => {
    if (!sourceConfigValidatedByStreamsTab) restartPolling()
  }, [sourceConfigValidatedByStreamsTab])

  useEffect(() => {
    if (!data && isLoading) setControlsDisabled(true)
  }, [isLoading, data])

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
          initiallySelectedStreams={initallySelectedFields}
          selectAllFieldsByDefault={selectAllFieldsByDefault}
          hide={isLoading || !!error}
          setSourceEditorState={setSourceEditorState}
        />
      )}
      {isLoading ? (
        <Row>
          <Col span={24}>
            <LoadableFieldsLoadingMessageCard
              title="Validating the source configuration"
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


