// @Libs
import React, { useCallback, useState } from 'react';
import { Button, Col, Form, Input, Row, Select } from 'antd';
import cn from 'classnames';
// @Components
import { RadioButtonsGroup } from '@atom/RadioButtonsGroup';
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
}

const DestinationEditorMappings = ({ form, initialValues }: Props) => {
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

  const handleKeepUnnamedChange = useCallback((value: boolean) => {
    form.setFieldsValue({
      '_mappings._keepUnmappedFields': value
    });
  }, [form]);

  return (
    <>
      <article className="text-xs italic text-secondaryText mb-5">{DESTINATION_EDITOR_MAPPING}</article>

      <Form form={form} name="form-mapping">
        <Form.Item name="_mappings._keepUnmappedFields" initialValue={initialValues?._keepUnmappedFields}>
          <RadioButtonsGroup<boolean>
            label="Unnamed fields mapping mode: "
            initialValue={initialValues?._keepUnmappedFields}
            list={[
              { value: true, label: 'Keep unnamed fields' },
              { value: false, label: 'Remove unmapped fields' }
            ]}
            onChange={handleKeepUnnamedChange}
          />
        </Form.Item>

        <Form.List name="_mappings._mapping" initialValue={initialValues?._mapping ?? []}>
          {
            (fields: FormListFieldData[], { add, remove }: FormListOperation) => (
              <div className={styles.mappings}>
                <>
                  {
                    fields.map((field: FormListFieldData) => {
                      return (
                        <div key={`mapping-${field.name}`} className={cn(styles.mappingsItem, 'bg-bgSecondary border rounded-xl')}>
                          <div className={styles.delete}>
                            <span className={styles.deleteLink} onClick={handleDelete(remove, field.key)}>Delete</span>
                          </div>

                          <Row>
                            <Col span={['move', 'cast'].includes(actions[field.key]) ? 8 : 12}>
                              <Form.Item
                                className="form-field_fixed-label"
                                name={[field.name, '_action']}
                                label={<span>Action: </span>}
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
                                      className="form-field_fixed-label"
                                      name={[field.name, '_type']}
                                      label={<span>Type: </span>}
                                      labelCol={{ span: 5 }}
                                      labelAlign="left"
                                      rules={actions[field.key] === 'cast' ? [requiredValidator(true, 'This')] : undefined}
                                    >
                                      <Input onChange={handleTypeChange(field.key)} autoComplete="off" />
                                    </Form.Item>
                                  </Col>
                                  <Col className={styles.secondaryLabel} span={9}>
                                    <Form.Item
                                      name={[field.name, '_columnType']}
                                      label={<span>Column type: </span>}
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
                                    className="form-field_fixed-label"
                                    name={[field.name, '_srcField']}
                                    label={<span>From: </span>}
                                    labelCol={{ span: 4 }}
                                    labelAlign="left"
                                    rules={validationChain(
                                      requiredValidator(true, 'This'),
                                      jsonPointerValidator()
                                    )}
                                  >
                                    <Input autoComplete="off" />
                                  </Form.Item>
                                </Col>
                              )
                            }

                            {
                              actions[field.key] !== 'remove' && (
                                <Col span={12} className={cn(!['constant', 'cast'].includes(actions[field.key]) && styles.secondaryLabel)}>
                                  <Form.Item
                                    className="form-field_fixed-label"
                                    name={[field.name, '_dstField']}
                                    label={<span>To: </span>}
                                    labelCol={{ span: 4 }}
                                    labelAlign="left"
                                    rules={validationChain(
                                      requiredValidator(true, 'This'),
                                      jsonPointerValidator()
                                    )}
                                  >
                                    <Input autoComplete="off" />
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
      </Form>
    </>
  );
};

DestinationEditorMappings.displayName = 'DestinationEditorMappings';

export { DestinationEditorMappings };
