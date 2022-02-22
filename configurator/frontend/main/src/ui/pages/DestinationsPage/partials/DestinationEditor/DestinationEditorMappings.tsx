// @Libs
import React, { useCallback, useEffect, useState } from "react"
import { Button, Col, Drawer, Form, Row, Select } from "antd"
// @Components
import { TabDescription } from "ui/components/Tabs/TabDescription"
import { LabelWithTooltip } from "ui/components/LabelWithTooltip/LabelWithTooltip"
import { DestinationEditorMappingsItem } from "./DestinationEditorMappingsItem"
// @Types
import { FormInstance } from "antd/lib/form/hooks/useForm"
import { FormListFieldData, FormListOperation } from "antd/es/form/FormList"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
// @Styles
import styles from "./DestinationEditor.module.less"
import { DestinationEditorMappingsLibrary } from "./DestinationEditorMappingsLibrary"

export interface Props {
  form: FormInstance
  initialValues: DestinationMapping
  handleTouchAnyField: (...args: any) => void
  handleDataUpdate: (newMappings: DestinationMapping, newTableName?: string) => Promise<void>
}

export const BooleanStatus = {
  "Keep unnamed fields": true,
  "Remove unmapped fields": false,
} as const

const DestinationEditorMappings = ({ form, initialValues, handleTouchAnyField, handleDataUpdate }: Props) => {
  const [actions, setActions] = useState<MappingAction[]>([])
  const [documentationVisible, setDocumentationVisible] = useState(false)

  useEffect(() => {
    setActions(initialValues?._mappings?.map((row: DestinationMappingRow) => row._action) ?? [])
  }, [initialValues])

  const handleFieldsChange = useCallback(() => {
    const formFields = form.getFieldsValue()
    const mappings = formFields?.["_mappings._mappings"]
    const keep = formFields?.["_mappings._keepUnmappedFields"]

    const notBeenTouched =
      JSON.stringify(initialValues?._mappings) === JSON.stringify(mappings) &&
      keep === initialValues?._keepUnmappedFields

    handleTouchAnyField(!notBeenTouched)
  }, [handleTouchAnyField, initialValues, form])

  const handleActionChange = useCallback(
    (index: number) => (value: MappingAction) => {
      const array = [...actions]
      array[index] = value
      setActions(array)
      handleFieldsChange()
    },
    [actions, handleFieldsChange]
  )

  const handleDelete = useCallback(
    (remove: FormListOperation["remove"], index: number) => async () => {
      const array = [...actions]
      array.splice(index, 1)

      await remove(index)
      setActions(array)
      handleFieldsChange()
    },
    [actions, handleFieldsChange]
  )

  const handleAdd = useCallback(
    (add: FormListOperation["add"]) => () => {
      add({})

      setActions([...actions, "" as MappingAction])

      handleFieldsChange()

      const tabScrollingEl = document.querySelector("#addNewFieldMappingScrollMarker")

      setTimeout(() => tabScrollingEl.scrollIntoView(), 200)
    },
    [actions, handleFieldsChange]
  )

  const handleTypeChange = useCallback(
    (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const formValues = form.getFieldsValue()
      const mappings = formValues["_mappings._mappings"]

      mappings[index]["_columnType"] = event.target.value

      form.setFieldsValue({
        "_mappings._mappings": mappings,
      })

      handleFieldsChange()
    },
    [form, handleFieldsChange]
  )

  return (
    <div className={styles.mappingsWrap}>
      <TabDescription>
        <p>
          <b>Mappings</b> feature is deprecated. It is highly recommended to use <b>Transform</b> instead.
        </p>
        <p>
          Mapping defines how JSON will be transformed before it's sent to the target. Supported mapping actions: move,
          remove, cast. <br />
          Read more about mapping and see example in our{" "}
          <a target="_blank" href="https://jitsu.com/docs/configuration/schema-and-mappings" rel="noreferrer">
            documentation
          </a>
          .
        </p>
        <p>
          Use one of{" "}
          <a onClick={() => setDocumentationVisible(true)}>
            <b>Pre-build Mapping Templates</b>
          </a>{" "}
          to configure Jitsu to implement one of the popular use-cases.
        </p>
      </TabDescription>
      <Drawer
        title={<h2>Pre-build mapping templates</h2>}
        placement="right"
        closable={true}
        onClose={() => setDocumentationVisible(false)}
        width="50%"
        visible={documentationVisible}
      >
        <DestinationEditorMappingsLibrary handleDataUpdate={handleDataUpdate} />
      </Drawer>
      <Form form={form} name="form-mapping" onChange={handleFieldsChange}>
        <Row>
          <Col span={12}>
            <Form.Item
              name="_mappings._keepUnmappedFields"
              initialValue={initialValues?._keepUnmappedFields}
              label={
                <LabelWithTooltip
                  render="Unnamed fields mapping mode"
                  documentation="If the field doesn't have mapping: Keep - keep field as is, Remove - remove field from original JSON"
                />
              }
            >
              <Select>
                {Object.keys(BooleanStatus).map(key => (
                  <Select.Option key={key} value={BooleanStatus[key]}>
                    {key}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.List name="_mappings._mappings" initialValue={initialValues?._mappings ?? []}>
          {(fields: FormListFieldData[], { add, remove }: FormListOperation) => (
            <div className={styles.mappings}>
              <>
                {fields.map((field: FormListFieldData) => (
                  <DestinationEditorMappingsItem
                    key={`mapping-${field.name}`}
                    field={field}
                    action={actions?.[field.name]}
                    handleActionChange={handleActionChange(field.name)}
                    handleTypeChange={handleTypeChange(field.name)}
                    handleDelete={handleDelete(remove, field.name)}
                  />
                ))}
              </>

              <div>
                <Button type="ghost" icon={<PlusOutlined />} onClick={handleAdd(add)}>
                  Add new Field Mapping
                </Button>
                <div id="addNewFieldMappingScrollMarker" />
              </div>
            </div>
          )}
        </Form.List>
      </Form>
    </div>
  )
}

DestinationEditorMappings.displayName = "DestinationEditorMappings"

export { DestinationEditorMappings }
