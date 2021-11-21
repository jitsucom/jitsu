// @Libs
import React, { useCallback, useEffect, useState } from "react"
import { Collapse, Empty, Select, Switch, Input } from "antd"
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

type Props = {
  allStreams: StreamData[]
  initiallySelectedStreams: StreamData[] | null
  selectAllFieldsByDefault?: boolean
  hide?: boolean
  setSourceEditorState: SetSourceEditorState
}

const STREAMS_SOURCE_DATA_PATH = "config.catalog.streams"

const SourceEditorFormStreamsLoadableForm = ({
  allStreams,
  initiallySelectedStreams,
  selectAllFieldsByDefault,
  hide,
  setSourceEditorState,
}: Props) => {
  const disableAllAnimations: boolean = allStreams.length > 30
  const disableToggelAllAnimations: boolean = allStreams.length > 10

  const initiallyCheckedStreams = selectAllFieldsByDefault ? allStreams : initiallySelectedStreams ?? []

  const [streamsToDisplay, setStreamsToDisplay] = useState<StreamData[]>(allStreams)

  const [allChecked, setAllChecked] = useState<boolean>(selectAllFieldsByDefault || undefined)

  const handleAddStream = (stream: StreamData) => {
    addStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleRemoveStream = (stream: StreamData) => {
    removeStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleSetStreams = (
    streams: StreamData[],
    options?: {
      doNotSetStateChanged?: boolean
    }
  ) => {
    setStreams(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, streams, options)
  }

  const handleToggleStream = useCallback((checked: boolean, streamUid: string): void => {
    debugger
    const stream = allStreams.find(stream => getStreamUid(stream) === streamUid)
    checked ? handleAddStream(stream) : handleRemoveStream(stream)
  }, [])

  const handleToggleAllStreams = async (checked: boolean) => {
    requestAnimationFrame(() => {
      setAllChecked(checked)
      checked ? handleSetStreams(allStreams) : handleSetStreams([])
    })
  }

  const handleSearch = (query: string) => {
    setStreamsToDisplay(streams => streams.filter(streamData => getStreamUid(streamData).includes(query)))
  }

  const handleSearchValueClear = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.value === "") setTimeout(() => setStreamsToDisplay(allStreams), 0)
  }

  useEffect(() => {
    handleSetStreams(initiallyCheckedStreams, { doNotSetStateChanged: true })
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
            allStreamsChecked={allChecked}
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

// @Utils
const getStreamUid = (stream: StreamData): string => {
  if (isAirbyteStream(stream)) {
    return getAirbyteStreamUniqueId(stream)
  } else if (isSingerStream(stream)) {
    return getSingerStreamUniqueId(stream)
  }
}

const streamsAreEqual = (streamA: StreamData, streamB: StreamData) => getStreamUid(streamA) === getStreamUid(streamB)

const isAirbyteStream = (stream: StreamData): stream is AirbyteStreamData => {
  return "stream" in stream && typeof stream.stream === "object"
}

const isSingerStream = (stream: StreamData): stream is SingerStreamData => {
  return "tap_stream_id" in stream
}

function getAirbyteStreamUniqueId(data: AirbyteStreamData): string {
  return `${data.stream?.name}__${data.stream.namespace}`
}

function getSingerStreamUniqueId(data: SingerStreamData): string {
  return `${data.stream}__${data.tap_stream_id}`
}

// @Components

type StreamsCollapsibleListProps = {
  streamsToDisplay: StreamData[]
  initiallySelectedStreams: StreamData[]
  allStreamsChecked?: boolean
  setSourceEditorState: SetSourceEditorState
  handleToggleStream: (checked: boolean, streamUid: string) => void
}

const StreamsCollapsibleList: React.FC<StreamsCollapsibleListProps> = React.memo(
  ({ streamsToDisplay, initiallySelectedStreams, allStreamsChecked, handleToggleStream, setSourceEditorState }) => {
    /**
     * Creates source-type-specific methods and components
     */
    const getStreamUiComponents = (streamData: StreamData) => {
      if (isAirbyteStream(streamData)) {
        const handleChangeStreamSyncMode = (mode: string, stream: AirbyteStreamData): void => {
          const newStream = { ...stream }
          newStream.sync_mode = mode
          updateStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, newStream)
        }
        return {
          header: (
            <AirbyteStreamHeader streamName={streamData.stream.name} streamNamespace={streamData.stream.namespace} />
          ),
          content: (
            <AirbyteStreamParameters
              streamData={streamData}
              checked={allStreamsChecked}
              handleChangeStreamSyncMode={handleChangeStreamSyncMode}
            />
          ),
        }
      } else if (isSingerStream(streamData)) {
        return {
          header: <SingerStreamHeader streamUid={streamData.tap_stream_id} streamName={streamData.stream} />,
          content: <SingerStreamParameters streamData={streamData} />,
        }
      }
    }

    return (
      <Collapse
        expandIconPosition="left"
        destroyInactivePanel
        expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
      >
        {streamsToDisplay.map((streamData, idx) => {
          const streamUid = getStreamUid(streamData)
          const { header, content } = getStreamUiComponents(streamData)
          return (
            <StreamPanel
              key={streamUid}
              streamUid={streamUid}
              header={header}
              initiallySelectedStreams={initiallySelectedStreams}
              checked={allStreamsChecked}
              handleToggleStream={handleToggleStream}
            >
              {content}
            </StreamPanel>
          )
        })}
      </Collapse>
    )
  }
)

type StreamPanelProps = {
  streamUid: string
  header: JSX.Element
  initiallySelectedStreams: StreamData[]
  checked?: boolean
  handleToggleStream: (checked: boolean, streamUid: string) => void
} & { [key: string]: any }

const StreamPanel: React.FC<StreamPanelProps> = ({
  header,
  streamUid,
  initiallySelectedStreams,
  checked: _checked,
  handleToggleStream,
  children,
  ...rest
}) => {
  const [checked, setChecked] = useState<boolean>(
    _checked || initiallySelectedStreams.some(selected => getStreamUid(selected) === streamUid)
  )

  const toggle = (checked: boolean, event: MouseEvent) => {
    event.stopPropagation() // hacky way to prevent collapse triggers
    setChecked(checked)
    handleToggleStream(checked, streamUid)
  }

  useEffect(() => {
    if (_checked !== undefined) setChecked(_checked)
  }, [_checked])

  return (
    <Collapse.Panel
      {...rest}
      key={streamUid}
      header={header}
      extra={<Switch checked={checked} className="absolute top-3 right-3" onChange={toggle} />}
    >
      {children}
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
  handleChangeStreamSyncMode: (mode: string, stream: AirbyteStreamData) => void
}

const AirbyteStreamParameters: React.FC<AirbyteStreamParametersProps> = ({
  streamData,
  checked,
  handleChangeStreamSyncMode,
}) => {
  const initialSyncMode = streamData.sync_mode ?? streamData.stream.supported_sync_modes?.[0]
  const needToDisplayData: boolean = !!initialSyncMode && !!streamData.stream.json_schema?.properties
  const [syncMode, setSyncMode] = useState<string>(initialSyncMode)
  const handleChangeSyncMode = value => {
    setSyncMode(value)
    handleChangeStreamSyncMode(value, streamData)
  }
  return needToDisplayData ? (
    <div className="flex flex-col w-full h-full flex-wrap">
      {/* {streamData.stream.supported_sync_modes?.length ? ( */}
      {false ? ( // temporarily disables sync mode selection
        <StreamParameter title="Sync mode">
          <Select size="small" value={syncMode} disabled={!checked} onChange={handleChangeSyncMode}>
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
  ) : null
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
      <span className="flex-grow flex-shrink min-w-0 font-bold">{children}</span>
    </div>
  )
}

// @Streams Utils (temporary)

export const addStream = (setSourceEditorState: SetSourceEditorState, sourceDataPath: string, stream: StreamData) => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = addToArrayIfNotDuplicate(oldStreams, stream, streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
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
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = removeFromArrayIfFound(oldStreams, stream, streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
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
    const oldStreams = newState.streams.streams[sourceDataPath]

    let newStreams = oldStreams
    if (isArray(oldStreams)) {
      newStreams = substituteArrayValueIfFound(oldStreams, stream, streamsAreEqual)
    }

    newState.streams.streams[sourceDataPath] = newStreams
    newState.stateChanged = true

    return newState
  })
}

export const setStreams = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  streams: StreamData[],
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
