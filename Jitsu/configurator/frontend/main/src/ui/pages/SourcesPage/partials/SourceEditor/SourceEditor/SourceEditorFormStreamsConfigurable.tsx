// @Libs
import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button, Col, Collapse, Form, Input, Popover, Row, Select } from "antd"
// @Types
import {
  booleanType,
  CollectionParameter,
  CollectionTemplate,
  intType,
  isoUtcDateType,
  jsonType,
  ParameterType,
  passwordType,
  selectionType,
  singleSelectionType,
  SourceConnector,
  stringType,
} from "@jitsu/catalog"
import { FormListFieldData, FormListOperation } from "antd/es/form/FormList"
import { SetSourceEditorState, SourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormStreamsCollectionsField } from "./SourceEditorFormStreamsConfigurableCollectionsField"
// @Icons
import { CaretRightOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons"
// @Utils
import { getUniqueAutoIncId, randomId } from "utils/numbers"
import { useDebouncedCallback } from "hooks/useDebouncedCallback"
// @Styles
import styles from "./SourceEditor.module.less"
import { convertSdkType } from "@jitsu/catalog"

import {
  PARSING_STREAMS_ERROR_NAME,
  pullAllSDKSourceStreams,
  pullAllSingerStreams,
  PullAllStreams,
} from "./SourceEditorPullData"
import { usePolling } from "../../../../../../hooks/usePolling"
import { SourceEditorActionsTypes, useSourceEditorDispatcher, useSourceEditorState } from "./SourceEditor.state"
import { LoadableFieldsLoadingMessageCard } from "../../../../../../lib/components/LoadingFormCard/LoadingFormCard"
import { ErrorCard } from "../../../../../../lib/components/ErrorCard/ErrorCard"
// @Unsorted

const { Panel } = Collapse

export interface Props {
  initialSourceData: Partial<NativeSourceData | SDKSourceData>
  sourceDataFromCatalog: SourceConnector
  setSourceEditorState: SetSourceEditorState
  handleBringSourceData: () => SourceData
  disabled?: boolean
}

const SELECTED_STREAMS_SOURCE_DATA_PATH = "collections"

const SourceEditorFormStreamsConfigurable = ({
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleBringSourceData,
  disabled,
}: Props) => {
  const [selectedCollectionTypes, setSelectedCollectionTypes] = useState(sourceDataFromCatalog.collectionTypes)
  const [addStreamVisible, setAddStreamVisible] = useState(false)
  const [addTemplateVisible, setAddTemplateVisible] = useState(false)
  const [collectionTypes, setCollectionTypes] = useState(sourceDataFromCatalog.collectionTypes)
  const [collectionParameters, setCollectionParameters] = useState(sourceDataFromCatalog.collectionParameters)
  const [collectionModes, setCollectionModes] = useState({} as { string: StreamMode[] })

  const [activePanel, setActivePanel] = useState([])

  const input = useRef(null)
  const [form] = Form.useForm()

  const renderApplyTemplates = sourceDataFromCatalog.collectionTemplates

  const dispatch = useSourceEditorDispatcher()
  const sourceEditorViewState = useSourceEditorState()

  const {
    isLoading,
    data,
    error,
    reload: reloadStreamsList,
  } = usePolling<StreamData[]>({
    configure: () => ({
      pollingCallback: (end, fail) => async () => {
        try {
          if (sourceDataFromCatalog.protoType == "sdk_source") {
            const result = await pullAllSDKSourceStreams(sourceDataFromCatalog, handleBringSourceData)
            const streamData = result as SDKSourceStreamData[]
            let ct = []
            let cp = []
            let cm = {} as { string: StreamMode[] }
            for (const stream of streamData) {
              cm[stream.type] = stream.supportedModes
              ct.push(stream.type)
              for (const param of stream.params) {
                let tp = convertSdkType(param["type"])
                cp.push({
                  applyOnlyTo: stream.type,
                  id: param.id,
                  defaultValue: param.defaultValue,
                  type: tp,
                  displayName: param.displayName,
                  required: param.required,
                  documentation: param.documentation,
                })
              }
            }
            if (result !== undefined) {
              setCollectionParameters(cp)
              setCollectionTypes(ct)
              setSelectedCollectionTypes(ct)
              setCollectionModes(cm)
              end(result)
            }
          } else {
            end([] as StreamData[])
          }
        } catch (error) {
          fail(error)
        }
      },
      onBeforePollingStart: () => {
        dispatch(SourceEditorActionsTypes.SET_STATUS, { isLoadingStreams: true })
      },
      onAfterPollingEnd: () => {
        dispatch(SourceEditorActionsTypes.SET_STATUS, { isLoadingStreams: false })
      },
    }),
  })

  const handleValuesChange = useDebouncedCallback(
    (_, values: { [SELECTED_STREAMS_SOURCE_DATA_PATH]: UnknownObject[] }) => {
      setSelectedStreams(
        setSourceEditorState,
        SELECTED_STREAMS_SOURCE_DATA_PATH,
        values[SELECTED_STREAMS_SOURCE_DATA_PATH]
      )
    },
    100
  )

  const handleCollectionTypesFilter = useCallback(
    e => {
      setSelectedCollectionTypes(collectionTypes.filter(v => v.toLowerCase().includes(e.target.value.toLowerCase())))
    },
    [collectionTypes]
  )

  const getStream = useCallback(
    (index: number) => {
      return form.getFieldsValue().collections?.[index] ?? initialSourceData.collections[index]
    },
    [initialSourceData.collections, form]
  )

  const getFormErrors = useCallback(
    (index: number) => {
      let fields = collectionParameters.map(v => ["collections", index, "parameters", v.id])
      fields.push(["collections", index, "name"])
      return form.getFieldsError(fields).filter(v => v.errors.length > 0)
    },
    [form, collectionParameters]
  )

  const getCollectionParametersForType = useCallback(
    (type: string) => {
      return collectionParameters?.filter(
        ({ applyOnlyTo }: CollectionParameter) => !applyOnlyTo || applyOnlyTo === type
      )
    },
    [collectionParameters]
  )

  const getCollectionParameters = useCallback(
    (index: number) => {
      return getCollectionParametersForType(getStream(index).type)
    },
    [getCollectionParametersForType, getStream]
  )

  const generateReportNameForType = useCallback(
    (type: string) => {
      const formValues = form.getFieldsValue()
      const collections = formValues?.collections ?? [{}]
      const blankName = type
      const reportNames =
        collections?.reduce((accumulator: string[], current: CollectionSource) => {
          if (current?.name?.includes(blankName)) {
            accumulator.push(current.name)
          }
          return accumulator
        }, []) || []
      return getUniqueAutoIncId(blankName, reportNames)
    },
    [form]
  )

  const addNewOfType = useCallback(
    (type: string, operation: FormListOperation) => {
      let newCollection = {
        name: generateReportNameForType(type),
        type: type,
        mode: collectionModes[type]?.length > 0 ? collectionModes[type]?.[0] : undefined,
        parameters: {},
        _id: randomId(),
      }
      for (const param of getCollectionParametersForType(type)) {
        if (param.defaultValue) {
          newCollection.parameters[param.id] = param.defaultValue
        }
      }
      operation.add(newCollection, 0)
      setActivePanel(activePanel.concat(newCollection._id))
    },
    [, sourceDataFromCatalog.collectionTemplates, activePanel, setActivePanel, collectionModes]
  )

  const remove = useCallback(
    (index: number, operation: FormListOperation) => {
      const stream = getStream(index)
      const keyToRemove = stream._id ?? stream.name
      operation.remove(index)
      setActivePanel(activePanel.filter(v => v !== keyToRemove))
    },
    [, activePanel, setActivePanel, getStream]
  )

  const handleApplyTemplate = useCallback(
    (chosenTemplate: number, operation: FormListOperation) => {
      if (chosenTemplate >= 0) {
        let newActivePanel = activePanel
        let template = sourceDataFromCatalog.collectionTemplates[chosenTemplate]
        for (const col of template.collections) {
          let copy = JSON.parse(JSON.stringify(col))
          if (copy.name) {
            copy.name = generateReportNameForType(copy.name)
          } else {
            copy.name = generateReportNameForType(copy.type)
          }
          copy._id = randomId()
          operation.add(copy, 0)
          newActivePanel = newActivePanel.concat(copy._id)
        }
        setActivePanel(newActivePanel)
      }
    },
    [sourceDataFromCatalog.collectionTemplates, activePanel, setActivePanel]
  )

  const handleTouchParameter = useCallback(
    (index: number, e: ChangeEvent<HTMLInputElement>) => {
      const formValues = form.getFieldsValue()
      const collections = formValues.collections
      const stream = collections[index]
      if (typeof stream._id === "undefined") {
        stream._id = input.current.state.value
      }
      form.setFieldsValue({ collections })
    },
    [form, , activePanel, setActivePanel, input]
  )

  /**
   * Pass form validator to the parent component
   */
  useEffect(() => {
    const validateConfigAndCountErrors = async (): Promise<number> => {
      let errorsCount = 0
      try {
        await form.validateFields()
      } catch (error) {
        errorsCount = +error?.errorFields?.length
      }
      return errorsCount
    }

    setSourceEditorState(state => {
      const newState: SourceEditorState = { ...state, streams: { ...state.streams } }
      newState.streams.validateGetErrorsCount = validateConfigAndCountErrors
      return newState
    })
  }, [])

  return (
    <Form
      disabled={disabled}
      name="source-collections"
      form={form}
      initialValues={initialSourceData}
      autoComplete="off"
      onValuesChange={handleValuesChange}
    >
      <Form.List name={SELECTED_STREAMS_SOURCE_DATA_PATH}>
        {(fields: FormListFieldData[], operation: FormListOperation, meta) => (
          <>
            {isLoading ? (
              <Row>
                <Col span={24}>
                  <LoadableFieldsLoadingMessageCard
                    title="Loading the list of streams"
                    longLoadingMessage="This operation may take minutes if you are configuring streams of this source type for the first time."
                    showLongLoadingMessageAfterMs={10000}
                  />
                </Col>
              </Row>
            ) : error ? (
              <Row>
                <Col span={24}>
                  <ErrorCard
                    title={`Source configuration validation failed`}
                    error={error}
                    className={"form-fields-card"}
                  />
                </Col>
              </Row>
            ) : null}
            {!isLoading && (
              <>
                <Row className={"pb-3"}>
                  <Col>
                    {!sourceEditorViewState.status.isLoadingStreams && collectionTypes.length <= 1 && (
                      <Button
                        size="large"
                        className="mr-4"
                        onClick={() => addNewOfType(collectionTypes[0] ?? "default", operation)}
                        icon={<PlusOutlined />}
                      >
                        Add new stream
                      </Button>
                    )}
                    {!sourceEditorViewState.status.isLoadingStreams && collectionTypes.length > 1 && (
                      <Popover
                        placement="rightTop"
                        visible={addStreamVisible}
                        onVisibleChange={setAddStreamVisible}
                        content={
                          <>
                            {collectionTypes.length > 7 && (
                              <Input
                                allowClear={true}
                                onChange={handleCollectionTypesFilter}
                                placeholder={"Type to search"}
                              />
                            )}
                            <div className={styles.templates} style={{ maxHeight: "400px" }}>
                              {selectedCollectionTypes.map((type: string) => (
                                <div key={type} className={styles.template}>
                                  <div
                                    onClick={() => {
                                      addNewOfType(type, operation)
                                      setAddStreamVisible(false)
                                    }}
                                  >
                                    <p className="font-bold">{type}</p>
                                  </div>
                                  <Button
                                    className={styles.button}
                                    type="primary"
                                    onClick={() => {
                                      addNewOfType(type, operation)
                                      setAddStreamVisible(false)
                                    }}
                                  >
                                    Add
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </>
                        }
                        trigger="click"
                      >
                        <Button size="large" className="mr-4" icon={<PlusOutlined />}>
                          Add new stream
                        </Button>
                      </Popover>
                    )}
                    {renderApplyTemplates && (
                      <>
                        <Popover
                          placement="rightTop"
                          visible={addTemplateVisible}
                          onVisibleChange={setAddTemplateVisible}
                          content={
                            <div className={styles.templates}>
                              {sourceDataFromCatalog.collectionTemplates.map((template: CollectionTemplate, index) => (
                                <div key={template.templateName} className={styles.template}>
                                  <div>
                                    <p className="font-bold capitalize">{template.templateName}</p>
                                    {template.description && <p className={styles.comment}>{template.description}</p>}
                                    <p>
                                      Streams:{" "}
                                      <span className={styles.comment}>
                                        {template.collections
                                          .map<React.ReactNode>(s => <>{s.name ?? s.type}</>)
                                          .reduce((prev, curr) => [prev, ", ", curr])}
                                      </span>
                                    </p>
                                  </div>
                                  <Button
                                    type="primary"
                                    className={styles.button}
                                    onClick={() => {
                                      handleApplyTemplate(index, operation)
                                      setAddTemplateVisible(false)
                                    }}
                                  >
                                    Apply
                                  </Button>
                                </div>
                              ))}
                            </div>
                          }
                          trigger="click"
                        >
                          <Button className="mr-4" size={"large"}>
                            Use template
                          </Button>
                        </Popover>
                      </>
                    )}
                  </Col>
                </Row>
                <Collapse
                  activeKey={activePanel}
                  onChange={v => setActivePanel(v as string[])}
                  expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                >
                  {fields.map((field: FormListFieldData) => {
                    return (
                      <Panel
                        key={getStream(field.name)._id ?? getStream(field.name).name}
                        header={
                          <div className={"flex items-center w-full flex-wrap lg:flex-nowrap pr-8"}>
                            <div
                              className={"whitespace-nowrap w-80 overflow-hidden overflow-ellipsis pr-2"}
                              title={getStream(field.name).name}
                            >
                              Name:&nbsp;&nbsp;<b>{getStream(field.name).name}</b>
                            </div>
                            <div
                              className={"whitespace-nowrap w-80 overflow-hidden overflow-ellipsis pr-2"}
                              title={getStream(field.name).type}
                            >
                              Type:&nbsp;&nbsp;<b>{getStream(field.name).type}</b>
                            </div>
                            <div className={"whitespace-nowrap w-96 overflow-hidden overflow-ellipsis pr-2"}>
                              Table Name:&nbsp;&nbsp;
                              <b title={`${initialSourceData.sourceId}_${getStream(field.name).name ?? "[Name]"}`}>
                                {`${initialSourceData.sourceId}_${getStream(field.name).name ?? "[Name]"}`}
                              </b>
                            </div>
                            <div className={"w-full lg:w-1/4 lg:text-right lg:pr-8 overflow-hidden overflow-ellipsis"}>
                              {getFormErrors(field.name).length > 0 && (
                                <span style={{ color: "red" }}> {getFormErrors(field.name).length} errors</span>
                              )}
                            </div>
                          </div>
                        }
                        extra={
                          <DeleteOutlined
                            className={styles.delete}
                            onClick={event => {
                              remove(field.name, operation)
                              event.stopPropagation()
                            }}
                          />
                        }
                      >
                        <div className={styles.item} key={field.name}>
                          <>
                            <Row>
                              <Col span={16}>
                                <Form.Item
                                  className="form-field_fixed-label"
                                  label={<>Name:</>}
                                  name={[field.name, "name"]}
                                  rules={[
                                    {
                                      required: true,
                                      message: "Field is required. You can remove this collection.",
                                    },
                                    {
                                      validator: (rule: any, value: string) => {
                                        const formValues = form.getFieldsValue()
                                        const isError = formValues.collections
                                          .map((collection, index) => index !== field.name && collection.name)
                                          .includes(value)

                                        return isError
                                          ? Promise.reject("Name must be unique under the current collection")
                                          : Promise.resolve()
                                      },
                                    },
                                  ]}
                                  labelCol={{ span: 6 }}
                                  wrapperCol={{ span: 18 }}
                                >
                                  <Input
                                    autoComplete="off"
                                    ref={input}
                                    onChange={e => handleTouchParameter(field.name, e)}
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                            {collectionModes[getStream(field.name).type]?.length > 0 ? (
                              <Row>
                                <Col span={16}>
                                  <Form.Item
                                    className="form-field_fixed-label"
                                    label={<>Sync Mode:</>}
                                    name={[field.name, "mode"]}
                                    rules={[
                                      {
                                        required: true,
                                        message: "Field is required. You can remove this collection.",
                                      },
                                    ]}
                                    labelCol={{ span: 6 }}
                                    wrapperCol={{ span: 18 }}
                                  >
                                    <Select
                                      defaultActiveFirstOption={true}
                                      disabled={collectionModes[getStream(field.name).type]?.length == 1}
                                    >
                                      {collectionModes[getStream(field.name).type]?.map(m => (
                                        <Select.Option key={m} value={m}>
                                          {m}
                                        </Select.Option>
                                      ))}
                                    </Select>
                                  </Form.Item>
                                </Col>
                              </Row>
                            ) : (
                              <></>
                            )}
                            {getCollectionParameters(field.name).map((collection: CollectionParameter) => (
                              <SourceEditorFormStreamsCollectionsField
                                documentation={collection.documentation}
                                field={field}
                                key={collection.id}
                                collection={collection}
                                // handleFormFieldsChange={}
                              />
                            ))}
                          </>
                        </div>
                      </Panel>
                    )
                  })}
                </Collapse>
              </>
            )}
          </>
        )}
      </Form.List>
    </Form>
  )
}
SourceEditorFormStreamsConfigurable.displayName = "SourceEditorFormStreamsConfigurable"

export { SourceEditorFormStreamsConfigurable }

/**
 * Helper function that passes the values to the parent
 */

const setSelectedStreams = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  streams: any,
  options?: {
    doNotSetStateChanged?: boolean
  }
) => {
  setSourceEditorState(state => {
    const newState: SourceEditorState = {
      ...state,
      streams: { ...state.streams, selectedStreams: { ...state.streams.selectedStreams } },
    }
    newState.streams.selectedStreams[sourceDataPath] = streams
    newState.streams.errorsCount = 0
    if (!options?.doNotSetStateChanged) newState.stateChanged = true
    return newState
  })
}
