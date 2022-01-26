// @Libs
import { Col, Form, Input, Row, Select } from "antd"
import cn from "classnames"
// @Constants
import { MAPPING_NAMES } from "constants/mapping"
// @Utils
import { isValidJsonPointer } from "utils/validation/jsonPointer"
// @Styles
import styles from "./DestinationEditor.module.less"
// @Types
import { FormListFieldData } from "antd/es/form/FormList"

interface Props {
  field: FormListFieldData
  action: MappingAction
  handleTypeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handleActionChange: (value: MappingAction) => void
  handleDelete: () => Promise<void>
}

const DestinationEditorMappingsItem = ({
  action,
  field,
  handleTypeChange,
  handleActionChange,
  handleDelete,
}: Props) => {
  return (
    <div className={cn(styles.mappingsItem, "bg-bgSecondary border rounded-xl")}>
      <div className={styles.delete}>
        <span className={styles.deleteLink} onClick={handleDelete}>
          Delete
        </span>
      </div>

      <Row>
        <Col span={["move", "cast"].includes(action) ? 8 : 12}>
          <Form.Item
            className="form-field_fixed-label"
            name={[field.name, "_action"]}
            label={<span>Action: </span>}
            labelCol={{
              span: ["move", "cast"].includes(action) ? 6 : 4,
            }}
            labelAlign="left"
            rules={[{ required: true, message: "This field is required." }]}
          >
            <Select onChange={handleActionChange}>
              {Object.keys(MAPPING_NAMES).map((key: MappingAction) => (
                <Select.Option key={key} value={key}>
                  {MAPPING_NAMES[key]}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        {action === "constant" && (
          <Col className={styles.secondaryLabel} span={12}>
            <Form.Item
              className="form-field_fixed-label"
              name={[field.name, "_value"]}
              label={
                <span style={{ whiteSpace: "nowrap" }}>
                  Value (<em>optional</em>):{" "}
                </span>
              }
              labelCol={{ span: 6 }}
              labelAlign="left"
            >
              <Input />
            </Form.Item>
          </Col>
        )}
        {["move", "cast"].includes(action) && (
          <>
            <Col className={styles.secondaryLabel} span={7}>
              <Form.Item
                className="form-field_fixed-label"
                name={[field.name, "_type"]}
                label={
                  action === "cast" ? (
                    <span>Type: </span>
                  ) : (
                    <span>
                      Type (<em>optional</em>):{" "}
                    </span>
                  )
                }
                labelCol={{ span: 11 }}
                labelAlign="left"
                rules={action === "cast" ? [{ required: true, message: "This field is required." }] : undefined}
              >
                <Input onChange={handleTypeChange} autoComplete="off" />
              </Form.Item>
            </Col>
            <Col className={styles.secondaryLabel} span={9}>
              <Form.Item
                className="form-field_fixed-label"
                name={[field.name, "_columnType"]}
                label={
                  <span>
                    Column type (<em>optional</em>):{" "}
                  </span>
                }
                labelCol={{ span: 11 }}
                labelAlign="left"
              >
                <Input />
              </Form.Item>
            </Col>
          </>
        )}
      </Row>

      <Row>
        {!["constant", "cast"].includes(action) && (
          <Col span={12}>
            <Form.Item
              className="form-field_fixed-label"
              name={[field.name, "_srcField"]}
              label={<span>From: </span>}
              labelCol={{ span: 4 }}
              labelAlign="left"
              rules={[
                {
                  validator: (rule, value) =>
                    !value
                      ? Promise.reject("This field is required.")
                      : isValidJsonPointer(value)
                      ? Promise.resolve()
                      : Promise.reject("Invalid JSON pointer syntax. Should be /path/to/element"),
                },
              ]}
            >
              <Input autoComplete="off" />
            </Form.Item>
          </Col>
        )}

        {action !== "remove" && (
          <Col span={12} className={cn(!["constant", "cast"].includes(action) && styles.secondaryLabel)}>
            <Form.Item
              className="form-field_fixed-label"
              name={[field.name, "_dstField"]}
              label={<span>To: </span>}
              labelCol={{ span: 4 }}
              labelAlign="left"
              rules={[
                {
                  validator: (rule, value) =>
                    !value
                      ? Promise.reject("This field is required.")
                      : isValidJsonPointer(value)
                      ? Promise.resolve()
                      : Promise.reject("Invalid JSON pointer syntax. Should be /path/to/element"),
                },
              ]}
            >
              <Input autoComplete="off" />
            </Form.Item>
          </Col>
        )}
      </Row>
    </div>
  )
}

DestinationEditorMappingsItem.displayName = "DestinationEditorMappingsItem"

export { DestinationEditorMappingsItem }
