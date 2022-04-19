// @Libs
import React, { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react"
import { Collapse, Empty, Input, Select, Switch } from "antd"
import { cloneDeep } from "lodash"
// @Components
import { Code } from "lib/components/Code/Code"
// @Icons
import { CaretRightOutlined } from "@ant-design/icons"
// @Types
import { SetSourceEditorState } from "./SourceEditor"
// @Utils
import { isArray } from "utils/typeCheck"
import { addToArrayIfNotDuplicate, removeFromArrayIfFound, substituteArrayValueIfFound } from "utils/arrays"
// @Styles
import styles from "./SourceEditorFormStreamsLoadableForm.module.less"
import { sourceEditorUtils } from "./SourceEditor.utils"
import { getStreamFieldPaths } from "ui/pages/SourcesPage/utils/airbyte"
import set from "lodash/set"

type Props = {
  allStreams: StreamData[]
  initiallySelectedStreams: Array<StreamConfig> | null
  selectAllFieldsByDefault?: boolean
  hide?: boolean
  setSourceEditorState: SetSourceEditorState
}

const SELECTED_STREAMS_SOURCE_DATA_PATH = "config.selected_streams"

const SourceEditorFormStreamsLoadableForm = ({
  allStreams,
  initiallySelectedStreams,
  selectAllFieldsByDefault,
  hide,
  setSourceEditorState,
}: Props) => {
  const disableAllAnimations: boolean = allStreams.length > 30
  const disableToggelAllAnimations: boolean = allStreams.length > 10

  const [streamsToDisplay, setStreamsToDisplay] = useState<StreamData[]>(allStreams)

  const [allChecked, setAllChecked] = useState<boolean>(selectAllFieldsByDefault || undefined)

  const handleAddStream = (stream: StreamData) => {
    addStream(setSourceEditorState, SELECTED_STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleRemoveStream = (stream: StreamData) => {
    removeStream(setSourceEditorState, SELECTED_STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleSetSelectedStreams = (
    selectedStreams: Array<StreamConfig>,
    options?: {
      doNotSetStateChanged?: boolean
    }
  ) => {
    setSelectedStreams(setSourceEditorState, SELECTED_STREAMS_SOURCE_DATA_PATH, selectedStreams, options)
  }

  const handleToggleStream = useCallback((checked: boolean, stream: StreamData): void => {
    checked ? handleAddStream(stream) : handleRemoveStream(stream)
  }, [])

  const handleToggleAllStreams = async (checked: boolean) => {
    requestAnimationFrame(() => {
      setAllChecked(checked)
      checked
        ? handleSetSelectedStreams(allStreams.map(sourceEditorUtils.mapStreamDataToSelectedStreams))
        : handleSetSelectedStreams([])
    })
  }

  const handleSearch = (query: string) => {
    setStreamsToDisplay(streams =>
      streams.filter(streamData => sourceEditorUtils.getStreamUid(streamData).includes(query))
    )
  }

  const handleSearchValueClear = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.value === "") setTimeout(() => setStreamsToDisplay(allStreams), 0)
  }

  useEffect(() => {
    handleSetSelectedStreams(initiallySelectedStreams, { doNotSetStateChanged: true })
  }, [])

  return (
    <div
      className={`h-full w-full flex-col items-stretch ${hide ? "hidden" : "flex"} ${
        disableAllAnimations ? styles.disableAnimations : ""
      }`}
    >
      <div className="flex items-center mb-4">
        <Input.Search
          enterButton="Search"
          className="flex-auto"
          onSearch={handleSearch}
          onChange={handleSearchValueClear}
        />
        <div
          className="flex flex-grow-0 flex-shrink-0 items-center ml-4"
          onAnimationEndCapture={() => {}}
          onAnimationIterationCapture={() => {}}
        >
          <label>{"Toggle all"}</label>
          <Switch
            defaultChecked={true}
            className={`ml-2 ${disableToggelAllAnimations ? styles.disableAnimations : ""}`}
            onChange={handleToggleAllStreams}
          />
        </div>
      </div>
      <div className="flex-auto overflow-y-auto pb-2">
        {streamsToDisplay?.length ? (
          <StreamsCollapsibleList
            streamsToDisplay={streamsToDisplay}
            initiallySelectedStreams={initiallySelectedStreams}
            isAllStreamsChecked={allChecked}
            handleToggleStream={handleToggleStream}
            setSourceEditorState={setSourceEditorState}
          />
        ) : (
          <Empty className="h-full flex flex-col justify-center items-center" />
        )}
      </div>
    </div>
  )
}
SourceEditorFormStreamsLoadableForm.displayName = "SourceEditorFormStreamsLoadableForm"

export { SourceEditorFormStreamsLoadableForm }

// @Components

type StreamsCollapsibleListProps = {
  streamsToDisplay: StreamData[]
  initiallySelectedStreams: StreamConfig[]
  isAllStreamsChecked?: boolean
  setSourceEditorState: SetSourceEditorState
  handleToggleStream: (checked: boolean, stream: StreamData) => void
}

const StreamsCollapsibleList: React.FC<StreamsCollapsibleListProps> = React.memo(
  ({ streamsToDisplay, initiallySelectedStreams, isAllStreamsChecked, handleToggleStream, setSourceEditorState }) => {
    return (
      <Collapse
        expandIconPosition="left"
        expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
      >
        {streamsToDisplay
          /* moves initially selected streams to the top of the list */
          .sort((a, b) => {
            const [aUid, bUid] = [a, b].map(sourceEditorUtils.getStreamUid)
            const [aIsInitiallySelected, bIsInitiallySelected] = [aUid, bUid].map(uid =>
              initiallySelectedStreams.some(selected => sourceEditorUtils.getSelectedStreamUid(selected) === uid)
            )
            return Number(bIsInitiallySelected) - Number(aIsInitiallySelected)
          })
          .map(streamData => {
            const streamUid = sourceEditorUtils.getStreamUid(streamData)
            return (
              <StreamPanel
                key={streamUid}
                streamData={streamData}
                streamUid={streamUid}
                initiallySelectedStreams={initiallySelectedStreams}
                forceChecked={isAllStreamsChecked}
                handleToggleStream={handleToggleStream}
                setSourceEditorState={setSourceEditorState}
              />
            )
          })}
      </Collapse>
    )
  }
)

type StreamPanelProps = {
  streamUid: string
  streamData: StreamData
  initiallySelectedStreams: StreamConfig[]
  forceChecked?: boolean
  handleToggleStream: (checked: boolean, stream: StreamData) => void
  setSourceEditorState: SetSourceEditorState
} & { [key: string]: any }

const StreamPanel: React.FC<StreamPanelProps> = ({
  streamUid,
  streamData: initialStreamData,
  initiallySelectedStreams,
  forceChecked,
  handleToggleStream,
  setSourceEditorState,
  children,
  ...rest
}) => {
  console.log("Stream Uid: " + streamUid)
  const [checked, setChecked] = useState<boolean>(
    forceChecked ||
      initiallySelectedStreams.some(selected => sourceEditorUtils.getSelectedStreamUid(selected) === streamUid)
  )

  const [streamData, setStreamData] = useState<StreamData>(initialStreamData)

  const toggle = (checked: boolean, event: MouseEvent) => {
    event.stopPropagation() // hack to prevent collapse triggers
    setChecked(checked)
    handleToggleStream(checked, streamData)
  }

  /**
   * Creates source type specific methods and components
   */
  const { header, content } = useMemo<{ header: JSX.Element; content: JSX.Element }>(() => {
    if (sourceEditorUtils.isAirbyteStream(streamData)) {
      const handleChangeStreamConfig = (stream: AirbyteStreamData): void => {
        setStreamData(stream)
        updateStream(setSourceEditorState, SELECTED_STREAMS_SOURCE_DATA_PATH, { ...stream })
      }
      return {
        header: (
          <AirbyteStreamHeader streamName={streamData.stream.name} streamNamespace={streamData.stream.namespace} />
        ),
        content: (
          <AirbyteStreamParameters
            streamData={streamData}
            checked={checked}
            handleChangeStreamConfig={handleChangeStreamConfig}
          />
        ),
      }
    }
    else if (sourceEditorUtils.isSDKSourceStream(streamData)) {
      const handleChangeStreamConfig = (stream: SDKSourceStreamData): void => {
        setStreamData(stream)
        updateStream(setSourceEditorState, SELECTED_STREAMS_SOURCE_DATA_PATH, { ...stream })
      }
      return {
        header: (
          <SDKSourceStreamHeader streamName={streamData.stream.streamName} />
        ),
          content: (
        <SDKSourceStreamParameters
          streamData={streamData}
          checked={checked}
          handleChangeStreamConfig={handleChangeStreamConfig}
        />
      ),
      }
    }
    else if (sourceEditorUtils.isSingerStream(streamData)) {
      return {
        header: <SingerStreamHeader streamUid={streamData.tap_stream_id} streamName={streamData.stream} />,
        content: <SingerStreamParameters streamData={streamData} />,
      }
    }
  }, [streamData, checked])

  /** Used to force check all streams by the parent component */
  useEffect(() => {
    if (forceChecked !== undefined) setChecked(forceChecked)
  }, [forceChecked])

  return (
    <Collapse.Panel
      {...rest}
      key={streamUid}
      header={header}
      extra={<Switch checked={checked} className="absolute top-3 right-3" onChange={toggle} />}
    >
      {content}
    </Collapse.Panel>
  )
}

type AirbyteStreamHeaderProps = {
  streamName: string
  streamNamespace: string
}

const AirbyteStreamHeader: React.FC<AirbyteStreamHeaderProps> = ({ streamName, streamNamespace }) => {
  return (
    <div className="flex w-full pr-12 flex-wrap xl:flex-nowrap">
      <div className={"whitespace-nowrap min-w-0 max-w-lg overflow-hidden overflow-ellipsis pr-2"}>
        {streamNamespace && <span>Name:&nbsp;&nbsp;</span>}
        <b title={streamName}>{streamName}</b>
      </div>
      {streamNamespace && (
        <div className={"whitespace-nowrap min-w-0 max-w-lg overflow-hidden overflow-ellipsis pr-2"}>
          Namespace:&nbsp;&nbsp;
          <b title={streamNamespace}>{streamNamespace}</b>
        </div>
      )}
    </div>
  )
}

type AirbyteStreamParametersProps = {
  streamData: AirbyteStreamData
  checked?: boolean
  handleChangeStreamConfig: (stream: AirbyteStreamData) => void
}

const AirbyteStreamParameters: React.FC<AirbyteStreamParametersProps> = ({
  streamData,
  checked,
  handleChangeStreamConfig,
}) => {
  const cursorFieldPathDelimiter = " -> "
  const initialSyncMode = streamData.sync_mode ?? streamData.stream.supported_sync_modes?.[0]
  const needToDisplayData: boolean = !!initialSyncMode && !!streamData.stream.json_schema?.properties
  const [config, setConfig] = useState<Pick<AirbyteStreamData, "sync_mode" | "cursor_field">>({
    sync_mode: initialSyncMode,
    cursor_field: streamData.stream.source_defined_cursor
      ? streamData.stream.default_cursor_field
      : streamData.cursor_field ?? getAirbyteStreamCursorFields(streamData)[0],
  })

  const handleChangeSyncMode = (value: string): void => {
    setConfig(config => {
      let newConfig = config
      if (value === "full_refresh") newConfig = { ...config, sync_mode: value }
      if (value === "incremental")
        newConfig = {
          sync_mode: value,
          cursor_field: config.cursor_field,
        }
      handleChangeStreamConfig({ ...streamData, ...newConfig })
      return newConfig
    })
  }

  const handleChangeCursorField = (value: string): void => {
    setConfig(config => {
      const newConfig = { ...config, cursor_field: value.split(cursorFieldPathDelimiter) }
      handleChangeStreamConfig({ ...streamData, ...newConfig })
      return newConfig
    })
  }

  return (
    needToDisplayData && (
      <div className="flex flex-col w-full h-full flex-wrap">
        {/* Sync mode */}
        {streamData.stream.supported_sync_modes?.length ? (
          <StreamParameter title="Sync mode">
            <Select
              size="small"
              value={config.sync_mode}
              disabled={!checked}
              style={{ minWidth: 150 }}
              onChange={handleChangeSyncMode}
            >
              {streamData.stream.supported_sync_modes.map(mode => (
                <Select.Option key={mode} value={mode}>
                  {mode}
                </Select.Option>
              ))}
            </Select>
          </StreamParameter>
        ) : initialSyncMode ? (
          <StreamParameter title="Sync mode">{initialSyncMode}</StreamParameter>
        ) : null}

        {/* Cursor field */}
        {config.sync_mode === "incremental" && (
          <StreamParameter title="Cursor field">
            <Select
              size="small"
              value={config.cursor_field.join(cursorFieldPathDelimiter)}
              disabled={!checked || streamData.stream.source_defined_cursor}
              // className={`w-56`}
              dropdownMatchSelectWidth={false}
              style={{ minWidth: 150 }}
              showSearch
              onChange={handleChangeCursorField}
            >
              {getAirbyteStreamCursorFields(streamData).map(cursor => {
                const stringifiedCursor = cursor.join(cursorFieldPathDelimiter)
                return (
                  <Select.Option key={stringifiedCursor} value={stringifiedCursor}>
                    {stringifiedCursor}
                  </Select.Option>
                )
              })}
            </Select>
          </StreamParameter>
        )}

        {/* JSON Schema */}
        {streamData.stream.json_schema.properties && (
          <StreamParameter title="JSON Schema">
            <div className="max-h-72 w-full overflow-y-auto">
              <Code language="json" className="w-full">
                {JSON.stringify(streamData.stream.json_schema.properties ?? {}, null, 2)}
              </Code>
            </div>
          </StreamParameter>
        )}
      </div>
    )
  )
}

type SDKSourceStreamHeaderProps = {
  streamName: string
}

const SDKSourceStreamHeader: React.FC<SDKSourceStreamHeaderProps> = ({ streamName}) => {
  return (
    <div className="flex w-full pr-12 flex-wrap xl:flex-nowrap">
      <div className={"whitespace-nowrap min-w-0 max-w-lg overflow-hidden overflow-ellipsis pr-2"}>
        <b title={streamName}>{streamName}</b>
      </div>
    </div>
  )
}

type SDKSourceStreamParametersProps = {
  streamData: SDKSourceStreamData
  checked?: boolean
  handleChangeStreamConfig: (stream: SDKSourceStreamData) => void
}

const SDKSourceStreamParameters: React.FC<SDKSourceStreamParametersProps> = ({
                                                                           streamData,
                                                                           checked,
                                                                           handleChangeStreamConfig,
                                                                         }) => {
  const initialSyncMode = streamData.mode ?? streamData.stream.supported_modes?.[0]
  const initialParams = streamData.stream.params.reduce((accumulator: any, current: SdkSourceStreamConfigurationParameter) => {
    if (current.defaultValue) {
      set(accumulator, current.id, current.defaultValue)
    }
    return accumulator
  }, {})
  const needToDisplayData: boolean = !!initialSyncMode || streamData.stream.params.length > 0
  const [config, setConfig] = useState<Pick<SDKSourceStreamData, "mode" | "params">>({
    mode: initialSyncMode,
    params: {...initialParams, ...streamData.params}
  })

  const handleChangeSyncMode = (value: string): void => {
    setConfig(config => {
      let newConfig = config
      if (value === "full_sync") newConfig = { ...config, mode: value }
      if (value === "incremental")
        newConfig = {
          ...config,
          mode: value
        }
      handleChangeStreamConfig({ ...streamData, ...newConfig })
      return newConfig
    })
  }

  const handleChangeField = (id:string) =>  ( e:ChangeEvent<HTMLInputElement>): void => {
    setConfig(config => {
      const newConfig = { ...config, params:{...config.params, [id]: e.target.value} }
      handleChangeStreamConfig({ ...streamData, ...newConfig })
      return newConfig
    })
  }

  return (
    needToDisplayData && (
      <div className="flex flex-col w-full h-full flex-wrap">
        {/* Sync mode */}
        {streamData.stream.supported_modes?.length ? (
          <StreamParameter title="Sync mode">
            <Select
              size="small"
              value={config.mode}
              disabled={!checked}
              style={{ minWidth: 150 }}
              onChange={handleChangeSyncMode}
            >
              {streamData.stream.supported_modes.map(mode => (
                <Select.Option key={mode} value={mode}>
                  {mode}
                </Select.Option>
              ))}
            </Select>
          </StreamParameter>
        ) : initialSyncMode ? (
          <StreamParameter title="Sync mode">{initialSyncMode}</StreamParameter>
        ) : null}

        <>
          {streamData.stream.params.map( param => {
            return <StreamParameter title={param.displayName} key={param.id}>
              <Input value={streamData.params?.[param.id]} onChange={handleChangeField(param.id)}></Input>
            </StreamParameter>
            })
          }
        </>
      </div>
    )
  )
}

type SingerStreamHeaderProps = {
  streamUid: string
  streamName: string
}

const SingerStreamHeader: React.FC<SingerStreamHeaderProps> = ({ streamUid, streamName }) => {
  return (
    <div className="flex w-full pr-12 flex-wrap xl:flex-nowrap">
      <div className={"whitespace-nowrap min-w-0 max-w-lg overflow-hidden overflow-ellipsis pr-2"}>
        <b title={streamName}>{streamName}</b>
      </div>
    </div>
  )
}

type SingerStreamParametersProps = {
  streamData: SingerStreamData
}

const SingerStreamParameters: React.FC<SingerStreamParametersProps> = ({ streamData }) => {
  return (
    <div className="flex flex-col w-full h-full flex-wrap">
      {/* <StreamParameter title="Destination Sync Mode">{streamDestinationSyncMode}</StreamParameter> */}

      {streamData.schema && (
        <StreamParameter title="JSON Schema">
          <div className="max-h-72 w-full overflow-y-auto">
            <Code language="json" className="w-full">
              {JSON.stringify(streamData.schema ?? {}, null, 2)}
            </Code>
          </div>
        </StreamParameter>
      )}
    </div>
  )
}

type StreamParameterProps = {
  title: string
}

const StreamParameter: React.FC<StreamParameterProps> = ({ title, children }) => {
  return (
    <div className="flex flex-row mb-1">
      <label className="flex-grow-0 flex-shink-0 w-1/5 max-w-xs text-right truncate">{title}</label>
      <span className="flex-shrink-0 pr-2">{":"}</span>
      <span className="flex-grow flex-shrink font-bold">{children}</span>
    </div>
  )
}

// @Streams Utils (temporary)

export const addStream = (setSourceEditorState: SetSourceEditorState, sourceDataPath: string, stream: StreamData) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.selectedStreams[sourceDataPath]
    const streamConfig = sourceEditorUtils.mapStreamDataToSelectedStreams(stream)

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = addToArrayIfNotDuplicate(oldStreams, streamConfig, sourceEditorUtils.streamsAreEqual)
    }

    newState.streams.selectedStreams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const removeStream = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  stream: StreamData
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.selectedStreams[sourceDataPath]
    const streamConfig = sourceEditorUtils.mapStreamDataToSelectedStreams(stream)

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = removeFromArrayIfFound(oldStreams, streamConfig, sourceEditorUtils.streamsAreEqual)
    }

    delete newStreams[sourceEditorUtils.getStreamUid(stream)]

    newState.streams.selectedStreams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const updateStream = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  stream: StreamData
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.selectedStreams[sourceDataPath]
    console.log("Stream: " + JSON.stringify(stream))

    const streamConfig = sourceEditorUtils.mapStreamDataToSelectedStreams(stream)

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      console.log("Stream Config: " + JSON.stringify(streamConfig))
      newStreams = substituteArrayValueIfFound(oldStreams, streamConfig, sourceEditorUtils.streamsAreEqual)
    }

    newState.streams.selectedStreams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const setSelectedStreams = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  selectedStreams: Array<StreamConfig>,
  options?: {
    doNotSetStateChanged?: boolean
  }
) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    newState.streams.selectedStreams[sourceDataPath] = selectedStreams
    if (!options?.doNotSetStateChanged) newState.stateChanged = true
    return newState
  })
}

const getAirbyteStreamCursorFields = (stream: AirbyteStreamData): string[][] => {
  return getStreamFieldPaths(stream)
}
