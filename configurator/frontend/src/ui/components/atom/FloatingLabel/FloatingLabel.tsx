// @Libs
import * as React from 'react';
import cn from 'classnames';
// @Types
import { Props } from './FloatingLabel.types';
// @Styles
import './FloatingLabel.less';

const FloatingLabelComponent = ({ className, htmlFor, render, hasValue, size }: Props) => {
  return (
    <label className={cn(
      'floating-label', className, hasValue && 'floating-label_active',
      { "floating-label-large": size === "large" }
    )}
    htmlFor={htmlFor}>
      {render}
    </label>
  );
};

FloatingLabelComponent.displayName = 'FloatingLabel';

export const FloatingLabel = React.memo(FloatingLabelComponent);
