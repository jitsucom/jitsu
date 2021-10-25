// @Libs
import React, { useCallback, useEffect, useState } from 'react';
import { Collapse, Empty, Select, Switch } from 'antd';
import { cloneDeep } from 'lodash';
// @Components
import Search from 'antd/lib/input/Search';
import { Code } from 'lib/components/Code/Code';
// @Icons
import { CaretRightOutlined } from '@ant-design/icons';
// @Types
import { SetSourceEditorState } from "./SourceEditor"
// @Utils
import { addStream, removeStream, setStreams, updateStream } from "./SourceEditorFormStreams"

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
  const initiallyCheckedStreams = selectAllFieldsByDefault ? allStreams : initiallySelectedStreams ?? []

  const [streamsToDisplay, setStreamsToDisplay] = useState<AirbyteStreamData[]>(allStreams)

  const [checked, setChecked] = useState<Set<string>>(new Set(getAirbyteStreamsUniqueIds(initiallySelectedStreams)))

  const handleAddStream = (stream: AirbyteStreamData) => {
    addStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
    setChecked(checkedStreams => new Set(checkedStreams).add(getAirbyteStreamUniqueId(stream)))
  }

  const handleRemoveStream = (stream: AirbyteStreamData) => {
    removeStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, stream)
    setChecked(checkedStreams => {
      const newState = new Set(checkedStreams)
      newState.delete(getAirbyteStreamUniqueId(stream))
      return newState
    })
  }

  const handleSetStreams = (
    streams: AirbyteStreamData[],
    options?: {
      doNotSetStateChanged?: boolean
    }
  ) => {
    setStreams(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, streams, options)
    setChecked(new Set(getAirbyteStreamsUniqueIds(streams)))
  }

  const handleToggleStream = useCallback((checked: boolean, stream: AirbyteStreamData): void => {
    checked ? handleAddStream(stream) : handleRemoveStream(stream)
  }, [])

  const handleToggleAllStreams = (checked: boolean) => {
    checked ? handleSetStreams(allStreams) : handleSetStreams([])
  }

  const handleChangeStreamSyncMode = (mode: string, stream: AirbyteStreamData): void => {
    const newStream = cloneDeep(stream)
    newStream.sync_mode = mode
    updateStream(setSourceEditorState, STREAMS_SOURCE_DATA_PATH, newStream)
  }

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
    <div className={`h-full w-full flex-col items-stretch ${hide ? "hidden" : "flex"}`}>
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
          <Collapse
            collapsible="header"
            expandIconPosition="left"
            destroyInactivePanel
            expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}>
            {streamsToDisplay.map(streamData => {
              const showSyncModeSelection = streamData.stream.supported_sync_modes.length > 1
              return (
                <Collapse.Panel
                  key={`${streamData.stream.name}__${streamData.stream.namespace}`}
                  header={
                    <div className="flex w-full pr-12 flex-wrap xl:flex-nowrap">
                      <div
                        className={
                          "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
                        }>
                        <span>Name:&nbsp;&nbsp;</span>
                        <b title={streamData.stream.name}>{streamData.stream.name}</b>
                      </div>
                      {streamData.stream.namespace && (
                        <div
                          className={
                            "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
                          }>
                          Namespace:&nbsp;&nbsp;
                          <b title={streamData.stream.namespace}>{streamData.stream.namespace}</b>
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
                            disabled={!checked.has(getAirbyteStreamUniqueId(streamData))}
                            defaultValue={streamData.sync_mode ?? streamData.stream.supported_sync_modes?.[0]}
                            onChange={value => handleChangeStreamSyncMode(value, streamData)}
                            onClick={e => {
                              // hack to prevent antd expanding the collapsible
                              e.stopPropagation()
                            }}>
                            {streamData.stream.supported_sync_modes.map(mode => (
                              <Select.Option key={mode} value={mode}>
                                {mode}
                              </Select.Option>
                            ))}
                          </Select>
                        ) : (
                          <b title={streamData.sync_mode}>{streamData.sync_mode}</b>
                        )}
                      </div>
                      <div
                        className={
                          "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
                        }>
                        Destination Sync Mode:&nbsp;&nbsp;
                        <b title={streamData.stream.namespace}>{streamData.destination_sync_mode}</b>
                      </div>
                    </div>
                  }
                  extra={
                    <Switch
                      checked={checked.has(getAirbyteStreamUniqueId(streamData))}
                      defaultChecked={
                        selectAllFieldsByDefault
                          ? true
                          : initiallySelectedStreams.some(
                              selected =>
                                selected.stream.name === streamData.stream.name &&
                                selected.stream.namespace === streamData.stream.namespace
                            )
                      }
                      className="absolute top-3 right-3"
                      onChange={checked => handleToggleStream(checked, streamData)}
                    />
                  }>
                  <div className="max-h-72 w-full overflow-y-auto">
                    <Code language="json" className="w-full">
                      {JSON.stringify(streamData.stream.json_schema?.properties, null, 2) ?? "null"}
                    </Code>
                  </div>
                </Collapse.Panel>
              )
            })}
          </Collapse>
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

const getAirbyteStreamUniqueId = (stream: AirbyteStreamData): string =>
  `${stream.stream.name}__${stream.stream.namespace}`

const getAirbyteStreamsUniqueIds = (streams: AirbyteStreamData[]): string[] => streams.map(getAirbyteStreamUniqueId)
