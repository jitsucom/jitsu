// @Libs
import React, { useCallback, useRef, useState } from 'react';
import { Button, Col, Form, Input, Row, Select } from 'antd';
import cn from 'classnames';
// @Components
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
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
    const array = [...actions];

    array.splice(index, 1);

    remove(index);

    setActions(array);
  }, [actions]);

  const handleAdd = useCallback((add: FormListOperation['add']) => () => {
    add({});

    setActions([
      ...actions,
      '' as MappingAction
    ]);

    const tabScrollingEl = document.querySelector('#dst-editor-tabs')?.querySelector('.ant-tabs-content');

    setTimeout(() => tabScrollingEl.scrollTo(0, tabScrollingEl.scrollHeight), 0);
  }, [actions]);

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

      <Form form={form} name="form-mapping">
        <Row>
          <Col span={12}>
            <Form.Item
              name="_mappings._keepUnmappedFields"
              initialValue={Number(initialValues?._keepUnmappedFields)}
              label={<LabelWithTooltip render="Unnamed fields mapping mode" documentation="If the field doesn't have mapping: Keep - keep field as is, Remove - remove field from original JSON" />}
            >
              <Select>
                <Select.Option value={1}>Keep unnamed fields</Select.Option>
                <Select.Option value={0}>Remove unmapped fields</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.List name="_mappings._mapping" initialValue={initialValues?._mapping ?? []}>
          {
            (fields: FormListFieldData[], { add, remove }: FormListOperation) => (
              <div className={styles.mappings}>
                <>
                  {
                    fields.map((field: FormListFieldData) => (
                      <div key={`mapping-${field.name}`} className={cn(styles.mappingsItem, 'bg-bgSecondary border rounded-xl')}>
                        <div className={styles.delete}>
                          <span className={styles.deleteLink} onClick={handleDelete(remove, field.name)}>Delete</span>
                        </div>

                        <Row>
                          <Col span={['move', 'cast'].includes(actions[field.name]) ? 8 : 12}>
                            <Form.Item
                              className="form-field_fixed-label"
                              name={[field.name, '_action']}
                              label={<span>Action: </span>}
                              labelCol={{
                                span: ['move', 'cast'].includes(actions[field.name]) ? 6 : 4
                              }}
                              labelAlign="left"
                              rules={[requiredValidator(true, 'This')]}
                            >
                              <Select onChange={handleActionChange(field.name)}>
                                {
                                  Object.keys(MAPPING_NAMES).map((key: MappingAction) =>
                                    <Select.Option key={key} value={key}>{MAPPING_NAMES[key]}</Select.Option>
                                  )
                                }
                              </Select>
                            </Form.Item>
                          </Col>
                          {
                            actions[field.name] === 'constant' && (
                              <Col className={styles.secondaryLabel} span={12}>
                                <Form.Item
                                  className="form-field_fixed-label"
                                  name={[field.name, '_value']}
                                  label={<span style={{ whiteSpace: 'nowrap' }}>Value: <sup>optional</sup></span>}
                                  labelCol={{ span: 5 }}
                                  labelAlign="left"
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                            )
                          }
                          {
                            ['move', 'cast'].includes(actions[field.name]) && (
                              <>
                                <Col className={styles.secondaryLabel} span={7}>
                                  <Form.Item
                                    className="form-field_fixed-label"
                                    name={[field.name, '_type']}
                                    label={actions[field.name] === 'cast' ? <span>Type: </span> : <span>Type: <sup>optional</sup></span>}
                                    labelCol={{ span: 9 }}
                                    labelAlign="left"
                                    rules={actions[field.name] === 'cast' ? [requiredValidator(true, 'This')] : undefined}
                                  >
                                    <Input onChange={handleTypeChange(field.name)} autoComplete="off" />
                                  </Form.Item>
                                </Col>
                                <Col className={styles.secondaryLabel} span={9}>
                                  <Form.Item
                                    className="form-field_fixed-label"
                                    name={[field.name, '_columnType']}
                                    label={<span>Column type: <sup>optional</sup></span>}
                                    labelCol={{ span: 10 }}
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
                            !['constant', 'cast'].includes(actions[field.name]) && (
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
                            actions[field.name] !== 'remove' && (
                              <Col span={12} className={cn(!['constant', 'cast'].includes(actions[field.name]) && styles.secondaryLabel)}>
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
                    ))
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
