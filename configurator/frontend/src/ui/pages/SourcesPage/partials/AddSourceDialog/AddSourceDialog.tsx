// @Libs
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Link, generatePath, useHistory } from 'react-router-dom';
import { Badge, Input, Modal } from 'antd';
import cn from 'classnames';
import { debounce } from 'lodash';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
// @Styles
import styles from './AddSourceDialog.module.less';
// @Types
import { SourceConnector } from '@catalog/sources/types';
// @Icons
import { StarOutlined, StarFilled, ExclamationCircleOutlined } from '@ant-design/icons';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/SourcesPage.routes';

const AddSourceDialogComponent = () => {
  const history = useHistory();

  const [filterParam, setFilterParam] = useState<string>();

  const handleClick = useCallback((isSingerType: boolean, id: string) => (e: React.MouseEvent) => {
    if (isSingerType) {
      e.stopPropagation();
      e.preventDefault();

      Modal.confirm({
        title: 'Please confirm',
        icon: <ExclamationCircleOutlined/>,
        content: 'Are you sure?',
        okText: 'Go',
        cancelText: 'Cancel',
        onOk: () => {
          history.push(generatePath(sourcesPageRoutes.addExact, { source: id }));
        }
      });
    }
  }, [history]);

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilterParam(e.target.value);
    }, []),
    500
  );

  const filteredSourcesList = useMemo<SourceConnector[]>(
    () => filterParam
      ? allSources.filter((src: SourceConnector) => src.displayName.toLowerCase().includes(filterParam.toLowerCase()) || src.id.toLowerCase().includes(filterParam.toLowerCase()))
      : allSources,
    [filterParam]
  );

  return (
    <div className={styles.dialog}>
      <div className={styles.filter}>
        <Input placeholder="Filter by source name or id" onChange={handleChange} className={styles.filterInput} />
      </div>

      <div className={styles.list}>
        {
          filteredSourcesList.map(({ id, pic, displayName, isSingerType }: SourceConnector) => (
            <Link
              to={generatePath(sourcesPageRoutes.addExact, { source: id })}
              key={id}
              className={styles.item}
              onClick={handleClick(isSingerType, id)}
            >
              <span className={styles.pic}>{pic}</span>
              <span className={styles.title}>{displayName}</span>

              {
                isSingerType
                  ? <Badge.Ribbon text="Expert mode" className={styles.expertLabel} />
                  : <span className={styles.star}>
                    <StarOutlined className={cn(styles.starIcon, styles.strokeStar)} />
                    <StarFilled className={cn(styles.starIcon, styles.fillStar)} />
                  </span>
              }
            </Link>
          ))
        }
      </div>
    </div>
  );
};

AddSourceDialogComponent.displayName = 'AddSourceDialog';

export const AddSourceDialog = memo(AddSourceDialogComponent);
