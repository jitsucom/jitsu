// @Libs
import React, { memo, useMemo } from 'react';
import cn from 'classnames';
import { generatePath, NavLink } from 'react-router-dom';
// @Hardcoded data
import allSourcesList, { SourceConnector } from '../../../../../../_temp';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @Types
import { Props } from './ConnectorsCatalog.types';
// @Styles
import './ConnectorsCatalog.less';

const ConnectorsCatalogComponent = ({ className, viewType = 'list' }: Props) => {
  const classNameBase = useMemo(() => `connectors-catalog-${viewType}`, [viewType]);

  return (
    <ul className={cn(classNameBase, 'connectors-collection', className)}>
      {allSourcesList.map((item: SourceConnector) => (
        <li key={item.id} className={`${classNameBase}__item`}>
          <NavLink to={generatePath(routes.addExact, { source: item.id })} className={`${classNameBase}__item-link`}>
            <span className={`${classNameBase}__item-link-pic`}>{item.pic}</span>
            <span className={`${classNameBase}__item-link-txt`}>{item.displayName}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
};

ConnectorsCatalogComponent.displayName = 'ConnectorsCatalog';

export const ConnectorsCatalog = memo(ConnectorsCatalogComponent);
