// @Libs
import React, { useCallback, useState } from 'react';
import { Button, Col, Form, Input, Row, Select } from 'antd';
import cn from 'classnames';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteFilled from '@ant-design/icons/lib/icons/DeleteFilled';
// @Constants
import { MAPPING_NAMES } from '@./constants/mapping';
import { DESTINATION_EDITOR_MAPPING } from '@./embeddedDocs/mappings';
// @Styles
import styles from './DestinationEditor.module.less';
// @Utils
import { validationChain } from '@util/validation/validationChain';
import { requiredValidator } from '@util/validation/validators';
import { jsonPointerValidator } from '@util/validation/jsonPointer';

export interface Props {
  form: FormInstance;
  initialValues: Mapping;
  destinationType: string;
}

const DestinationEditorMappings = ({ form, initialValues, destinationType }: Props) => {
  const [actions, setActions] = useState<MappingAction[]>([]);

  const handleActionChange = useCallback((index: number) => (value: MappingAction) => {
    const array = [...actions];
    array[index] = value;
    setActions(array);
  }, [actions]);

  const handleDelete = useCallback((remove: FormListOperation['remove'], index: number) => () => {
    const array = [...actions].splice(index, 1);

    remove(index);

    setActions(array);
  }, [actions]);

  const handleAdd = useCallback((add: FormListOperation['add']) => () => {
    add({});
  }, []);

  const handleTypeChange = useCallback((index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const formValues = form.getFieldsValue();
    const mappings = formValues['_mappings._mapping'];

    mappings[index]['_columnType'] = event.target.value;

    form.setFieldsValue({
      '_mappings._mapping': mappings
    });
  }, [form]);

  return (
    <>
      <article className="text-xs italic text-secondaryText mb-5">{DESTINATION_EDITOR_MAPPING}</article>

      <Form form={form} name="form-mapping" onFinish={values => console.log(values)}>
        <Form.List name="_mappings._mapping" initialValue={[{}]}>
          {
            (fields: FormListFieldData[], { add, remove }: FormListOperation) => (
              <div className={styles.mappings}>
                <>
                  {
                    fields.map((field: FormListFieldData) => {
                      return (
                        <div key={`mapping-${field.name}`} className={cn(styles.mappingsItem, 'bg-bgSecondary border rounded-xl')}>
                          <div className={styles.delete}>
                            <DeleteFilled className={styles.deleteIcon}  onClick={handleDelete(remove, field.key)} />
                          </div>

                          <Row>
                            <Col span={['move', 'cast'].includes(actions[field.key]) ? 8 : 12}>
                              <Form.Item
                                name={[field.name, '_action']}
                                label="Action"
                                labelCol={{
                                  span: ['move', 'cast'].includes(actions[field.key]) ? 6 : 4
                                }}
                                labelAlign="left"
                                rules={[requiredValidator(true, 'This')]}
                              >
                                <Select onChange={handleActionChange(field.key)}>
                                  {
                                    Object.keys(MAPPING_NAMES).map((key: MappingAction) =>
                                      <Select.Option key={key} value={key}>{MAPPING_NAMES[key]}</Select.Option>
                                    )
                                  }
                                </Select>
                              </Form.Item>
                            </Col>
                            {
                              actions[field.key] === 'constant' && (
                                <Col className={styles.secondaryLabel} span={12}>
                                  <Form.Item
                                    name={[field.name, '_value']}
                                    label="Value"
                                    labelCol={{ span: 3 }}
                                    labelAlign="left"
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                              )
                            }
                            {
                              ['move', 'cast'].includes(actions[field.key]) && (
                                <>
                                  <Col className={styles.secondaryLabel} span={7}>
                                    <Form.Item
                                      name={[field.name, '_type']}
                                      label="Type"
                                      labelCol={{ span: 5 }}
                                      labelAlign="left"
                                      rules={actions[field.key] === 'cast' ? [requiredValidator(true, 'This')] : undefined}
                                    >
                                      <Input onChange={handleTypeChange(field.key)} />
                                    </Form.Item>
                                  </Col>
                                  <Col className={styles.secondaryLabel} span={9}>
                                    <Form.Item
                                      name={[field.name, '_columnType']}
                                      label="Column type"
                                      labelCol={{ span: 7 }}
                                      labelAlign="left"
                                    >
                                      <Input />
                                    </Form.Item>
                                  </Col>
                                </>
                              )
                            }
                          </Row>

                          <Row>
                            {
                              !['constant', 'cast'].includes(actions[field.key]) && (
                                <Col span={12}>
                                  <Form.Item
                                    name={[field.name, '_srcField']}
                                    label="From"
                                    labelCol={{ span: 4 }}
                                    labelAlign="left"
                                    rules={validationChain(
                                      requiredValidator(true, 'This'),
                                      jsonPointerValidator()
                                    )}
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                              )
                            }

                            {
                              actions[field.key] !== 'remove' && (
                                <Col span={12} className={cn(!['constant', 'cast'].includes(actions[field.key]) && styles.secondaryLabel)}>
                                  <Form.Item
                                    name={[field.name, '_dstField']}
                                    label="To"
                                    labelCol={{ span: 4 }}
                                    labelAlign="left"
                                    rules={validationChain(
                                      requiredValidator(true, 'This'),
                                      jsonPointerValidator()
                                    )}
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                              )
                            }
                          </Row>
                        </div>
                      );
                    })
                  }
                </>

                <div>
                  <Button type="ghost" icon={<PlusOutlined />} onClick={handleAdd(add)}>
                    Add new Field Mapping
                  </Button>
                </div>
              </div>
            )
          }
        </Form.List>

        <Button htmlType="submit">Submit</Button>
      </Form>
    </>
  );
};

DestinationEditorMappings.displayName = 'DestinationEditorMappings';

export { DestinationEditorMappings };
