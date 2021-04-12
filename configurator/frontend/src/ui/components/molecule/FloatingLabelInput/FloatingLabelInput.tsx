// @Libs
import * as React from 'react';
import { Form, Input } from 'antd';
import cn from 'classnames';
// @Components
import { FloatingLabel } from '@atom/FloatingLabel';
// @Types
import { Props } from './FloatingLabelInput.types';

const FloatingLabelInputComponent = ({ formName, name, rules, floatingLabelText, prefix, inputType = 'text', size, className }: Props) => {
  return (
    <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues[name] !== currentValues[name]}>
      {/* ToDo: getInternalHooks what is it??? */}
      {({ getFieldValue }) => (
        <Form.Item name={name} rules={rules}>
          <Input
            className={cn('with-floating-label', className)}
            prefix={prefix}
            suffix={<FloatingLabel className={prefix && 'with-prefix'} size={size} hasValue={getFieldValue(name)} htmlFor={`${formName}_${name}`} render={floatingLabelText} />}
            type={inputType}
            size={size}
          />
        </Form.Item>
      )}
    </Form.Item>
  );
};

FloatingLabelInputComponent.displayName = 'FloatingLabelInput';

export const FloatingLabelInput = React.memo(FloatingLabelInputComponent);
