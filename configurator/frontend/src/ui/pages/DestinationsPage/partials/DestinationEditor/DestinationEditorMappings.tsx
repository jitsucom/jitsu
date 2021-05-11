// @Libs
import React, { useCallback, useEffect, useState } from 'react';
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
import { isValidJsonPointer } from '@util/validation/jsonPointer';

export interface Props {
  form: FormInstance;
  initialValues: DestinationMapping;
  handleTouchAnyField: VoidFunc;
}

const DestinationEditorMappings = ({ form, initialValues, handleTouchAnyField }: Props) => {
  const [actions, setActions] = useState<MappingAction[]>([]);

  useEffect(() => {
    setActions(initialValues?._mappings?.map((row: DestinationMappingRow) => row._action) ?? []);
  }, [initialValues]);

  const handleFieldsChange = useCallback(() => {
    const formFields = form.getFieldsValue();
    const mappings = formFields?.['_mappings._mappings'];
    const keep = Boolean(formFields?.['_mappings._keepUnmappedFields']);

    const notBeenTouched = JSON.stringify(initialValues?._mappings) === JSON.stringify(mappings) && keep === initialValues?._keepUnmappedFields;

    handleTouchAnyField(!notBeenTouched);
  }, [handleTouchAnyField, initialValues, form]);

  const handleActionChange = useCallback((index: number) => (value: MappingAction) => {
    const array = [...actions];
    array[index] = value;
    setActions(array);
    handleFieldsChange();
  }, [actions, handleFieldsChange]);

  const handleDelete = useCallback((remove: FormListOperation['remove'], index: number) => async() => {
    const array = [...actions];
    array.splice(index, 1);

    await remove(index);
    setActions(array);
    handleFieldsChange();
  }, [actions, handleFieldsChange]);

  const handleAdd = useCallback((add: FormListOperation['add']) => () => {
    add({});

    setActions([
      ...actions,
      '' as MappingAction
    ]);

    handleFieldsChange();

    const tabScrollingEl = document.querySelector('#addNewFieldMappingScrollMarker');

    setTimeout(() => tabScrollingEl.scrollIntoView(), 200);
  }, [actions, handleFieldsChange]);

  const handleTypeChange = useCallback((index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const formValues = form.getFieldsValue();
    const mappings = formValues['_mappings._mappings'];

    mappings[index]['_columnType'] = event.target.value;

    form.setFieldsValue({
      '_mappings._mappings': mappings
    });

    handleFieldsChange();
  }, [form, handleFieldsChange]);

  return (
    <>
      <article className="text-xs italic text-secondaryText mb-5">{DESTINATION_EDITOR_MAPPING}</article>

      <Form form={form} name="form-mapping" onChange={handleFieldsChange}>
        <Row>
          <Col span={12}>
            <Form.Item
              name="_mappings._keepUnmappedFields"
              initialValue={Number(initialValues?._keepUnmappedFields) ?? 0}
              label={<LabelWithTooltip render="Unnamed fields mapping mode" documentation="If the field doesn't have mapping: Keep - keep field as is, Remove - remove field from original JSON" />}
            >
              <Select>
                <Select.Option value={1}>Keep unnamed fields</Select.Option>
                <Select.Option value={0}>Remove unmapped fields</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.List name="_mappings._mappings" initialValue={initialValues?._mappings ?? []}>
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
                              rules={[{ required: true, message: 'This field is required.' }]}
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
                                    rules={actions[field.name] === 'cast' ? [{ required: true, message: 'This field is required.' }] : undefined}
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
                                  rules={[{
                                    validator: (rule, value) => !value
                                      ? Promise.reject('This field is required.')
                                      : isValidJsonPointer(value)
                                        ? Promise.resolve()
                                        : Promise.reject('Invalid JSON pointer syntax. Should be /path/to/element')
                                  }]}
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
                                  rules={[{
                                    validator: (rule, value) => !value
                                      ? Promise.reject('This field is required.')
                                      : isValidJsonPointer(value)
                                        ? Promise.resolve()
                                        : Promise.reject('Invalid JSON pointer syntax. Should be /path/to/element')
                                  }]}
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
                  <div id="addNewFieldMappingScrollMarker" />
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
