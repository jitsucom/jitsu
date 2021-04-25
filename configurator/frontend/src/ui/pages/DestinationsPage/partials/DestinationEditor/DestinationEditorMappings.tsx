// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Form, Input, Radio, Select } from 'antd';
// @Components
import { ComingSoon } from '@atom/ComingSoon';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import PlayCircleFilled from '@ant-design/icons/lib/icons/PlayCircleFilled';
import FileTextOutlined from '@ant-design/icons/lib/icons/FileTextOutlined';
// @Constants
import { MAPPINGS_REFERENCE_MAP, MAPPING_NAMES } from '@./constants/mapping';
import { DESTINATION_EDITOR_MAPPING } from '@./embeddedDocs/mappings';
// @Styles
import styles from './DestinationEditor.module.less';
// @Catalog mappings
import mappings from '@./catalog/mappings/lib';

export interface Props {
  form: FormInstance;
  initialValues: Mapping;
  destinationType: string;
}

const DestinationEditorMappings = ({ form, initialValues, destinationType }: Props) => {
  const [mappingActions, setMappingActions] = useState<{ [key: number]: string }>(
    initialValues?._mapping?.reduce((accumulator: { [key: number]: string }, current: MappingRow, index: number) => ({
      ...accumulator,
      [index]: current._action
    }), {})
  );

  const defaultMappingLibrary = useMemo(() => mappings?.[MAPPINGS_REFERENCE_MAP[destinationType]], [destinationType]);

  const handleAddField = useCallback(
    (add: FormListOperation['add']) => () => add({ _srcField: '', _dstField: '', _action: '' }),
    []
  );

  const handleDeleteField = useCallback(
    (remove: FormListOperation['remove'], index: number) => () => remove(index),
    []
  );

  const handleActionChange = useCallback((index: number) => (value: string) => {
    setMappingActions({
      ...mappingActions,
      [index]: value
    });
  }, [mappingActions]);

  const handleUseTemplate = useCallback(() => {
    const mappings = {
      '_mappings._keepUnmappedFields': defaultMappingLibrary.keepUnmappedFields,
      '_mappings._mapping': defaultMappingLibrary.mappings.map(row => ({
        _srcField: row.src,
        _dstField: row.dst,
        _action: row.action
      }))
    };

    form.setFieldsValue({ ...mappings });

    const actions = defaultMappingLibrary.mappings.reduce((accumulator: { [key: number]: string }, current: any, index: number) => ({
      ...accumulator,
      [index]: current.action
    }), {});

    setMappingActions(actions);
  }, [defaultMappingLibrary, form]);

  return (
    <>
      <h3>Edit field mappings</h3>
      <article>{DESTINATION_EDITOR_MAPPING}</article>

      <Form form={form}>
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
                              <Input
                                autoComplete="off"
                                className={styles.mapInput}
                                id={`src-field-${field.name}`}
                              />
                            </Form.Item>
                          </div>

                          <Form.Item className={styles.mapAction} name={[field.name, '_action']}>
                            <Select className={styles.mapSelect} onChange={handleActionChange(field.name)}>
                              {
                                Object.keys(MAPPING_NAMES).map(key =>
                                  <Select.Option key={key} value={key}>{MAPPING_NAMES[key]}</Select.Option>
                                )
                              }
                            </Select>
                          </Form.Item>

                          <div className={styles.mapInputWrap}>
                            {
                              mappingActions?.[field.name] !== 'erase' && (
                                <>
                                  <label className={styles.mapInputLabel} htmlFor={`dst-field-${field.name}`}>To: </label>
                                  <Form.Item name={[field.name, '_dstField']}>
                                    <Input
                                      autoComplete="off"
                                      className={styles.mapInput}
                                      id={`dst-field-${field.name}`}
                                    />
                                  </Form.Item>
                                </>
                              )
                            }
                          </div>

                          <DeleteOutlined className={styles.mapBtn} onClick={handleDeleteField(remove, field.key)} />
                        </div>
                      );
                    })
                  }
                </>

                <div className={styles.btnsLine}>
                  <Button type="ghost" onClick={handleAddField(add)} className={styles.btn} icon={<PlusOutlined />}>
                    Add new Field Mapping
                  </Button>

                  <Button className={styles.btn} icon={<PlayCircleFilled />} disabled={true}>
                    <ComingSoon render="Test Mapping" documentation="Try created mapping" />
                  </Button>

                  {
                    defaultMappingLibrary && (
                      <Button className={styles.btn} icon={<FileTextOutlined />} onClick={handleUseTemplate}>
                        Use mappings template
                      </Button>
                    )
                  }
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
