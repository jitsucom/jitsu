// @Libs
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { useServices } from '@hooks/useServices';

const AddSourceDialogComponent = () => {
  const history = useHistory();

  const [filterParam, setFilterParam] = useState<string>();
  const services = useServices();

  const handleClick = (src: SourceConnector) => (e: React.MouseEvent) => {
    if (src.isSingerType) {
      e.stopPropagation();
      e.preventDefault();
      services.analyticsService.track('singer_connector_attempt', {
        app: services.features.appName,
        connector_id: src.id
      });

      Modal.confirm({
        title: <><b>{src.displayName}</b> - alpha version notice!</>,
        icon: <ExclamationCircleOutlined/>,
        content: <>
          <b>{src.displayName}</b> connector is available as alpha version only, it requires an
          understanding of <a href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md">Singer Protocol</a>
          <br /><br />
          Do you want to continue?
        </>,
        okText: 'Add',
        cancelText: 'Cancel',
        onOk: () => {
          services.analyticsService.track('singer_connector_added', {
            app: services.features.appName,
            connector_id: src.id
          });
          history.push(generatePath(sourcesPageRoutes.addExact, { source: src.id }));
        }
      });
    }
  };

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

  useEffect(() => {
    document.body.classList.add('custom-scroll-body');

    return () => document.body.classList.remove('custom-scroll-body');
  }, []);

  return (
    <div className={styles.dialog}>
      <div className={styles.filter}>
        <Input placeholder="Filter by source name or id" onChange={handleChange} className={styles.filterInput} />
      </div>

      <div className={styles.list}>
        {
          filteredSourcesList.map((src: SourceConnector) => (
            <Link
              to={generatePath(sourcesPageRoutes.addExact, { source: src.id })}
              key={src.id}
              className={styles.item}
              onClick={handleClick(src)}
            >
              <span className={styles.pic}>{src.pic}</span>
              <span className={styles.title}>{src.displayName}</span>

              {
                src.isSingerType
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
