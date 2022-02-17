import { Button, Tag } from "antd"
import ArrowLeftOutlined from "@ant-design/icons/lib/icons/ArrowLeftOutlined"
import { generatePath, NavLink, useHistory, useParams } from "react-router-dom"
import { CenteredError, CenteredSpin, handleError } from "lib/components/components"
import { Task, TaskId, TaskLogEntry } from "./utils"
import { useLoader } from "hooks/useLoader"
import { useServices } from "hooks/useServices"
import { CollectionSourceData } from "ui/pages/SourcesPage/SourcesPage"
import React, { useEffect, useRef, useState } from "react"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { allSources } from "@jitsu/catalog/sources/lib"
import { SourceConnector } from "@jitsu/catalog/sources/types"
import snakeCase from "lodash/snakeCase"
import { taskLogsPageRoute } from "ui/pages/TaskLogs/TaskLogsPage"
import styles from "./TaskLogsPage.module.less"
import classNames from "classnames"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import moment from "moment"
import ReloadOutlined from "@ant-design/icons/lib/icons/ReloadOutlined"
import { actionNotification } from "../../components/ActionNotification/ActionNotification"
import { currentPageHeaderStore } from "../../../stores/currentPageHeader"
import { projectRoute } from "../../../lib/components/ProjectLink/ProjectLink"

export const taskLogsViewerRoute = "/prj-:projectId/sources/logs/:sourceId/:taskId"
type TaskInfo = {
  task: Task
  source: SourceData
}
export const TaskLogViewer: React.FC = () => {
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

  const [taskLogsError, taskLogs, setTaskLogs] = useLoader<TaskLogEntry[]>(async () => {
    return await fetchLogs()
  })
  const [error, taskInfo] = useLoader<TaskInfo>(async () => {
    const data: CollectionSourceData = await services.storageService.get("sources", services.activeProject.id)
    if (!data.sources) {
      throw new Error(`Invalid response of "sources" collection: ${JSON.stringify(data)}`)
    }
    const source = data.sources.find((source: SourceData) => source.sourceId === sourceId)
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
              link: projectRoute(taskLogsPageRoute, { sourceId }),
            },
            { title: "Task Log" },
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
            onClick={() => history.push(projectRoute(taskLogsPageRoute, { sourceId }))}
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
                <span className={classNames(styles["logEntry_" + l.level], styles.logEntry)}>
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
