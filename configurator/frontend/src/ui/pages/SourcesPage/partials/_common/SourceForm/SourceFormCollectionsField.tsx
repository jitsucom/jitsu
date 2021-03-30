// @Libs
import React, { memo, useMemo } from 'react';
import { Col, Form, Input, Row, Select } from 'antd';
// @Components
import { LabelWithTooltip } from '@./lib/components/components';
// @Types
import { SourceFormCollectionsFieldProps as Props } from './SourceForm.types';
import { Rule } from 'antd/lib/form';

const SourceFormCollectionsFieldComponent = ({
  collection,
  field,
  initialFieldValue,
  documentation
}: Props) => {
  const initial = initialFieldValue?.parameters?.[collection.id];

  const formItemChild = useMemo(() => {
    switch (collection.type.typeName) {
    case 'selection':
      return (
        <Select
          allowClear
          mode={(collection.type.data?.maxOptions > 1 || !collection.type.data?.maxOptions)
            ? 'multiple'
            : undefined}
        >
          {collection.type.data.options.map((option: { displayName: string; id: string }) => (
            <Select.Option key={option.id} value={option.id}>
              {option.displayName}
            </Select.Option>
          ))}
        </Select>
      );
    case 'string':
    default:
      return <Input autoComplete="off" />;
    }
  }, [collection]);

  const validationRules = useMemo(() => {
    const rules = [];

    if (collection.required) {
      rules.push({ required: collection.required, message: `${collection.displayName} is required` });
    }

    if (collection.type.data?.maxOptions > 1) {
      rules.push({
        validator: (rule: Rule, value: string[]) => value?.length <= collection.type.data.maxOptions
          ? Promise.resolve()
          : Promise.reject(`You can select maximum ${collection.type.data?.maxOptions} options`)
      });
    }

    return rules;
  }, [collection]);

  return (
    <Row>
      <Col span={16}>
        <Form.Item
          initialValue={initial}
          className="form-field_fixed-label"
          label={documentation ?
            <LabelWithTooltip documentation={documentation}>{collection.displayName}</LabelWithTooltip> :
            <span>{collection.displayName}:</span>}
          key={collection.id}
          name={[field.name, collection.id]}
          rules={validationRules}
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          {formItemChild}
        </Form.Item>
      </Col>
    </Row>
  );
};

SourceFormCollectionsFieldComponent.displayName = 'SourceFormCollectionsField';

export const SourceFormCollectionsField = memo(SourceFormCollectionsFieldComponent);
