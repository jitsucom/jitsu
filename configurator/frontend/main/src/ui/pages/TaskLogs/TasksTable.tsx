import { generatePath, NavLink } from "react-router-dom"
import React, { ReactNode, useState } from "react"
import { CenteredError, CenteredSpin, withProgressBar } from "lib/components/components"
import { Button, Dropdown, Menu, Table, Tag } from "antd"
import RedoOutlined from "@ant-design/icons/lib/icons/RedoOutlined"
import CloseCircleOutlined from "@ant-design/icons/lib/icons/CloseCircleOutlined"
import moment, { Moment } from "moment"
import { colorMap, Task, TaskId, TaskStatus } from "ui/pages/TaskLogs/utils"
import useLoader from "hooks/useLoader"
import { useServices } from "hooks/useServices"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { comparator } from "../../../lib/commons/utils"
import { isAtLeastOneStreamSelected } from "utils/sources/sourcesUtils"
import { NoStreamsSelectedMessage } from "ui/components/NoStreamsSelectedMessage/NoStreamsSelectedMessage"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { projectRoute } from "../../../lib/components/ProjectLink/ProjectLink"

export type TasksTableProps = {
  source: SourceData
  projectId: string
  start: Moment
  end: Moment
  status?: TaskStatus
  collection?: string
}
export const TasksTable: React.FC<TasksTableProps> = props => {
  const appServices = useServices()
  const editSourceLink = generatePath(sourcesPageRoutes.editExact, {
    projectId: appServices.activeProject.id,
    sourceId: props.source.sourceId,
  })

  const [taskRuns, setTaskRuns] = useState(0) //to trigger reload on manual task run
  const [loadingError, tasksSorted] = useLoader<Task[]>(async () => {
    const tasks = await appServices.backendApiClient.get("/tasks", {
      proxy: true,
      urlParams: {
        project_id: props.projectId,
        source: `${props.projectId}.${props.source.sourceId}`,
        start: props.start.toISOString(),
        end: props.end.toISOString(),
        collection: props.collection || undefined,
        status: props.status || undefined,
      },
    })
    return tasks.tasks.sort(comparator<Task>(t => new Date(t.created_at)))
  }, [props.projectId, props.start, props.end, props.collection, props.status, taskRuns])

  const runTask = (source: string, collection: string) => {
    return async () => {
      if (!isAtLeastOneStreamSelected(props.source)) {
        actionNotification.error(<NoStreamsSelectedMessage editSourceLink={editSourceLink} />)
        return
      }
      return await withProgressBar({
        estimatedMs: 100,
        callback: async () => {
          await appServices.backendApiClient.post("/tasks", undefined, {
            proxy: true,
            urlParams: {
              source,
              collection,
              project_id: props.projectId,
            },
          })
          setTaskRuns(taskRuns + 1)
        },
      })
    }
  }

  const cancelTask = (taskId: string) => {
    return async () => {
      return await withProgressBar({
        estimatedMs: 1000,
        callback: async () => {
          await appServices.backendApiClient.post(
            `/tasks/${taskId}/cancel`,
            {},
            { proxy: true, urlParams: { project_id: props.projectId } }
          )
          setTaskRuns(taskRuns + 1)
        },
      })
    }
  }
  if (!props.source?.destinations || props.source.destinations.length === 0) {
    return (
      <div className="text-center text-secondaryText pt-8">
        No destinations is configured for this source. Synchronization tasks will not run. Configure destinations on{" "}
        <NavLink
          to={generatePath(sourcesPageRoutes.editExact, {
            projectId: appServices.activeProject.id,
            sourceId: props.source.sourceId,
          })}
        >
          Linked Destinations tab
        </NavLink>
      </div>
    )
  }

  if (loadingError) {
    return <CenteredError error={loadingError} />
  } else if (!tasksSorted) {
    return <CenteredSpin />
  }
  return (
    <Table
      dataSource={tasksSorted.map(t =>
        taskToRow(t, runTask(`${props.projectId}.${props.source.sourceId}`, t.collection), cancelTask(t.id))
      )}
      columns={columns.map(c => toAntColumn(c, props))}
    />
  )
}

type TableRow = {
  runTask: () => Promise<void>
  cancelTask: () => Promise<void>
  key: string
  status: TaskStatus
  date: {
    started?: Date
    finished?: Date
  }
  collection: string
  logs: {
    taskId: string
  }
}

type ColumnData = {
  column: string
  title: string
  render?: (row: TableRow, props: TasksTableProps) => ReactNode
}

const columns: ColumnData[] = [
  {
    column: "status",
    title: "Status",
    render: t => {
      return (
        <div className="flex flex-col justify-between">
          <div>
            <Tag color={colorMap[t.status]}>{t.status}</Tag>
          </div>
        </div>
      )
    },
  },
  {
    column: "date",
    title: "Started",
    render: (t, props) => {
      const date = t.date ? moment.utc(t.date.started.toISOString()) : null
      const now = moment.utc(new Date().toISOString())
      return (
        <div>
          <div>
            {date ? date.from(now) : "Not started"}
            {" • "}
            <NavLink
              className="border-b border-dashed"
              to={projectRoute(sourcesPageRoutes.task, {
                sourceId: props.source.sourceId,
                taskId: TaskId.encode(t.logs.taskId),
              })}
            >
              View logs
            </NavLink>
          </div>
          <div className="text-xs text-secondaryText">{date.format("YYYY-MM-DD HH:mm:ss")} (UTC)</div>
        </div>
      )
    },
  },
  {
    column: "duration",
    title: "Duration",
    render: (t, props) => {
      if (t.date?.started && t.date?.finished) {
        const diff = moment(t.date?.finished).diff(moment(t.date?.started))
        const duration = moment.duration(diff);
        let format = `${duration.minutes()}m ${duration.seconds()}s`;
        if (duration.hours() > 0 || duration.days() > 0) {
          format = `${duration.hours()}h ` + format;
        }
        if (duration.days() > 0) {
            format = `${duration.days()}d ` + format;
        }
        return format;
      } else {
        return " n/a "
      }
    },
  },
  {
    column: "collection",
    title: "Collection",
    render: t => {
      return t.collection
    },
  },
  {
    column: "action",
    title: "Action",
    render: t => {
      return (
        <Dropdown
          overlay={
            <Menu>
              <Menu.Item icon={<RedoOutlined />} onClick={async () => await t.runTask()}>
                Run Once Again
              </Menu.Item>
              {(t.status === "RUNNING" || t.status === "SCHEDULED") && (
                <Menu.Item
                  icon={<CloseCircleOutlined />}
                  onClick={async () => {
                    await t.cancelTask()
                  }}
                >
                  Cancel
                </Menu.Item>
              )}
            </Menu>
          }
        >
          <div className="flex">
            <div className="text-xl px-4 py-1 cursor-pointer hover:bg-bgComponent flex-shrink rounded-full">⋮</div>
          </div>
        </Dropdown>
      )
    },
  },
]

function taskToRow(t: Task, runTask: () => Promise<void>, cancelTask: () => Promise<void>): TableRow {
  return {
    runTask,
    cancelTask,
    key: t.id,
    status: t.status,
    date: {
      started: t.created_at ? new Date(t.created_at) : undefined,
      finished: t.finished_at ? new Date(t.finished_at) : undefined,
    },
    collection: t.collection,
    logs: {
      taskId: t.id,
    },
  }
}

function toAntColumn(c: ColumnData, props: TasksTableProps) {
  return {
    dataIndex: c.column,
    key: c.column,
    title: c.title,
    render: c.render
      ? (text, record) => {
          return c.render(record, props)
        }
      : undefined,
  }
}
