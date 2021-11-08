import { CaretRightOutlined } from "@ant-design/icons"
import { Collapse, Empty, Form, FormInstance, Select, Switch } from "antd"
import Search from "antd/lib/input/Search"
import { Code } from "lib/components/Code/Code"
import { cloneDeep } from "lodash"
import React, { useEffect, useState } from "react"

interface Props {
  form: FormInstance
  allStreams: Array<AirbyteStreamData>
  initiallySelectedStreams: Array<AirbyteStreamData> | null
  selectAllFieldsByDefault?: boolean
}

const CATALOG_FIELD_PATH = "config.catalog"

const setAirbyteStreamsFormValues = (form: FormInstance, valuesToSet: AirbyteStreamData[]): void => {
  const values = form.getFieldValue(CATALOG_FIELD_PATH)
  form.setFieldsValue({
    [CATALOG_FIELD_PATH]: { ...values, streams: valuesToSet },
  })
}

const addStreamInForm = (form: FormInstance, streamToAdd: AirbyteStreamData): void => {
  const values = form.getFieldsValue()
  const selectedStreams = [...(values?.[CATALOG_FIELD_PATH]?.streams ?? []), streamToAdd]
  form.setFieldsValue({
    ...values,
    [CATALOG_FIELD_PATH]: { streams: selectedStreams },
  })
  console.log("Added", form.getFieldsValue())
}

const updateStreamValuesInForm = (form: FormInstance, updatedStreamData: AirbyteStreamData): void => {
  const updatedStreams = (form.getFieldsValue()?.[CATALOG_FIELD_PATH]?.streams ?? []).map(streamData => {
    if (
      streamData.stream.name === updatedStreamData.stream ||
      streamData.stream.namespace === updatedStreamData.stream.namespace
    ) {
      return updatedStreamData
    }
    return streamData
  })

  setAirbyteStreamsFormValues(form, updatedStreams)
}

const deleteStreamFromForm = (form: FormInstance, streamToDelete: AirbyteStreamData): void => {
  const values = form.getFieldsValue()
  const selectedStreams = (values?.[CATALOG_FIELD_PATH]?.streams ?? []).filter(
    selectedStream =>
      !(
        selectedStream.stream.name === streamToDelete.stream.name &&
        selectedStream.stream.namespace === streamToDelete.stream.namespace
      )
  )
  form.setFieldsValue({
    ...values,
    [CATALOG_FIELD_PATH]: { streams: selectedStreams },
  })
}

const SourceEditorStreamsAirbyteForm = ({
  form,
  allStreams,
  initiallySelectedStreams,
  selectAllFieldsByDefault,
}: Props) => {
  const [streamsToDisplay, setStreamsToDisplay] = useState<AirbyteStreamData[]>(allStreams)

  const handleToggleStream = (checked: boolean, stream: AirbyteStreamData): void => {
    checked ? addStreamInForm(form, stream) : deleteStreamFromForm(form, stream)
  }

  const handleChangeSyncMode = (mode: string, stream: AirbyteStreamData): void => {
    const updatedStream: AirbyteStreamData = cloneDeep(stream)
    updatedStream.sync_mode = mode

    updateStreamValuesInForm(form, updatedStream)
  }

  const handleSearch = (query: string) => {
    setStreamsToDisplay(streams =>
      streams.filter(
        streamData => streamData.stream.name.includes(query) || streamData.stream.namespace.includes(query)
      )
    )
  }

  const handleSearchValueClear = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.value === "") setTimeout(() => setStreamsToDisplay(allStreams), 0)
  }

  useEffect(() => {
    const initialValues = selectAllFieldsByDefault ? allStreams : initiallySelectedStreams
    setAirbyteStreamsFormValues(form, initialValues)
  }, [])

  return (
    <div className="h-full w-full flex flex-col items-stretch">
      <Search enterButton="Search" className="mb-4" onSearch={handleSearch} onChange={handleSearchValueClear} />
      <div className="flex-auto overflow-y-auto">
        <Form form={form} className="hidden">
          {/**
           * An empty form used to register the catalog field
           */}
          <Form.Item name={CATALOG_FIELD_PATH} />
        </Form>
        {streamsToDisplay?.length ? (
          <Collapse
            collapsible="header"
            expandIconPosition="left"
            destroyInactivePanel
            expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
          >
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
                        }
                      >
                        <span>Name:&nbsp;&nbsp;</span>
                        <b title={streamData.stream.name}>{streamData.stream.name}</b>
                      </div>
                      {streamData.stream.namespace && (
                        <div
                          className={
                            "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
                          }
                        >
                          Namespace:&nbsp;&nbsp;
                          <b title={streamData.stream.namespace}>{streamData.stream.namespace}</b>
                        </div>
                      )}
                      <div
                        className={`whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden ${
                          !showSyncModeSelection && "overflow-ellipsis"
                        } pr-2`}
                      >
                        Sync Mode:&nbsp;&nbsp;
                        {showSyncModeSelection ? (
                          <Select
                            size="small"
                            defaultValue={streamData.sync_mode ?? streamData.stream.supported_sync_modes?.[0]}
                            onChange={value => handleChangeSyncMode(value, streamData)}
                            onClick={e => {
                              // hack to prevent antd expanding the collapsible
                              e.stopPropagation()
                            }}
                          >
                            {streamData.stream.supported_sync_modes.map(mode => (
                              <Select.Option value={mode}>{mode}</Select.Option>
                            ))}
                          </Select>
                        ) : (
                          <b title={streamData.sync_mode}>{streamData.sync_mode}</b>
                        )}
                      </div>
                      <div
                        className={
                          "whitespace-nowrap min-w-0 xl:w-1/4 lg:w-1/3 w-1/2 max-w-xs overflow-hidden overflow-ellipsis pr-2"
                        }
                      >
                        Destination Sync Mode:&nbsp;&nbsp;
                        <b title={streamData.stream.namespace}>{streamData.destination_sync_mode}</b>
                      </div>
                    </div>
                  }
                  extra={
                    <Switch
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
                  }
                >
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
SourceEditorStreamsAirbyteForm.displayName = "SourceEditorStreamsAirbyteForm"

export { SourceEditorStreamsAirbyteForm }
