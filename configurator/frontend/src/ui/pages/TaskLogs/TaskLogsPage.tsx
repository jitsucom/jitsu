import { PageProps } from '@./navigation';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import useLoader from '@./hooks/useLoader';
import ApplicationServices from '@service/ApplicationServices';
import React, { useEffect, useMemo, useState } from 'react';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
import { DatePicker, Select, Tag } from 'antd';
import { TasksTable } from '@page/TaskLogs/TasksTable';
import { useServices } from '@hooks/useServices';
import { colorMap, TaskStatus } from './utils';
import styles from './TaskLogsPage.module.less';
import moment from 'moment';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
import { allSources } from '@catalog/sources/lib';
import { snakeCase } from 'lodash';
import { SourceConnector } from '@catalog/sources/types';
import { CollectionSourceData } from '@page/SourcesPage';
import { PageHeader } from '@atom/PageHeader';

export const taskLogsPageRoute = '/sources/logs/:sourceId'

export const TaskLogsPage: React.FC<PageProps> = ({ setBreadcrumbs }) => {

  const params = useParams<{ sourceId: string, taskId: string }>();
  const services = useServices();
  const location = useLocation();
  const history = useHistory();
  const queryRaw = location.search;
  const query = new URLSearchParams(queryRaw);
  const [filterStatus, setFilterStatus] = useState<TaskStatus>(query.get('status') as TaskStatus || undefined);
  const [filterCollection, setFilterCollection] = useState<string>(query.get('collection') || undefined);
  const [filterStart, setFilterStart] = useState(query.get('start') ? moment.utc(query.get('start')) : moment.utc().subtract(1, 'days'))
  const [filterEnd, setFilterEnd] = useState(query.get('start') ? moment.utc(query.get('end')) : moment.utc())
  const [loadingError, source] = useLoader(async() => {
    const appServices = ApplicationServices.get();
    const data: CollectionSourceData = await appServices.storageService.get('sources', appServices.activeProject.id);
    if (!data.sources) {
      throw new Error(`Invalid response of "sources" collection: ${JSON.stringify(data)}`);
    }
    return data.sources.find((source: SourceData) => source.sourceId === params.sourceId);
  }, [params.sourceId]);

  useEffect(() => {
    if (source) {
      const connectorSource =  allSources
        .find((candidate: SourceConnector) => snakeCase(candidate.id) === source?.sourceProtoType ?? {} as SourceConnector);

      setBreadcrumbs(withHome({
        elements: [
          { title: 'Sources', link: sourcesPageRoutes.root },
          {
            title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode="edit" />,
            link: '/sources/edit/' + source.sourceId
          },
          { title: 'Logs' }
        ]
      }));
    }
  }, [source?.sourceId, setBreadcrumbs])

  const setFilter = (param, val, stateAction, toString?: (any) => string) => {
    toString = toString || ((val) => val + '')
    if (val !== undefined) {
      query.set(param, toString(val));
    } else {
      query.delete(param);
    }
    let queryStr = query.toString();
    if (queryStr.length > 0) {
      queryStr = '?' + queryStr;
    }
    history.push(`/sources/logs/${source.sourceId}${queryStr}`)
    stateAction(val);
  };

  if (loadingError) {
    return <CenteredError error={loadingError} />
  } else if (!source) {
    return <CenteredSpin />
  }
  return <>
    <div className="flex flex-row mb-4 space-x-2">
      <div>
        <span className={styles.filterLabel}>Status:</span>
        <span className={styles.filterEdit}>
          <Select className="w-full" defaultValue={query.get('status') || 'ALL'}
            onChange={(val) => {
              setFilter('status', val === 'ALL' ? undefined : val as TaskStatus, setFilterStatus);
            }}>
            <Select.Option value="ALL">ALL</Select.Option>
            {Object.entries(colorMap).map(([status, color]) =>
              <Select.Option value={status}><Tag color={color}>{status}</Tag></Select.Option>)
            }
          </Select>
        </span>
      </div>
      <div>
        <span className={styles.filterLabel}>Collection:</span>
        <span className={styles.filterEdit}>
          <Select className="w-full" defaultValue={query.get('collection') || 'ALL'}
            onChange={(val) => {
              setFilter('collection', val === 'ALL' ? undefined : val, setFilterCollection);
            }}>
            <Select.Option value="ALL">ALL</Select.Option>
            {source.collections.map(({ name }) =>
              <Select.Option value={name}>{name}</Select.Option>)
            }
          </Select>
        </span>
      </div>
      <div>
        <span className={styles.filterLabel}>From: </span>
        <span className={styles.filterEdit}>
          <DatePicker className="w-full" onChange={(val) => {
            setFilter('start', val.startOf('day'), setFilterStart, (d) => d.toISOString());
          }} defaultValue={filterStart} />
        </span>
      </div>
      <div>
        <span className={styles.filterLabel}>To: </span>
        <span className={styles.filterEdit}>
          <DatePicker className="w-full" onChange={(val) => {
            setFilter('end', val.endOf('day'), setFilterEnd, (d) => d.toISOString());
          }} defaultValue={filterEnd} />
        </span>
      </div>
    </div>
    <TasksTable
      source={source}
      collection={filterCollection}
      status={filterStatus}
      projectId={services.activeProject.id}
      start={filterStart}
      end={filterEnd}
    /></>
}

function plusDays(d: Date, days: number) {
  let dCopy = new Date(d.getTime());
  dCopy.setDate(d.getDate() + days);
  return dCopy
}
