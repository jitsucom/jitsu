// @Libs
import React, { useCallback, useEffect, useState } from 'react';
import { Collapse, Empty, Select, Switch } from 'antd';
import { cloneDeep } from "lodash"
// @Components
import Search from "antd/lib/input/Search"
import { Code } from "lib/components/Code/Code"
// @Icons
import { CaretRightOutlined } from "@ant-design/icons"
// @Types
import { SetSourceEditorState } from "./SourceEditor"
// @Utils
import { addStream, removeStream, setStreams, updateStream } from "./SourceEditorFormStreams"
// @Styles
import styles from "./SourceEditorFormStreamsLoadableForm.module.less"

interface Props {
  allStreams: Array<AirbyteStreamData>
  initiallySelectedStreams: Array<AirbyteStreamData> | null
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
  const disableAnimations: boolean = allStreams.length > 30

  const initiallyCheckedStreams = selectAllFieldsByDefault ? allStreams : initiallySelectedStreams ?? []

  const [streamsToDisplay, setStreamsToDisplay] = useState<AirbyteStreamData[]>(allStreams)

  const [allChecked, setAllChecked] = useState<boolean>(selectAllFieldsByDefault || undefined)

  const handleAddStream = (stream: AirbyteStreamData) => {
    addStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleRemoveStream = (stream: AirbyteStreamData) => {
    removeStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
  }

  const handleSetStreams = (
    streams: AirbyteStreamData[],
    options?: {
      doNotSetStateChanged?: boolean
    }
  ) => {
    setStreams(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, streams, options)
  }

  const handleToggleStream = useCallback((checked: boolean, streamUid: string): void => {
    const stream = allStreams.find(stream => getAirbyteStreamUniqueId(stream) === streamUid)
    checked ? handleAddStream(stream) : handleRemoveStream(stream)
  }, [])

  const handleToggleAllStreams = (checked: boolean) => {
    requestAnimationFrame(() => {
      setAllChecked(checked)
      checked ? handleSetStreams(allStreams) : handleSetStreams([])
    })
  }

  const handleChangeStreamSyncMode = useCallback((mode: string, streamUid: string): void => {
    const stream = allStreams.find(stream => getAirbyteStreamUniqueId(stream) === streamUid)
    const newStream = cloneDeep(stream)
    newStream.sync_mode = mode
    updateStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, newStream)
  }, [])

  const handleSearch = (query: string) => {
    setStreamsToDisplay(streams =>
      streams.filter(
        streamData => streamData.stream.name.includes(query) || streamData.stream.namespace?.includes(query)
      )
    )
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
        disableAnimations ? styles.disableAnimations : ""
      }`}>
      <div className="flex items-center mb-4">
        <Search enterButton="Search" className="flex-auto" onSearch={handleSearch} onChange={handleSearchValueClear} />
        <div
          className="flex flex-grow-0 flex-shrink-0 items-center ml-4"
          onAnimationEndCapture={() => {}}
          onAnimationIterationCapture={() => {}}>
          <label>{"Toggle all"}</label>
          <Switch defaultChecked={true} className="ml-2" onChange={handleToggleAllStreams} />
        </div>
      </div>
      <div className="flex-auto overflow-y-auto pb-2">
        {streamsToDisplay?.length ? (
          <StreamsCollapsibleList
            streamsToDisplay={streamsToDisplay}
            initiallySelectedStreams={initiallySelectedStreams}
            selectAllFieldsByDefault={selectAllFieldsByDefault}
            allStreamsChecked={allChecked}
            handleToggleStream={handleToggleStream}
            handleChangeStreamSyncMode={handleChangeStreamSyncMode}
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

type StreamNames = { streamName: string; streamNamespace?: string }
function getAirbyteStreamUniqueId(stream: AirbyteStreamData): string
function getAirbyteStreamUniqueId(names: StreamNames)

function getAirbyteStreamUniqueId(data: AirbyteStreamData | StreamNames): string {
  if ("stream" in data) {
    return `${data.stream?.name}__${data.stream.namespace}`
  }
  if ("streamName" in data) {
    return `${data.streamName}__${data.streamNamespace ?? "stream"}`
  }
}
const getAirbyteStreamsUniqueIds = (streams: AirbyteStreamData[]): string[] => streams.map(getAirbyteStreamUniqueId)

// @Components

type StreamsCollapsibleListProps = {
  streamsToDisplay: AirbyteStreamData[]
  initiallySelectedStreams: AirbyteStreamData[]
  selectAllFieldsByDefault: boolean
  allStreamsChecked?: boolean
  handleToggleStream: (checked: boolean, streamUid: string) => void
  handleChangeStreamSyncMode: (mode: string, streamUid: string) => void
}

const StreamsCollapsibleListComponent: React.FC<StreamsCollapsibleListProps> = ({
  streamsToDisplay,
  initiallySelectedStreams,
  selectAllFieldsByDefault,
  allStreamsChecked,
  handleToggleStream,
  handleChangeStreamSyncMode,
}) => {
  return (
    <Collapse
      collapsible="header"
      expandIconPosition="left"
      destroyInactivePanel
      expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}>
      {streamsToDisplay.map(streamData => {
        const showSyncModeSelection = streamData.stream.supported_sync_modes.length > 1
        const streamJsonSchemaString = JSON.stringify(streamData.stream.json_schema?.properties, null, 2)
        return (
          <StreamPanel
            streamName={streamData.stream.name}
            streamNamespace={streamData.stream.namespace}
            streamSyncMode={streamData.sync_mode}
            streamSupportedSyncModes={streamData.stream.supported_sync_modes}
            streamDestinationSyncMode={streamData.destination_sync_mode}
            streamJsonSchemaString={streamJsonSchemaString}
            initiallySelectedStreams={initiallySelectedStreams}
            showSyncModeSelection={showSyncModeSelection}
            selectAllFieldsByDefault={selectAllFieldsByDefault}
            checked={allStreamsChecked}
            handleToggleStream={handleToggleStream}
            handleChangeStreamSyncMode={handleChangeStreamSyncMode}
          />
        )
      })}
    </Collapse>
  )
}

const StreamsCollapsibleList = React.memo(StreamsCollapsibleListComponent)

type StreamPanelProps = {
  streamName: string
  streamNamespace: string
  streamSyncMode: string
  streamSupportedSyncModes: string[]
  streamDestinationSyncMode: string
  streamJsonSchemaString: string
  initiallySelectedStreams: AirbyteStreamData[]
  showSyncModeSelection: boolean
  selectAllFieldsByDefault: boolean
  checked?: boolean
  handleToggleStream: (checked: boolean, streamUid: string) => void
  handleChangeStreamSyncMode: (mode: string, streamUid: string) => void
}

const StreamPanelComponent: React.FC<StreamPanelProps> = ({
  streamName,
  streamNamespace,
  streamSyncMode,
  streamSupportedSyncModes,
  streamDestinationSyncMode,
  streamJsonSchemaString,
  initiallySelectedStreams,
  showSyncModeSelection,
  selectAllFieldsByDefault,
  checked: _checked,
  handleToggleStream,
  handleChangeStreamSyncMode,
}) => {
  const streamUid = getAirbyteStreamUniqueId({ streamName, streamNamespace })
  const [checked, setChecked] = useState<boolean>(() => {
    return selectAllFieldsByDefault
      ? true
      : initiallySelectedStreams.some(
          selected => selected.stream.name === streamName && selected.stream.namespace === streamNamespace
        )
  })

  const toggle = (checked: boolean) => {
    setChecked(checked)
    handleToggleStream(checked, streamUid)
  }

  useEffect(() => {
    if (_checked !== undefined) setChecked(_checked)
  }, [_checked])

  return (
    <Collapse.Panel
      key={streamUid}
      header={
        <div className="flex w-full pr-12 flex-wrap xl:flex-nowrap">
          <div
            className={
              "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
            }>
            <span>Name:&nbsp;&nbsp;</span>
            <b title={streamName}>{streamName}</b>
          </div>
          {streamNamespace && (
            <div
              className={
                "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
              }>
              Namespace:&nbsp;&nbsp;
              <b title={streamNamespace}>{streamNamespace}</b>
            </div>
          )}
          <div
            className={`whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden ${
              !showSyncModeSelection && "overflow-ellipsis"
            } pr-2`}>
            Sync Mode:&nbsp;&nbsp;
            {showSyncModeSelection ? (
              <Select
                size="small"
                disabled={!checked}
                defaultValue={streamSyncMode ?? streamSupportedSyncModes?.[0]}
                onChange={value => handleChangeStreamSyncMode(value, streamUid)}
                onClick={e => {
                  // hack to prevent antd expanding the collapsible
                  e.stopPropagation()
                }}>
                {streamSupportedSyncModes.map(mode => (
                  <Select.Option key={mode} value={mode}>
                    {mode}
                  </Select.Option>
                ))}
              </Select>
            ) : (
              <b title={streamSyncMode}>{streamSyncMode}</b>
            )}
          </div>
          <div
            className={
              "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
            }>
            Destination Sync Mode:&nbsp;&nbsp;
            <b title={streamNamespace}>{streamDestinationSyncMode}</b>
          </div>
        </div>
      }
      extra={
        <Switch
          checked={checked}
          defaultChecked={
            selectAllFieldsByDefault
              ? true
              : initiallySelectedStreams.some(
                  selected => selected.stream.name === streamName && selected.stream.namespace === streamNamespace
                )
          }
          className="absolute top-3 right-3"
          onChange={toggle}
        />
      }>
      <div className="max-h-72 w-full overflow-y-auto">
        <Code language="json" className="w-full">
          {streamJsonSchemaString ?? "null"}
        </Code>
      </div>
    </Collapse.Panel>
  )
}

const StreamPanel = React.memo(StreamPanelComponent)