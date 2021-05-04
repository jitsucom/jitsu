import { Button } from 'antd';
import ArrowLeftOutlined from '@ant-design/icons/lib/icons/ArrowLeftOutlined';
import { generatePath, NavLink, useHistory, useParams } from 'react-router-dom';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
import { Task, TaskId, TaskLogEntry } from './utils';
import { useLoader } from '@hooks/useLoader';
import { useServices } from '@hooks/useServices';
import { CollectionSourceData } from '@page/SourcesPage';
import React, { useEffect } from 'react';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
import { PageHeader } from '@atom/PageHeader';
import { PageProps } from '@./navigation';
import { allSources } from '@catalog/sources/lib';
import { SourceConnector } from '@catalog/sources/types';
import { snakeCase } from 'lodash';
import { taskLogsPageRoute } from '@page/TaskLogs/TaskLogsPage';
import styles from './TaskLogsPage.module.less'
import classNames from 'classnames';

export const taskLogsViewerRoute = '/sources/logs/:sourceId/:taskId'
type TaskInfo = {
  task: Task,
  logs: TaskLogEntry[],
  source: SourceData
}
export const TaskLogViewer: React.FC<PageProps> = ({ setBreadcrumbs }) => {
  let { sourceId, taskId } = useParams<{sourceId: string, taskId: string}>()
  taskId = TaskId.decode(taskId);
  const services = useServices();
  const history = useHistory();
  const [error, taskInfo] = useLoader<TaskInfo>(async() => {
    const data: CollectionSourceData = await services.storageService.get('sources', services.activeProject.id);
    if (!data.sources) {
      throw new Error(`Invalid response of "sources" collection: ${JSON.stringify(data)}`);
    }
    const source = data.sources.find((source: SourceData) => source.sourceId === sourceId);
    const task = await services.backendApiClient.get(`/tasks/${encodeURIComponent(taskId)}?project_id=${services.activeProject.id}`, { proxy: true });
    const logs = (await services.backendApiClient.get(`/tasks/${encodeURIComponent(taskId)}/logs?project_id=${services.activeProject.id}`, { proxy: true }))['logs'];
    return { task, logs, source }
  })

  useEffect(() => {
    if (taskInfo) {
      const connectorSource =  allSources
        .find((candidate: SourceConnector) => snakeCase(candidate.id) === taskInfo.source?.sourceProtoType ?? {} as SourceConnector);
      setBreadcrumbs(withHome({
        elements: [
          { title: 'Sources', link: sourcesPageRoutes.root },
          {
            title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode="edit" />,
            link: generatePath(sourcesPageRoutes.editExact, { sourceId })
          },
          {
            title: 'Logs',
            link: generatePath(taskLogsPageRoute, { sourceId })
          },
          { title: 'Task Log' }
        ]
      }));
    }
  }, [setBreadcrumbs, sourceId, taskId, taskInfo])

  if (error) {
    return <CenteredError error={error} />
  } else if (!taskInfo) {
    return <CenteredSpin />
  }

  return <div>
    <Button type="primary" className="mb-4" icon={<ArrowLeftOutlined />} onClick={() => history.push(generatePath(taskLogsPageRoute, { sourceId }))}>
      Back to task list
    </Button>
    <div className={classNames(styles.logViewerWrapper, 'custom-scrollbar')}>
      <pre className={classNames(styles.logViewer, 'custom-scrollbar')}>
        {taskInfo.logs.map(l => <span className={classNames(styles['logEntry' + l.level], styles.logEntry)}><span className={styles.logTime}>{l.time}</span> <span className={styles.logLevel}>[{l.level.toUpperCase()}]</span> - <span className={styles.logMessage}>{l.message}</span>{'\n'}</span>)}
      </pre>
    </div>
  </div>

}
