// @Libs
import { useCallback, useEffect, useMemo } from 'react';
import { generatePath, useHistory } from 'react-router-dom';
import { Button, Dropdown, Menu, message } from 'antd';
import { observer } from 'mobx-react-lite';
import snakeCase from 'lodash/snakeCase';
// @Components
import { ListItem } from 'ui/components/ListItem/ListItem';
import { ListItemDescription } from 'ui/components/ListItem/ListItemDescription';
// @Store
import { sourcesStore } from 'stores/sources';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import CodeOutlined from '@ant-design/icons/lib/icons/CodeOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import DownOutlined from '@ant-design/icons/lib/icons/DownOutlined';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Types
import { SourceConnector } from 'catalog/sources/types';
import { CommonSourcePageProps } from 'ui/pages/SourcesPage/SourcesPage';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Styles
import styles from './SourcesList.module.less';
// @Sources
import { allSources } from 'catalog/sources/lib';
// @Routes
import { sourcesPageRoutes } from 'ui/pages/SourcesPage/SourcesPage.routes';
// @Utils
import { sourcePageUtils } from 'ui/pages/SourcesPage/SourcePage.utils';
import { taskLogsPageRoute } from 'ui/pages/TaskLogs/TaskLogsPage';
import { withProgressBar } from 'lib/components/components';
import { showQuotaLimitModal } from '../../../../../lib/services/billing';
import {SourceCard} from "../../../../components/SourceCard/SourceCard";

const SourcesListComponent = ({ setBreadcrumbs }: CommonSourcePageProps) => {
  const history = useHistory();

  const services = useMemo(() => ApplicationServices.get(), []);

  const allSourcesMap = useMemo<{ [key: string]: SourceConnector }>(
    () =>
      allSources.reduce(
        (
          accumulator: { [key: string]: SourceConnector },
          current: SourceConnector
        ) => ({
          ...accumulator,
          [snakeCase(current.id)]: current
        }),
        {}
      ),
    []
  );

  const scheduleTasks = async(src: SourceData, full = false) => {
    await withProgressBar({
      estimatedMs: 200,
      maxRetries: 2,
      retryDelayMs: 2000,
      callback: async() => {
        if (full) {
          await services.backendApiClient.post(
            '/sources/clear_cache',
            {
              source: `${services.activeProject.id}.${src.sourceId}`,
              project_id: services.activeProject.id
            },
            { proxy: true, urlParams: { delete_warehouse_data: true } }
          );
        }

        if (src.collections && src.collections.length > 0) {
          for (let i = 0; i < src.collections.length; i++) {
            await services.backendApiClient.post('/tasks', undefined, {
              proxy: true,
              urlParams: {
                source: `${services.activeProject.id}.${src.sourceId}`,
                collection: src.collections[i].name,
                project_id: services.activeProject.id
              }
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
              project_id: services.activeProject.id
            }
          });
        }
        history.push(
          generatePath(taskLogsPageRoute, { sourceId: src.sourceId })
        );
      }
    });
  };

  const handleAddClick = useCallback(
    () => {
      services.features.billingEnabled;
      if (
        sourcesStore.sources.length >=
          services.currentSubscription?.currentPlan.quota.sources ??
        999
      ) {
        showQuotaLimitModal(
          services.currentSubscription,
          <>
            You current plan allows to have only{' '}
            {services.currentSubscription.currentPlan.quota.sources} sources
          </>
        );
        return;
      }
      history.push(sourcesPageRoutes.add)
    },
    [history]
  );

  useEffect(() => {
    setBreadcrumbs(
      withHome({
        elements: [
          { title: 'Sources', link: sourcesPageRoutes.root },
          {
            title: 'Sources List'
          }
        ]
      })
    );
  }, [setBreadcrumbs]);

  if (sourcesStore.sources.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className="text-2xl">Sources list is still empty</h3>
        <div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={handleAddClick}
          >
            Add source
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick}>
          Add source
        </Button>
      </div>

      <div className="flex flex-wrap justify-center">
        {sourcesStore.sources.map((src: SourceData) => {
          const reference = allSourcesMap[src.sourceProtoType];
          return (<SourceCard src={src} />);
        })}
      </div>
    </>
  );
};

const SourcesList = observer(SourcesListComponent);

SourcesList.displayName = 'SourcesList';

export { SourcesList };
