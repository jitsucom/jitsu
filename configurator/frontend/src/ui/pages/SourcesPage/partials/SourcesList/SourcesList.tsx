// @Libs
import React, { useCallback, useEffect, useMemo } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, Menu, message } from 'antd';
import snakeCase from 'lodash/snakeCase';
// @Components
import { ListItem } from '@component/ListItem/ListItem';
import { ListItemDescription } from '@component/ListItem/ListItemDescription';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import CodeOutlined from '@ant-design/icons/lib/icons/CodeOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import DownOutlined from '@ant-design/icons/lib/icons/DownOutlined';

// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Types
import { SourceConnector } from '@catalog/sources/types';
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage';
import { withHome } from '@component/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './SourcesList.module.less';
// @Sources
import { allSources } from '@catalog/sources/lib';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/SourcesPage.routes';
// @Utils
import { sourcePageUtils } from '@page/SourcesPage/SourcePage.utils';
import { taskLogsPageRoute } from '@page/TaskLogs/TaskLogsPage';
import { withProgressBar } from '@./lib/components/components';

const SourcesList = ({ projectId, sources, updateSources, setBreadcrumbs }: CommonSourcePageProps) => {
  const history = useHistory();

  const services = useMemo(() => ApplicationServices.get(), []);

  const sourcesMap = useMemo<{ [key: string]: SourceConnector }>(
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

  const handleAddClick = useCallback(() => history.push(sourcesPageRoutes.add), [history]);

  const scheduleTasks = async(src: SourceData, full = false) => {
    await withProgressBar({
      estimatedMs: 200,
      maxRetries: 2,
      retryDelayMs: 2000,
      callback: async() => {
        if (full) {
          await services.backendApiClient.post('/sources/clear_cache', {
            proxy: true,
            source: `${services.activeProject.id}.${src.sourceId}`,
            project_id: services.activeProject.id
          });
        }

        if (src.collections && src.collections.length > 0) {
          for (let i = 0; i < src.collections.length; i++) {
            await services.backendApiClient.post('/tasks', undefined, {
              proxy: true,
              urlParams: {
                source: `${services.activeProject.id}.${src.sourceId}`,
                collection: src.collections[i].name,
                project_id: services.activeProject.id }
            });
          }
        } else {
          //workaround for singer, it doesn't have collections, so we should pass
          //any value
          await services.backendApiClient.post('/tasks', undefined, {
            proxy: true,
            urlParams: {
              source: `${services.activeProject.id}.${src.sourceId}`,
              collection: 'bogus',
              project_id: services.activeProject.id }
          });
        }
        history.push(generatePath(taskLogsPageRoute, { sourceId: src.sourceId }));
      }
    })

  };
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

  if (sources.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className="text-2xl">Sources list is still empty</h3>
        <div>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={handleAddClick}>Add source</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick}>Add source</Button>
      </div>

      <ul>
        {sources.map((src: SourceData) => {
          const reference = sourcesMap[src.sourceProtoType];

          return <ListItem
            description={<ListItemDescription render={reference.displayName} />}
            title={sourcePageUtils.getTitle(src)}
            icon={reference?.pic}
            id={src.sourceId}
            key={src.sourceId}
            actions={[
              { component: <Dropdown trigger={['click']} overlay={
                <Menu>
                  <Menu.Item key="inc">
                    <Button type="link" onClick={async() => await scheduleTasks(src, false)}>Sync Now</Button>
                  </Menu.Item>
                  <Menu.Item  key="all">
                    <Button onClick={async() => await scheduleTasks(src, true)}  type="link">Full Re-sync (clear cache)</Button>
                  </Menu.Item>
                </Menu>

              }><Button type="link" className="align-bottom">Sync Now <DownOutlined /></Button></Dropdown>, icon: <CodeOutlined /> },
              { onClick: () => history.push(generatePath(taskLogsPageRoute, { sourceId: src.sourceId })), title: 'View logs', icon: <CodeOutlined /> },
              { onClick: () => history.push(generatePath(sourcesPageRoutes.editExact, { sourceId: src.sourceId })), title: 'Edit', icon: <EditOutlined /> },
              { onClick: () => {
                const updatedSources = [...sources.filter((source: SourceData) => src.sourceId !== source.sourceId)];

                services.storageService.save('sources', { sources: updatedSources }, projectId).then(() => {
                  updateSources({ sources: updatedSources });

                  message.success('Sources list successfully updated');
                });

              }, title: 'Delete', icon: <DeleteOutlined /> }
            ]}
          />
        })}
      </ul>
    </>
  );
};

SourcesList.displayName = 'SourcesList';

export { SourcesList };
