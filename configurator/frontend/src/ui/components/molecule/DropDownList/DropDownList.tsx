// @Libs
import React, { memo, useCallback, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Input } from 'antd';
import { debounce } from 'lodash';
// @Styles
import styles from './DropDownList.module.less';

export interface Props {
  className?: string;
  filterPlaceholder: string;
  list: any;
  getPath: (param: string) => string;
}

const DropDownListComponent = ({ filterPlaceholder, className, list, getPath }: Props) => {
  const [filteredParam, setFilteredParam] = useState<string>();

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilteredParam(e.target.value);
    }, []),
    500
  );

  const filteredList = useMemo(() => filteredParam
    ? list.filter(item => item.displayName.includes(filteredParam))
    : list, [list, filteredParam]);

  return (
    <div className={styles.dropdown}>
      <div className={styles.filter}>
        <Input onChange={handleChange} placeholder={filterPlaceholder} />
      </div>

      <ul className={styles.list}>
        {filteredList.map((item: any) => (
          <li key={`${item.id}-${item.displayName}`} className={styles.item}>
            <NavLink to={getPath(item.id)} className={styles.link}>
              <span className={styles.icon}>{item.ui.icon}</span>
              <span className={styles.name}>{item.displayName}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
};

DropDownListComponent.displayName = 'DropDownList';

export const DropDownList = memo(DropDownListComponent);
