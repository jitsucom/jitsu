// @Libs
import moment from "moment"
import { Button, Tag } from "antd"
import classNames from "classnames"
import snakeCase from "lodash/snakeCase"
import { observer } from "mobx-react-lite"
import React, { useEffect, useRef, useState } from "react"
import { useHistory, useParams } from "react-router-dom"
// @Hooks
import { useServices } from "hooks/useServices"
import { useLoaderAsObject } from "hooks/useLoader"
// @Components
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { CenteredError, CenteredSpin, handleError } from "lib/components/components"
// @Icons
import ArrowLeftOutlined from "@ant-design/icons/lib/icons/ArrowLeftOutlined"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
// @Lib
import { allSources } from "@jitsu/catalog"
// @Routes
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
// @Utils
import { Task, TaskId, TaskLogEntry } from "./utils"
// @Types
import type { SourceConnector } from "@jitsu/catalog"
// @Styles
import styles from "./TaskLogsPage.module.less"
import { sourcesStore } from "stores/sources"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { currentPageHeaderStore } from "stores/currentPageHeader"

type TaskInfo = {
  task: Task
  source: SourceData
}

const TaskLogViewerComponent: React.FC = () => {
  let { sourceId, taskId } = useParams<{ sourceId: string; taskId: string }>()
  taskId = TaskId.decode(taskId)
  const services = useServices()
  const [filter, setFilter] = useState("all")
  const history = useHistory()
  const viewerRef = useRef(null)
  const [logsReloading, setLogsReloading] = useState(false)

  async function fetchLogs(): Promise<TaskLogEntry[]> {
    return (
      await services.backendApiClient.get(
        `/tasks/${encodeURIComponent(taskId)}/logs?project_id=${services.activeProject.id}`,
        { proxy: true }
      )
    )["logs"]
  }

  const {
    error: taskLogsError,
    data: taskLogs,
    setData: setTaskLogs,
  } = useLoaderAsObject<TaskLogEntry[]>(async () => {
    return await fetchLogs()
  })

  const { error, data: taskInfo } = useLoaderAsObject<TaskInfo>(async () => {
    const source = sourcesStore.get(sourceId)
    if (!source) throw new Error(`Source with ID ${sourceId} not found.`)

    const task = await services.backendApiClient.get(
      `/tasks/${encodeURIComponent(taskId)}?project_id=${services.activeProject.id}`,
      { proxy: true }
    )
    return { task, source }
  })

  useEffect(() => {
    if (taskInfo) {
      const connectorSource = allSources.find(
        (candidate: SourceConnector) =>
          snakeCase(candidate.id) === taskInfo.source?.sourceProtoType ?? ({} as SourceConnector)
      )
      currentPageHeaderStore.setBreadcrumbs(
        { title: "Sources", link: sourcesPageRoutes.root },
        {
          title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode="edit" />,
          link: projectRoute(sourcesPageRoutes.editExact, { sourceId }),
        },
        {
          title: "Logs",
          link: projectRoute(sourcesPageRoutes.logs, { sourceId }),
        },
        { title: "Task Log" }
      )
    }
  }, [sourceId, taskId, taskInfo])

  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.scrollTo(0, viewerRef.current.scrollHeight, { behavior: "smooth" })
    }
  })

  if (error) {
    return <CenteredError error={error} />
  } else if (!taskInfo) {
    return <CenteredSpin />
  }

  return (
    <div>
      <div className="flex justify-between items-center ">
        <div className="flex justify-start items-center">
          <Button
            type="primary"
            icon={<ArrowLeftOutlined />}
            onClick={() => history.push(projectRoute(sourcesPageRoutes.logs, { sourceId }))}
          >
            Back to task list
          </Button>
          <div className="pl-4 align-middle align-top">
            Show:{" "}
            <span>
              <Tag className="text-sm uppercase cursor-pointer w-24 text-center" onClick={() => setFilter("all")}>
                {filter === "all" && "✓"}All
              </Tag>
              <Tag
                color="error"
                className="text-sm uppercase cursor-pointer w-24 text-center"
                onClick={() => setFilter("errors")}
              >
                {filter !== "all" && "✓"}Errors
              </Tag>
            </span>
          </div>
        </div>
        <Button
          type="primary"
          className="mb-4"
          icon={<ReloadOutlined />}
          loading={logsReloading}
          onClick={async () => {
            setLogsReloading(true)
            try {
              setTaskLogs(await fetchLogs())
            } catch (e) {
              handleError(e, "Failed to reload logs")
            } finally {
              setLogsReloading(false)
            }
          }}
        >
          Reload
        </Button>
      </div>
      <div className={classNames(styles.logViewerWrapper, "custom-scrollbar")}>
        <pre ref={viewerRef} className={classNames(styles.logViewer, "custom-scrollbar", "text-xs")}>
          {taskLogsError && "Failed to load logs: " + taskLogsError.message}
          {!taskLogs && "Loading logs..."}
          {taskLogs &&
            taskLogs
              .filter(l => filter === "all" || (filter === "errors" && l.level === "error"))
              .map(l => (
                <span key={l.time + l.level} className={classNames(styles["logEntry_" + l.level], styles.logEntry)}>
                  <span className={styles.logTime}>{moment.utc(l.time).format("YYYY-MM-DD HH:mm:ss")}</span>
                  <span className={styles.logLevel}> [{l.level.toUpperCase().padEnd(5)}]</span> -{" "}
                  <span className={styles.logMessage}>{l.message.replace(`[${taskId}] `, "")}</span>
                  {"\n"}
                </span>
              ))}
        </pre>
      </div>
    </div>
  )
}

const TaskLogViewer = observer(TaskLogViewerComponent)

TaskLogViewer.displayName = "TaskLogViewer"

export { TaskLogViewer }
