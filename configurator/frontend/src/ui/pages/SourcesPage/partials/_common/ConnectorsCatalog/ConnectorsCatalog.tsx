// @Libs
import React, { memo, useCallback, useMemo, useState } from 'react';
import { generatePath, NavLink } from 'react-router-dom';
import cn from 'classnames';
import { debounce } from 'lodash';
import { Input } from 'antd';
// @Sources
import { allSources } from '@connectors/sources';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @Types
import { SourceConnector } from '@connectors/types';
import { Props } from './ConnectorsCatalog.types';
// @Styles
import './ConnectorsCatalog.less';

const ConnectorsCatalogComponent = ({ className, viewType = 'list' }: Props) => {
  const [filteredParam, setFilteredParam] = useState<string>();

  const classNameBase = useMemo(() => `connectors-catalog-${viewType}`, [viewType]);

  const filteredSourcesList = useMemo(
    () =>
      !filteredParam
        ? allSources
        : allSources.filter(
          (source) => source.id.includes(filteredParam) || source.displayName.includes(filteredParam)
        ),
    [filteredParam]
  );

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilteredParam(e.target.value);
    }, []),
    500
  );

  return (
    <div className={`${classNameBase}-wrap`}>
      <div>
        <Input onChange={handleChange} placeholder="Filter by source name" />
      </div>

      <ul className={cn(classNameBase, 'connectors-collection', className)}>
        {filteredSourcesList.map((item: SourceConnector) => (
          <li key={`${item.id}-${item.displayName}`} className={`${classNameBase}__item`}>
            <NavLink to={generatePath(routes.addExact, { source: item.id })} className={`${classNameBase}__item-link`}>
              <span className={`${classNameBase}__item-link-pic`}>{item.pic}</span>
              <span className={`${classNameBase}__item-link-txt`}>{item.displayName}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
};

ConnectorsCatalogComponent.displayName = 'ConnectorsCatalog';

export const ConnectorsCatalog = memo(ConnectorsCatalogComponent);
