// @Libs
import React, { useCallback, useMemo } from 'react';
import { Button, Dropdown, List, message } from 'antd';
import { unset, cloneDeep } from 'lodash';
// @Components
import { ConnectorsCatalog } from '../_common/ConnectorsCatalog';
import { SourcesListItem } from './SourcesListItem';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
// @Services
import ApplicationServices from '../../../../../lib/services/ApplicationServices';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
// @Styles
import './SourcesList.less';
// @Sources
import { allSources } from '@connectors/sources';

const SourcesList = ({ projectId, sources, setSources }: CommonSourcePageProps) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const sourcesMap = useMemo(
    () =>
      allSources.reduce(
        (accumulator: any, current: any) => ({
          ...accumulator,
          [current.id]: current
        }),
        {}
      ),
    []
  );

  const handleDeleteSource = useCallback(
    (sourceId: string) => {
      const updatedSources = cloneDeep(sources);
      unset(updatedSources, sourceId);

      services.storageService.save('sources', updatedSources, projectId).then(() => {
        setSources(updatedSources);

        message.success('Sources list successfully updated');
      });
    },
    [sources, setSources, services.storageService, projectId]
  );

  return (
    <>
      <div className="sources-list__header">
        <Dropdown trigger={['click']} overlay={<ConnectorsCatalog />}>
          <Button type="primary" icon={<PlusOutlined />}>
            Add source
          </Button>
        </Dropdown>
      </div>

      {Object.keys(sources).length > 0 ? (
        <List key="sources-list" className="sources-list" itemLayout="horizontal" split={true}>
          {Object.keys(sources).map((sourceId) => {
            const _current = sources[sourceId];
            const sourceProto = sourcesMap[_current.sourceType];

            return (
              <SourcesListItem
                handleDeleteSource={handleDeleteSource}
                sourceProto={sourceProto}
                sourceId={sourceId}
                key={sourceId}
              />
            );
          })}
        </List>
      ) : (
        <div>No data</div>
      )}
    </>
  );
};

SourcesList.displayName = 'SourcesList';

export { SourcesList };
