// @Libs
import { useEffect, useMemo } from 'react';
import { Col, Row } from 'antd';
import { cloneDeep, isArray } from "lodash"
// @Components
import { ErrorCard } from "lib/components/ErrorCard/ErrorCard"
import { SourceEditorFormStreamsLoadableForm } from "./SourceEditorFormStreamsLoadableForm"
import { LoadableFieldsLoadingMessageCard } from "lib/components/LoadingFormCard/LoadingFormCard"
// @Hooks
import { usePolling } from "hooks/usePolling"
// @Utils
import { sourceEditorUtilsAirbyte } from "./SourceEditor.utils"
import { addToArrayIfNotDuplicate, removeFromArrayIfFound, substituteArrayValueIfFound } from "utils/arrays"
// @Types
import { SourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
import { pullAllAirbyteStreams } from "./SourceEditorPullData"

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
  const previouslyCheckedStreams = useMemo<AirbyteStreamData[]>(
    () => initialSourceData?.config?.catalog?.streams ?? initialSourceData?.catalog?.streams ?? [],
    [initialSourceData]
  )

  const config = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        return {
          pullStreams: pullAllAirbyteStreams,
        }
      case "singer":
        return {}
    }
  }, [])

  const {
    isLoading,
    data,
    error,
    reload: restartPolling,
  } = usePolling<AirbyteStreamData[]>((end, fail) => async () => {
    try {
      const result = await pullAllAirbyteStreams(previouslyCheckedStreams, sourceDataFromCatalog, handleBringSourceData)
      if (result !== undefined) end(result)
    } catch (error) {
      fail(error)
    } finally {
      setConfigIsValidatedByStreams(true)
      setControlsDisabled(false)
    }
  })

  const selectAllFieldsByDefault: boolean = !previouslyCheckedStreams.length

  const initallySelectedFields = useMemo<AirbyteStreamData[]>(() => {
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
                error
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

// @Utils (temporary)

export const addStream = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  stream: AirbyteStreamData
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = addToArrayIfNotDuplicate(oldStreams, stream, sourceEditorUtilsAirbyte.streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const removeStream = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  stream: AirbyteStreamData
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = removeFromArrayIfFound(oldStreams, stream, sourceEditorUtilsAirbyte.streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const updateStream = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  stream: AirbyteStreamData
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = substituteArrayValueIfFound(oldStreams, stream, sourceEditorUtilsAirbyte.streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const setStreams = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  streams: AirbyteStreamData[],
  options?: {
    doNotSetStateChanged?: boolean
  }
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    newState.streams.streams[sourceDataPath] = streams
    if (!options?.doNotSetStateChanged) newState.stateChanged = true
    return newState
  })
}
