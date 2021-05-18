// @Libs
import { memo } from 'react';
import { Tooltip } from 'antd'
// @Types
import { Props } from './ComingSoon.types';

const ComingSoonComponent = ({ render, documentation }: Props) => (
  <Tooltip title={documentation}>
    {render}

    <sup>
      <i>Coming Soon!</i>
    </sup>
  </Tooltip>
);

ComingSoonComponent.displayName = 'ComingSoon';

export const ComingSoon = memo(ComingSoonComponent);
