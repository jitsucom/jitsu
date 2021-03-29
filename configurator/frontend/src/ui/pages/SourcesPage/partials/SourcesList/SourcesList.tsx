// @Libs
import React, { useCallback, useMemo } from 'react';
import { Button, Dropdown, List, message } from 'antd';
// @Components
import { ConnectorsCatalog } from '../_common/ConnectorsCatalog';
import { SourcesListItem } from './SourcesListItem';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Types
import { SourceConnector } from '@connectors/types';
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
// @Styles
import styles from './SourcesList.module.less';
// @Sources
import { allSources } from '@connectors/sources';

const SourcesList = ({ projectId, sources, setSources }: CommonSourcePageProps) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const sourcesMap = useMemo(
    () =>
      allSources.reduce(
        (accumulator: { [key: string]: SourceConnector }, current: SourceConnector) => ({
          ...accumulator,
          [current.id]: current
        }),
        {}
      ),
    []
  );

  const handleDeleteSource = useCallback(
    (sourceId: string) => {
      const updatedSources = [...sources.filter((source: SourceData) => sourceId !== source.sourceId)];

      services.storageService.save('sources', { sources: updatedSources }, projectId).then(() => {
        setSources({ sources: updatedSources });

        message.success('Sources list successfully updated');
      });
    },
    [sources, setSources, services.storageService, projectId]
  );

  return (
    <>
      {sources?.length > 0
        ? <>
          <div className="mb-5">
            <Dropdown trigger={['click']} overlay={<ConnectorsCatalog />}>
              <Button type="primary" icon={<PlusOutlined />}>Add source</Button>
            </Dropdown>
          </div>

          <List key="sources-list" className="sources-list" itemLayout="horizontal" split={true}>
            {sources.map((source) => {
              const sourceProto = sourcesMap[source.sourceId];

              return (
                <SourcesListItem
                  handleDeleteSource={handleDeleteSource}
                  sourceProto={sourceProto}
                  sourceId={source.sourceId}
                  key={source.sourceId}
                />
              );
            })}
          </List>
        </>
        : <div className={styles.empty}>
          <h3 className="text-2xl">Sources list is still empty</h3>
          <div>
            <Dropdown placement="bottomCenter" trigger={['click']} overlay={<ConnectorsCatalog />}>
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
