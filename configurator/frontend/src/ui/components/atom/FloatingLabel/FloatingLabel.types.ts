import * as React from 'react';
import {SizeType} from "antd/lib/config-provider/SizeContext";

export interface Props {
  className?: string;
  htmlFor: string;
  render: React.ReactNode;
  size?: SizeType
  hasValue?: boolean;
}
