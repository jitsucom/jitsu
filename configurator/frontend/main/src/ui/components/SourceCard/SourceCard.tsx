import { SourceConnector } from "@jitsu/catalog/sources/types"
import { allSources } from "@jitsu/catalog/sources/lib"
import snakeCase from "lodash/snakeCase"
import EditOutlined from "@ant-design/icons/lib/icons/EditOutlined"
import DeleteOutlined from "@ant-design/icons/lib/icons/DeleteOutlined"
import { Badge, Menu, Modal, Skeleton, Tag, Tooltip } from "antd"
import SubMenu from "antd/lib/menu/SubMenu"
import CodeOutlined from "@ant-design/icons/lib/icons/CodeOutlined"
import SyncOutlined from "@ant-design/icons/lib/icons/SyncOutlined"
import ClearOutlined from "@ant-design/icons/lib/icons/ClearOutlined"
import { useHistory, NavLink } from "react-router-dom"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { sourcesStore } from "../../../stores/sources"
import ExclamationCircleOutlined from "@ant-design/icons/lib/icons/ExclamationCircleOutlined"
import { handleError, withProgressBar } from "../../../lib/components/components"
import { useServices } from "../../../hooks/useServices"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { Task, TaskId } from "../../pages/TaskLogs/utils"
import moment from "moment"
import { comparator } from "../../../lib/commons/utils"
import { ConnectionCard } from "../ConnectionCard/ConnectionCard"
import { flowResult } from "mobx"
import { actionNotification } from "../ActionNotification/ActionNotification"
import { SourcesUtils } from "../../../utils/sources.utils"
import { isAtLeastOneStreamSelected } from "utils/sources/sourcesUtils"
import { NoStreamsSelectedMessage } from "../NoStreamsSelectedMessage/NoStreamsSelectedMessage"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { connectionsHelper } from "stores/helpers"
import { sourceEditorUtils } from "ui/pages/SourcesPage/partials/SourceEditor/SourceEditor/SourceEditor.utils"

const allSourcesMap: { [key: string]: SourceConnector } = allSources.reduce(
  (accumulator, current) => ({
    ...accumulator,
    [snakeCase(current.id)]: current,
  }),
  {}
)
export type SourceCardProps = {
  //Source we display
  src: SourceData

  //if true, we won't pull latest task data.
  short?: boolean
}

export function SourceCard({ src, short = false }: SourceCardProps) {
  const reference: SourceConnector = allSourcesMap[src.sourceProtoType]

  if (!reference) {
    return null
  }

  const history = useHistory()
  const services = useServices()
  const editLink = projectRoute(sourcesPageRoutes.editExact, {
    projectId: services.activeProject.id,
    sourceId: src.sourceId,
  })
  const viewLogsLink = projectRoute(sourcesPageRoutes.logs, { sourceId: src.sourceId })

  const rename = async (sourceId: string, newName: string) => {
    await flowResult(sourcesStore.patch(sourceId, { displayName: newName }))
  }

  const scheduleTasks = async (src: SourceData, full = false) => {
    if (!isAtLeastOneStreamSelected(src)) {
      actionNotification.error(<NoStreamsSelectedMessage editSourceLink={editLink} />)
      return
    }
    await withProgressBar({
      estimatedMs: 200,
      maxRetries: 2,
      retryDelayMs: 2000,
      callback: async () => {
        if (full) {
          await services.backendApiClient.post(
            "/sources/clear_cache",
            {
              source: `${services.activeProject.id}.${src.sourceId}`,
              project_id: services.activeProject.id,
            },
            { proxy: true, urlParams: { delete_warehouse_data: true } }
          )
        }

        if (sourceEditorUtils.isNativeOrSDKSource(src) && src.collections.length > 0) {
          await Promise.all(
            src.collections.map(stream =>
              services.backendApiClient.post("/tasks", undefined, {
                proxy: true,
                urlParams: {
                  source: `${services.activeProject.id}.${src.sourceId}`,
                  collection: stream.name,
                  project_id: services.activeProject.id,
                },
              })
            )
          )
        } else {
          //workaround for singer and airbyte, it doesn't have collections, so we should pass
          //any value
          await services.backendApiClient.post("/tasks", undefined, {
            proxy: true,
            urlParams: {
              source: `${services.activeProject.id}.${src.sourceId}`,
              collection: "bogus",
              project_id: services.activeProject.id,
            },
          })
        }
        history.push(projectRoute(sourcesPageRoutes.logs, { sourceId: src.sourceId }))
      },
    })
  }

  const deleteSrc = (src: SourceData) => {
    Modal.confirm({
      title: "Confirm to delete",
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to delete ${src.displayName} source?  This action cannot be undone.`,
      okText: "Confirm",
      cancelText: "Cancel",
      onCancel: () => {},
      onOk: async () => {
        try {
          await sourcesStore.delete(src.sourceId)
          await connectionsHelper.unconnectDeletedSource(src.sourceId)
          actionNotification.success("Sources list successfully updated")
        } catch (error) {
          handleError(error, "Unable to delete source at this moment, please try later.")
        }
      },
    })
  }

  let connectionStatus = (
    <Tooltip
      trigger={"hover"}
      overlay={
        src.connected ? (
          <>Jitsu successfully connected to {reference.displayName}</>
        ) : (
          <>
            Connection to {reference.displayName} failed: {src.connectedErrorMessage}
          </>
        )
      }
    >
      <Badge
        size="default"
        status={src.connected ? "success" : "error"}
        text={
          short && (
            <span className={`text-${src.connected ? "success" : "error"}`}>
              {src.connected ? "Active" : "Connection test failed"}
            </span>
          )
        }
      />
    </Tooltip>
  )

  return (
    <ConnectionCard
      icon={reference.pic}
      deleteAction={() => deleteSrc(src)}
      editAction={editLink}
      menuOverlay={
        <Menu>
          <Menu.Item icon={<EditOutlined />}>
            <NavLink to={editLink}>Edit</NavLink>
          </Menu.Item>
          <Menu.Item icon={<DeleteOutlined />} onClick={() => deleteSrc(src)}>
            Delete
          </Menu.Item>
          <Menu.Item icon={<CodeOutlined />}>
            <NavLink to={viewLogsLink}>View Logs</NavLink>
          </Menu.Item>
          <Menu.Item icon={<ClearOutlined />} onClick={async () => await scheduleTasks(src, true)}>
            Clear Destinations and Sync
          </Menu.Item>
          <Menu.Item icon={<SyncOutlined />} onClick={async () => await scheduleTasks(src, false)}>
            Sync Now
          </Menu.Item>
        </Menu>
      }
      title={SourcesUtils.getDisplayName(src)}
      rename={(newName: string) => rename(src.sourceId, newName)}
      subtitle={
        <>
          <span className="inline-block mr-1">{reference.displayName}</span>
          {!short && connectionStatus}
        </>
      }
      status={short ? connectionStatus : <LastTaskStatus sourceId={src.sourceId} />}
    />
  )
}

function LastTaskStatus({ sourceId }) {
  const services = useServices()
  const {
    error,
    data: task,
    isLoading,
  } = useLoaderAsObject(async () => {
    let tasks = await services.backendApiClient.get("/tasks", {
      proxy: true,
      urlParams: {
        project_id: services.activeProject.id,
        source: `${services.activeProject.id}.${sourceId}`,
        end: new Date().toISOString(),
        start: moment().subtract(90, "days").toISOString(),
        limit: 100,
      },
    })
    const tasksSorted = tasks.tasks.sort(comparator<Task>(t => new Date(t.finished_at)))
    return tasksSorted?.[0]
  })

  if (isLoading) {
    return <Skeleton active title={false} paragraph={{ rows: 1, width: ["100%"] }} className="w-full" />
  }
  //workaround: "doesn't exist" really means no tasks
  if (!task?.status && (error?.message || "").indexOf("doesn't exist")) {
    return (
      <Tooltip overlay={<>This connector hasn't been started yet</>}>
        <Tag color="default">NO RUNS</Tag>
      </Tooltip>
    )
  }
  if (error) {
    return <Tag color="error">ERROR !</Tag>
  }
  const date = task.finished_at ? moment.utc(task.finished_at) : null
  const now = moment.utc(new Date().toISOString())

  return (
    <span>
      <NavLink
        to={projectRoute(sourcesPageRoutes.task, {
          sourceId: sourceId,
          taskId: TaskId.encode(task.id),
        })}
      >
        <Tag color={task.status === "SUCCESS" ? "success" : "error"}>{task.status.toUpperCase()}</Tag>
        <a className="text-xs text-secondaryText underline">{date?.from(now)}</a>
      </NavLink>
    </span>
  )
}

// return <div>
//   <Tag color="error">ERROR</Tag>
//   <div className="text-secondaryText text-xs flex-shrink underline">2 mins ago</div>
// </div>
//
// }
