// @Libs
import React, { useCallback, useMemo, useRef } from 'react';
import { Button, Form, Input, Select } from 'antd';
import { get } from 'lodash';
// @Icons
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
// @Types
import { FormListFieldData, FormListOperation } from 'antd/es/form/FormList';
import { FormProps as Props } from './SourceForm.types';
// @Hardcoded data
import { CollectionParameter, Parameter } from '../../../../../../_temp';

const SourceForm = ({
  connectorSource,
  isRequestPending,
  handleFinish,
  alreadyExistSources,
  initialValues,
  formMode
}: Props) => {
  const chosenTypes = useRef<{ indexes: string[] }>({
    indexes: initialValues?.collections?.map((collection) => collection.type) ?? []
  });

  const formName = useMemo<string>(() => `add-source${connectorSource.id}`, [connectorSource.id]);

  const getCollectionParameters = useCallback(
    (index: number) => {
      return connectorSource.collectionParameters?.filter(
        ({ applyOnlyTo }: CollectionParameter) => !applyOnlyTo || applyOnlyTo === chosenTypes.current.indexes[index]
      );
    },
    [connectorSource.collectionParameters]
  );

  const handleRemoveField = useCallback(
    (operation: FormListOperation, index: number) => () => {
      chosenTypes.current.indexes.splice(index, 1);

      operation.remove(index);
    },
    []
  );

  const handleAddField = useCallback(
    (operation: FormListOperation, type: string) => () => {
      chosenTypes.current = {
        indexes: [...chosenTypes.current.indexes, type]
      };

      operation.add({ type });
    },
    []
  );

  console.log('initialValues: ', initialValues);

  return (
    <Form autoComplete="off" name={formName} onFinish={handleFinish} initialValues={initialValues}>
      <h3>Source ID</h3>
      <Form.Item
        className="form-field_fixed-label"
        label="SourceId"
        name="sourceId"
        rules={[
          {
            required: true,
            message: 'Source ID is required field'
          },
          {
            validator: (rule: any, value: string, cb: (error?: string) => void) => {
              Object.keys(alreadyExistSources).find((source) => source === value)
                ? cb('Source ID must be unique!')
                : cb();
            }
          }
        ]}
      >
        <Input />
      </Form.Item>

      <h3>Config</h3>
      {connectorSource.configParameters.map(({ id, displayName, required }: Parameter) => (
        <Form.Item
          initialValue={get(initialValues, `config.${id}`)}
          className="form-field_fixed-label"
          label={displayName}
          key={id}
          name={`config.${id}`}
          rules={required ? [{ required, message: `${displayName} id required` }] : undefined}
        >
          <Input />
        </Form.Item>
      ))}

      <h3>Collections</h3>
      <div className="fields-group">
        <Form.List name="collections">
          {(fields: FormListFieldData[], operation: FormListOperation) => (
            <>
              {fields.map((field: FormListFieldData) => (
                <div className="fields-group" key={field.key}>
                  <h4 className="fields-list-header">
                    <span>
                      {connectorSource.displayName} `{chosenTypes.current.indexes[field.key]}` collection
                    </span>
                    <DeleteOutlined onClick={handleRemoveField(operation, field.key)} />
                  </h4>
                  <Form.Item
                    className="form-field_fixed-label"
                    label="Destination table name"
                    name={[field.name, 'name']}
                    rules={[{ required: true, message: 'Field is required. You can remove this collection.' }]}
                  >
                    <Input />
                  </Form.Item>
                  {getCollectionParameters(field.key).map((collection: CollectionParameter) => {
                    const initial = initialValues?.collections?.[field.name]?.parameters?.[collection.id];

                    return (
                      <Form.Item
                        initialValue={initial}
                        className="form-field_fixed-label"
                        label={collection.displayName}
                        key={collection.id}
                        name={[field.name, collection.id]}
                      >
                        <Select allowClear mode="multiple">
                          {collection.type.data.options.map((option: { displayName: string; id: string }) => (
                            <Select.Option key={option.id} value={option.id}>
                              {option.displayName}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    );
                  })}
                </div>
              ))}

              <div className="fields-group add-fields-container">
                <span className="add-field-prefix">Add</span>
                {connectorSource.collectionTypes.map((type: string) => (
                  <Button type="dashed" key={type} onClick={handleAddField(operation, type)} className="add-field-btn">
                    {type}
                  </Button>
                ))}
              </div>
            </>
          )}
        </Form.List>
      </div>

      <Form.Item>
        <Button
          key="pwd-login-button"
          type="primary"
          htmlType="submit"
          className="login-form-button"
          loading={isRequestPending}
        >
          <span style={{ textTransform: 'capitalize' }}>{formMode}</span>&nbsp;source
        </Button>
      </Form.Item>
    </Form>
  );
};

export { SourceForm };
