import { generatePath, NavLink } from 'react-router-dom';
import ApplicationServices from '@service/ApplicationServices';
import { ReactNode } from 'react';
import { CenteredError, CenteredSpin } from '@./lib/components/components';
import { Button, Table, Tag } from 'antd';
import RedoOutlined from '@ant-design/icons/lib/icons/RedoOutlined';
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import moment, { Moment } from 'moment';
import { colorMap, Task, TaskStatus } from '@page/TaskLogs/utils';
import { taskLogsViewerRoute } from '@page/TaskLogs/TaskLogViewer';
import useLoader from '@hooks/useLoader';

export type TasksTableProps = {
  source: SourceData,
  projectId: string
  start: Moment,
  end: Moment,
  status?: TaskStatus
  collection?: string
}
export const TasksTable: React.FC<TasksTableProps> = (props) => {
  const [loadingError, tasksSorted] = useLoader<Task[]>(async() => {
    const appServices = ApplicationServices.get();

    const tasks = await appServices.backendApiClient.get('/tasks',
      {
        proxy: true, urlParams: {
          project_id: props.projectId,
          source: `${props.projectId}.${props.source.sourceId}`,
          start: props.start.toISOString(),
          end: props.end.toISOString(),
          collection: props.collection || undefined,
          status: props.status || undefined
        }
      });
    return tasks.tasks.sort(comparator<Task>(t => new Date(t.created_at)));
  }, [props.projectId,props.start, props.end, props.collection, props.status]);

  if (loadingError) {
    return <CenteredError error={loadingError} />
  } else if (!tasksSorted) {
    return <CenteredSpin />
  }
  return <Table dataSource={tasksSorted.map(taskToRow)} columns={columns.map((c) => toAntColumn(c, props))} />
}

type TableRow = {
  key: string
  status: TaskStatus
  date: {
    started: Date
  }
  collection: string,
  logs: {
    taskId: string
  }
}

type ColumnData = {
  column: keyof TableRow | 'action',
  title: string,
  render?: (row: TableRow, props: TasksTableProps) => ReactNode
}

const columns: ColumnData[] = [
  {
    column: 'status', title: 'Status', render: (t) => {
      return <div className="flex flex-col justify-between">
        <div><Tag color={colorMap[t.status]}>{t.status}</Tag></div>
      </div>;
    }
  },
  {
    column: 'date', title: 'Started', render: (t, props) => {
      const date = moment.utc(t.date.started.toISOString());
      const now = moment.utc(new Date().toISOString());
      return <div>
        <div>{date.from(now)}
          {' • '}
          <NavLink className="border-b border-dashed" to={generatePath(taskLogsViewerRoute, { sourceId: props.source.sourceId, taskId:t.logs.taskId })}>View logs</NavLink>
        </div>
        <div className="text-xs text-secondaryText">{date.format('YYYY-MM-DD HH:mm:SS')} (UTC)</div>
      </div>;
    }
  },
  {
    column: 'collection', title: 'Collection', render: (t) => {
      return t.collection;
    }
  },
  {
    column: 'action', title: 'Action', render: (t) => {
      return <>
        <Button className="underlined pl-0" icon={<RedoOutlined />} type="link">Run Once Again</Button>
      </>;
    }
  }
]

function taskToRow(t: Task): TableRow {
  return {
    key: t.id,
    status: t.status,
    date: {
      started: new Date(t.created_at)
    },
    collection: t.collection,
    logs: {
      taskId: t.id
    }
  }
}

function toAntColumn(c: ColumnData, props: TasksTableProps) {
  return {
    dataIndex: c.column,
    key: c.column,
    title: c.title,
    render: c.render ? (text, record) => { return c.render(record, props) } : undefined
  }
}

function comparator<T>(f: (t:T) => any): ((a1: T, a2: T) => number) {
  return (a1: T, a2) => {
    let v1 = f(a1);
    let v2 = f(a2);
    if (v1 > v2) {
      return -1
    } else if (v1 < v2) {
      return 1;
    }
    return 0;
  }
}

