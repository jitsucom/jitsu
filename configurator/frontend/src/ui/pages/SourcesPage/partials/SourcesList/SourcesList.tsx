// @Libs
import React, { useCallback, useEffect, useMemo } from 'react';
import { generatePath } from 'react-router-dom';
import { Button, Dropdown, List, message } from 'antd';
import { snakeCase } from 'lodash';
// @Components
import { DropDownList } from '@molecule/DropDownList';
import { SourcesListItem } from './SourcesListItem';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Types
import { SourceConnector } from '@catalog/sources/types';
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Styles
import styles from './SourcesList.module.less';
// @Sources
import { allSources } from '@catalog/sources/lib';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
import { DropDownListItem } from '@molecule/DropDownList/DropDownList';

const SourcesList = ({ projectId, sources, updateSources, setBreadcrumbs }: CommonSourcePageProps) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const sourcesMap = useMemo(
    () =>
      allSources.reduce(
        (accumulator: { [key: string]: SourceConnector }, current: SourceConnector) => ({
          ...accumulator,
          [snakeCase(current.id)]: current
        }),
        {}
      ),
    []
  );

  const isFirstSingerType = useCallback((list: DropDownListItem[], item: DropDownListItem, index: number) => {
    return !item.isSingerType && list[index + 1]?.isSingerType ? styles.isFirstSingerTap : undefined;
  }, []);

  const dropDownList = useMemo(() => <DropDownList
    list={allSources.map((src: SourceConnector) => ({
      title: src.displayName,
      id: src.id,
      icon: src.pic,
      link: generatePath(sourcesPageRoutes.addExact, { source: src.id }),
      isSingerType: src.isSingerType
    }))}
    getClassName={isFirstSingerType}
    filterPlaceholder="Filter by source name or id"
  />, [isFirstSingerType]);

  const handleDeleteSource = useCallback(
    (sourceId: string) => {
      const updatedSources = [...sources.filter((source: SourceData) => sourceId !== source.sourceId)];

      services.storageService.save('sources', { sources: updatedSources }, projectId).then(() => {
        updateSources({ sources: updatedSources });

        message.success('Sources list successfully updated');
      });
    },
    [sources, updateSources, services.storageService, projectId]
  );

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: sourcesPageRoutes.root },
        {
          title: 'Sources List'
        }
      ]
    }));
  }, [setBreadcrumbs]);

  return (
    <>
      {sources?.length > 0
        ? <>
          <div className="mb-5">
            <Dropdown trigger={['click']} overlay={dropDownList}>
              <Button type="primary" icon={<PlusOutlined />}>Add source</Button>
            </Dropdown>
          </div>

          <List key="sources-list" className="sources-list" itemLayout="horizontal" split={true}>
            {sources.map((source) => (
              <SourcesListItem
                sourceData={source}
                handleDeleteSource={handleDeleteSource}
                sourceProto={sourcesMap[source.sourceProtoType]}
                sourceId={source.sourceId}
                key={source.sourceId}
              />
            ))}
          </List>
        </>
        : <div className={styles.empty}>
          <h3 className="text-2xl">Sources list is still empty</h3>
          <div>
            <Dropdown placement="bottomCenter" trigger={['click']} overlay={dropDownList}>
              <Button type="primary" size="large" icon={<PlusOutlined />}>Add source</Button>
            </Dropdown>
          </div>
        </div>
      }
    </>
  );
};

SourcesList.displayName = 'SourcesList';

export { SourcesList };
