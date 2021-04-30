// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Col, Form, Input, Row, Select } from 'antd';
import { unset } from 'lodash';
// @Components
import { SourceFormCollectionsField } from './SourceFormCollectionsField';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { CollectionParameter, SourceConnector } from '@catalog/sources/types';
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
// @Constants
import { SOURCE_COLLECTIONS } from '@./embeddedDocs/sourceCollections';
import { COLLECTIONS_SCHEDULES } from '@./constants/schedule';
// @Styles
import styles from './SourceEditor.module.less';
// @Icons
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
// @Utils
import { getUniqueAutoIncId } from '@util/numbers';

export interface Props {
  form: FormInstance;
  initialValues: SourceData;
  connectorSource: SourceConnector;
  handleTouchAnyField: VoidFunc;
}

const SourceEditorCollections = ({ form, initialValues, connectorSource, handleTouchAnyField }: Props) => {

  const [chosenTypes, setChosenTypes] = useState<{ [key: number]: string }>(
    initialValues.collections
      ? initialValues.collections?.reduce((accumulator: any, value: CollectionSource, index: number) => {
        return { ...accumulator, [index]: value.type };
      }, {})
      : { 0: connectorSource.collectionTypes[0] }
  );

  const generateReportName = useCallback((index: number) => {
    const formValues = form.getFieldsValue();
    const collections = formValues?.collections;
    const blankName = `${connectorSource.id}_${collections ? collections[index].type : connectorSource.collectionTypes[0]}`;
    const reportNames = collections?.reduce((accumulator: string[], current: CollectionSource) => {
      if (current?.name?.includes(blankName)) {
        accumulator.push(current.name);
      }
      return accumulator;
    }, []) || [];

    return getUniqueAutoIncId(blankName, reportNames);
  }, [form, connectorSource.id, connectorSource.collectionTypes]);

  const handleReportTypeChange = useCallback(
    (index: number) => (value: string) => {
      const formValues = form.getFieldsValue();
      const collections = formValues.collections;

      collections[index].name = generateReportName(index);

      form.setFieldsValue({
        ...formValues,
        collections
      });

      setChosenTypes({
        ...chosenTypes,
        [index]: value
      });

      handleTouchAnyField();
    },
    [form, generateReportName, handleTouchAnyField, chosenTypes]
  );

  const handleRemoveField = useCallback(
    (operation: FormListOperation, index: number) => () => {
      const newChosenTypes = { ...chosenTypes };

      unset(newChosenTypes, index);
      setChosenTypes(newChosenTypes);

      operation.remove(index);

      handleTouchAnyField();
    },
    [chosenTypes, handleTouchAnyField]
  );

  const getCollectionScheduleValue = useCallback((index: number) => {
    const initial = initialValues.collections?.[index]?.schedule;

    if (initial) {
      return initial;
    }

    return COLLECTIONS_SCHEDULES[0].value;
  }, [initialValues]);

  const handleAddField = useCallback(
    (operation: FormListOperation) => () => {
      const addingValue =
        connectorSource.collectionTypes.length > 1
          ? {}
          : { type: connectorSource.collectionTypes[0] };

      operation.add(addingValue);

      handleTouchAnyField();
    },
    [connectorSource.collectionTypes, handleTouchAnyField]
  );

  const getCollectionTypeValue = useCallback(
    (index: number) => {
      const initial = initialValues.collections?.[index]?.type;

      if (initial) {
        return initial;
      }

      return connectorSource.collectionTypes[0];
    },
    [initialValues, connectorSource.collectionTypes]
  );

  const getCollectionParameters = useCallback(
    (index: number) =>
      connectorSource.collectionParameters?.filter(
        ({ applyOnlyTo }: CollectionParameter) => !applyOnlyTo || applyOnlyTo === chosenTypes[index]
      ),
    [connectorSource.collectionParameters, chosenTypes]
  );

  const updatedInitialValues = useMemo(() => {
    if (initialValues.collections) {
      return initialValues.collections;
    }

    return [{
      type: getCollectionTypeValue(0)
    }];
  }, [getCollectionTypeValue, initialValues.collections]);

  return (
    <div className={styles.collection}>
      <h3>Configure collections</h3>
      {SOURCE_COLLECTIONS}

      <Form
        name="source-collections"
        form={form}
        autoComplete="off"
        onChange={handleTouchAnyField}
      >
        <Form.List name="collections" initialValue={updatedInitialValues}>
          {
            (fields: FormListFieldData[], operation: FormListOperation) => (
              <>
                {
                  fields.map((field: FormListFieldData) => {
                    return (
                      <div className={styles.item} key={field.name}>
                        {
                          connectorSource.collectionTypes.length > 0 && (
                            <Row>
                              <Col span={16}>
                                <Form.Item
                                  initialValue={getCollectionTypeValue(field.name)}
                                  name={[field.name, 'type']}
                                  className="form-field_fixed-label"
                                  label="Report type:"
                                  labelCol={{ span: 6 }}
                                  wrapperCol={{ span: 18 }}
                                  rules={connectorSource.collectionTypes.length > 1
                                    ? [{ required: true, message: 'You have to choose report type' }]
                                    : undefined}
                                >
                                  <Select
                                    disabled={connectorSource.collectionTypes.length === 1}
                                    onChange={handleReportTypeChange(field.name)}
                                  >
                                    {connectorSource.collectionTypes.map((type: string) => (
                                      <Select.Option key={type} value={type}>
                                        {type}
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col span={1}>
                                <DeleteOutlined
                                  className={styles.delete}
                                  onClick={handleRemoveField(operation, field.name)}
                                />
                              </Col>
                            </Row>
                          )
                        }

                        {/*
                        ToDo: refactor this code. Either create a reused component, or change catalog connectors data to be able
                         to control this code
                      */}
                        {
                          !connectorSource.isSingerType && <Row>
                            <Col span={16}>
                              <Form.Item
                                initialValue={getCollectionScheduleValue(field.name)}
                                name={[field.name, 'schedule']}
                                className="form-field_fixed-label"
                                label="Schedule:"
                                labelCol={{ span: 6 }}
                                wrapperCol={{ span: 18 }}
                                rules={[{ required: true, message: 'You have to choose schedule' }]}
                              >
                                <Select onChange={handleTouchAnyField}>
                                  {
                                    COLLECTIONS_SCHEDULES.map((option) =>
                                      <Select.Option value={option.value} key={option.value}>{option.label}</Select.Option>
                                    )
                                  }
                                </Select>
                              </Form.Item>
                            </Col>
                          </Row>
                        }

                        <>
                          <Row>
                            <Col span={16}>
                              <Form.Item
                                initialValue={generateReportName(0)}
                                className="form-field_fixed-label"
                                label={<span>Report name:</span>}
                                name={[field.name, 'name']}
                                rules={[
                                  { required: true, message: 'Field is required. You can remove this collection.' },
                                  {
                                    validator: (rule: any, value: string) => {
                                      const formValues = form.getFieldsValue();
                                      const isError = formValues.collections
                                        .map((collection, index) => index !== field.name && collection.name)
                                        .includes(value);

                                      return isError
                                        ? Promise.reject('Must be unique under the current collection')
                                        : Promise.resolve();
                                    }
                                  }
                                ]}
                                labelCol={{ span: 6 }}
                                wrapperCol={{ span: 18 }}
                              >
                                <Input autoComplete="off" />
                              </Form.Item>
                            </Col>
                          </Row>

                          {getCollectionParameters(field.name).map((collection: CollectionParameter) => (
                            <SourceFormCollectionsField
                              field={field}
                              key={collection.id}
                              collection={collection}
                              initialValue={initialValues?.collections?.[field.name]?.parameters?.[collection.id] ?? collection.defaultValue}
                              handleFormFieldsChange={handleTouchAnyField}
                            />
                          ))}
                        </>
                      </div>
                    )
                  })
                }

                <Button type="ghost" onClick={handleAddField(operation)} className="add-field-btn" icon={<PlusOutlined />}>
                  Add new collection
                </Button>
              </>
            )
          }
        </Form.List>
      </Form>
    </div>
  );
};

SourceEditorCollections.displayName = 'SourceEditorCollections';

export { SourceEditorCollections };
