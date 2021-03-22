// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { Form, Input, Select } from 'antd';
// @Components
import { LabelWithTooltip } from '../../../../../../lib/components/components';
// @Types
import { SourceFormCollectionsFieldProps as Props } from './SourceForm.types';
import { CollectionParameter } from '@connectors/types';
import { Rule } from 'antd/lib/form';

const SourceFormCollectionsFieldComponent = ({
  collection,
  field,
  initialFieldValue,
  documentation
}: Props) => {
  const initial = initialFieldValue?.parameters?.[collection.id];

  const handleChange = useCallback((collection: CollectionParameter) => (value: string) => {
    const maxOptions = collection.type.data?.maxOptions;

    if (value.length >= maxOptions) {
    }
  }, []);

  const formItemChild = useMemo(() => {
    switch (collection.type.typeName) {
    case 'selection':
      return (
        <Select allowClear mode="multiple" onChange={handleChange(collection)}>
          {collection.type.data.options.map((option: { displayName: string; id: string }) => (
            <Select.Option key={option.id} value={option.id}>
              {option.displayName}
            </Select.Option>
          ))}
        </Select>
      );
    case 'string':
    default:
      return <Input/>;
    }
  }, [collection, handleChange]);
  const validationRules = useMemo(() => {
    const rules = [];

    if (collection.required) {
      rules.push({ required: collection.required, message: `${collection.displayName} is required` });
    }

    if (collection.type.data?.maxOptions) {
      rules.push({
        validator: (rule: Rule, value: string[]) => value.length <= collection.type.data.maxOptions ? Promise.resolve() : Promise.reject(`You can select maximum ${collection.type.data?.maxOptions} options`)
      });
    }

    return rules;
  }, [collection]);

  return (
    <Form.Item
      initialValue={initial}
      className="form-field_fixed-label"
      label={documentation ?
        <LabelWithTooltip documentation={documentation}>{collection.displayName}:</LabelWithTooltip> :
        <span className="field-label">{collection.displayName}:</span>}
      key={collection.id}
      name={[field.name, collection.id]}
      rules={validationRules}
    >
      {formItemChild}
    </Form.Item>
  );
};

SourceFormCollectionsFieldComponent.displayName = 'SourceFormCollectionsField';

export const SourceFormCollectionsField = memo(SourceFormCollectionsFieldComponent);
