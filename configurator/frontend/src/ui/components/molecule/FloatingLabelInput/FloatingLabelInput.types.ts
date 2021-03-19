import * as React from 'react';
import { Rule } from 'antd/lib/form';
import {SizeType} from "antd/lib/config-provider/SizeContext";

export interface Props {
  name: string;
  formName: string;
  floatingLabelText: React.ReactNode;
  rules?: Rule[];
  size?: SizeType
  prefix?: React.ReactNode;
  inputType?:
    | 'button'
    | 'checkbox'
    | 'file'
    | 'hidden'
    | 'image'
    | 'password'
    | 'radio'
    | 'reset'
    | 'submit'
    | 'text'
    | 'email'
    | 'range'
    | 'search'
    | 'tel'
    | 'url';
}
