// @Libs
import React, { useCallback } from 'react';
import { Button, Form, Input, Radio, Select } from 'antd';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
// @Constants
import { MAPPING_NAMES } from '@./constants/mapping';
import { DESTINATION_EDITOR_MAPPING } from '@./embeddedDocs/mappings';
// @Styles
import styles from './DestinationEditor.module.less';

export interface Props {
  form: FormInstance;
  initialValues: DestinationData['_mappings'];
}

const DestinationEditorMappings = ({ form, initialValues }: Props) => {
  const handleAddField = useCallback(
    (add: FormListOperation['add']) => () => add({ _srcField: '', _dstField: '', _action: '' }),
    []
  );

  const handleDeleteField = useCallback(
    (remove: FormListOperation['remove'], index: number) => () => remove(index),
    []
  );

  return (
    <>
      <article>{DESTINATION_EDITOR_MAPPING}</article>

      <Form form={form} onFinish={values => console.log(values)}>
        <Form.Item name="_mappings._keepUnmappedFields" initialValue={initialValues?._keepUnmappedFields}>
          <Radio.Group buttonStyle="solid">
            <Radio.Button value={true}>Keep unmapped fields</Radio.Button>
            <Radio.Button value={false}>Remove unmapped fields</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.List name="_mappings._mapping" initialValue={initialValues?._mapping ?? []}>
          {
            (fields: FormListFieldData[], { add, remove }: FormListOperation) => (
              <div className={styles.mapping}>
                <>
                  {
                    fields.map((field: FormListFieldData) => {
                      return (
                        <div key={`mapping-${field.name}`} className={styles.line}>
                          <div className={styles.mapInputWrap}>
                            <label className={styles.mapInputLabel} htmlFor={`src-field-${field.name}`}>From: </label>
                            <Form.Item name={[field.name, '_srcField']}>
                              <Input className={styles.mapInput} autoComplete="off" id={`src-field-${field.name}`} />
                            </Form.Item>
                          </div>

                          <Form.Item className={styles.mapAction} name={[field.name, '_action']}>
                            <Select className={styles.mapSelect}>
                              {
                                Object.keys(MAPPING_NAMES).map(key =>
                                  <Select.Option key={key} value={key}>{MAPPING_NAMES[key]}</Select.Option>
                                )
                              }
                            </Select>
                          </Form.Item>

                          <div className={styles.mapInputWrap}>
                            <label className={styles.mapInputLabel} htmlFor={`dst-field-${field.name}`}>To: </label>
                            <Form.Item name={[field.name, '_dstField']}>
                              <Input className={styles.mapInput} autoComplete="off" id={`dst-field-${field.name}`} />
                            </Form.Item>
                          </div>

                          <DeleteOutlined className={styles.mapBtn} onClick={handleDeleteField(remove, field.key)} />
                        </div>
                      );
                    })
                  }
                </>

                <Button type="ghost" onClick={handleAddField(add)} className="add-field-btn" icon={<PlusOutlined />}>
                  Add new Field Mapping
                </Button>
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
