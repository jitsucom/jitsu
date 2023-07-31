// @Libs
import React, { memo, useMemo } from "react"
import { Col, Form, Input, Row, Select } from "antd"
// @Components
import { LabelWithTooltip } from "ui/components/LabelWithTooltip/LabelWithTooltip"
// @Types
import { Rule } from "antd/lib/form"
import { CollectionParameter } from "@jitsu/catalog"
import { FormListFieldData } from "antd/es/form/FormList"

export interface Props {
  collection: CollectionParameter
  field: FormListFieldData
  documentation?: React.ReactNode
  handleFormFieldsChange?: (...args: any) => void
}

const SourceEditorFormStreamsCollectionsFieldComponent = ({
  collection,
  field,
  documentation,
  handleFormFieldsChange,
}: Props) => {
  const formItemChild = useMemo(() => {
    switch (collection.type.typeName) {
      case "selection":
        return (
          <Select
            allowClear
            mode={collection.type.data?.maxOptions > 1 || !collection.type.data?.maxOptions ? "multiple" : undefined}
            onChange={handleFormFieldsChange}
          >
            {collection.type.data.options.map((option: { displayName: string; id: string }) => (
              <Select.Option key={option.id} value={option.id}>
                {option.displayName}
              </Select.Option>
            ))}
          </Select>
        )

      case "string":
      default:
        return <Input autoComplete="off" onChange={handleFormFieldsChange} />
    }
  }, [collection])

  const validationRules = useMemo(() => {
    const rules = []

    if (collection.required) {
      rules.push({ required: collection.required, message: `${collection.displayName} is required` })
    }

    if (collection.type.data?.maxOptions > 1) {
      rules.push({
        validator: (rule: Rule, value: string[]) =>
          (value?.length ?? 0) <= collection.type.data.maxOptions
            ? Promise.resolve()
            : Promise.reject(`You can select maximum ${collection.type.data?.maxOptions} options`),
      })
    }

    return rules
  }, [collection])

  return (
    <Row>
      <Col span={16}>
        <Form.Item
          className="form-field_fixed-label"
          label={
            documentation ? (
              <LabelWithTooltip documentation={documentation} render={collection.displayName} />
            ) : (
              <span>{collection.displayName}:</span>
            )
          }
          key={collection.id}
          name={[field.name, "parameters", collection.id]}
          rules={validationRules}
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          {formItemChild}
        </Form.Item>
      </Col>
    </Row>
  )
}

SourceEditorFormStreamsCollectionsFieldComponent.displayName = "SourceEditorFormStreamsCollectionsField"

export const SourceEditorFormStreamsCollectionsField = memo(SourceEditorFormStreamsCollectionsFieldComponent)
