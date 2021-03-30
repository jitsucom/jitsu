// @Libs
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Col, Form, Input, Row, Select } from 'antd';
import { unset } from 'lodash';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
// @Components
import { SourceFormCollectionsField } from './SourceFormCollectionsField';
// @Types
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
import { CollectionParameter } from '@connectors/types';
import { SourceFormCollectionsProps as Props } from './SourceForm.types';

const SourceFormCollections = ({ initialValues, connectorSource, reportPrefix, form }: Props) => {
  const [chosenTypes, setChosenTypes] = useState<{ [key: number]: string }>(
    initialValues.collections?.reduce((accumulator: any, value: CollectionSource, index: number) => {
      return { ...accumulator, [index]: value.type };
    }, {}) ?? {}
  );

  const handleReportTypeChange = useCallback(
    (index: number) => (value: string) => {
      const formValues = form.getFieldsValue();
      const collections = formValues.collections;

      collections[index].name = `${reportPrefix}_${collections[index].type}`;

      form.setFieldsValue({
        ...formValues,
        collections
      });

      setChosenTypes({
        ...chosenTypes,
        [index]: value
      });
    },
    [chosenTypes, form, reportPrefix]
  );

  const getCollectionParameters = useCallback(
    (index: number) =>
      connectorSource.collectionParameters?.filter(
        ({ applyOnlyTo }: CollectionParameter) => !applyOnlyTo || applyOnlyTo === chosenTypes[index]
      ),
    [connectorSource.collectionParameters, chosenTypes]
  );

  const handleRemoveField = useCallback(
    (operation: FormListOperation, index: number) => () => {
      const newChosenTypes = { ...chosenTypes };

      unset(newChosenTypes, index);
      setChosenTypes(newChosenTypes);

      operation.remove(index);
    },
    [chosenTypes]
  );

  const handleAddField = useCallback(
    (operation: FormListOperation) => () => {
      const addingValue =
        connectorSource.collectionTypes.length > 1
          ? {}
          : { type: connectorSource.collectionTypes[0] };

      operation.add(addingValue);
    },
    [connectorSource.collectionTypes]
  );

  const getCollectionTypeValue = useCallback(
    (index: number) => {
      const initial = initialValues.collections?.[index]?.type;

      if (initial) {
        return initial;
      }

      return connectorSource.collectionTypes.length > 1
        ? undefined
        : connectorSource.collectionTypes[0];
    },
    [initialValues, connectorSource.collectionTypes]
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
    <div className="custom-report">
      <h3>Configure collections</h3>
      <article className="fields-group">
        Each source can export one or more collections.
        <br />
        Think of collection as a table in a database or sheet in a spreadsheet Read more about collections in our{' '}
        <a href="https://jitsu.com/docs/sources-configuration#collections" target="_blank" rel="noreferrer">
          documentation
        </a>
        .
      </article>
      <Form.List name="collections" initialValue={updatedInitialValues}>
        {(fields: FormListFieldData[], operation: FormListOperation) => (
          <>
            {fields.map((field: FormListFieldData) => {
              return (
                <div className="custom-report__group" key={field.key}>
                  <Row>
                    <Col span={16}>
                      <Form.Item
                        initialValue={getCollectionTypeValue(field.key)}
                        name={[field.name, 'type']}
                        className="form-field_fixed-label"
                        label="Report type:"
                        labelCol={{ span: 6 }}
                        wrapperCol={{ span: 18 }}
                        rules={connectorSource.collectionTypes.length > 1
                          ? [{ required: true, message: 'You have top choose report type' }]
                          : undefined}
                      >
                        <Select
                          disabled={connectorSource.collectionTypes.length === 1}
                          onChange={handleReportTypeChange(field.key)}
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
                        className="custom-report__group-composite-delete"
                        onClick={handleRemoveField(operation, field.key)}
                      />
                    </Col>
                  </Row>

                  <>
                    <Row>
                      <Col span={16}>
                        <Form.Item
                          className="form-field_fixed-label"
                          label={<span>Report name:</span>}
                          name={[field.name, 'name']}
                          rules={[
                            { required: true, message: 'Field is required. You can remove this collection.' },
                            {
                              validator: (rule: any, value: string) => {
                                const formValues = form.getFieldsValue();
                                const isError = formValues.collections
                                  .map((collection, index) => index !== field.key && collection.name)
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

                    {getCollectionParameters(field.key).map((collection: CollectionParameter) => (
                      <SourceFormCollectionsField
                        field={field}
                        key={collection.id}
                        collection={collection}
                        initialFieldValue={initialValues?.collections?.[field.name]}
                      />
                    ))}
                  </>
                </div>
              );
            })}

            <Button type="ghost" onClick={handleAddField(operation)} className="add-field-btn" icon={<PlusOutlined />}>
              Add one
            </Button>
          </>
        )}
      </Form.List>
    </div>
  );
};

SourceFormCollections.displayName = 'SourceFormCollections';
export { SourceFormCollections };
