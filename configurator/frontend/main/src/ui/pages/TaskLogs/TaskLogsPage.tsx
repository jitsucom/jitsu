import { useHistory, useLocation, useParams } from "react-router-dom"
import React, { useEffect, useState } from "react"
import { CenteredSpin } from "lib/components/components"
import { DatePicker, Select, Tag } from "antd"
import { TasksTable } from "ui/pages/TaskLogs/TasksTable"
import { useServices } from "hooks/useServices"
import { colorMap, TaskStatus } from "./utils"
import styles from "./TaskLogsPage.module.less"
import moment from "moment"
import { allSources } from "@jitsu/catalog"
import snakeCase from "lodash/snakeCase"
import { SourceConnector } from "@jitsu/catalog"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { currentPageHeaderStore } from "../../../stores/currentPageHeader"
import { projectRoute } from "../../../lib/components/ProjectLink/ProjectLink"
import { sourcesStore } from "stores/sources"
import { observer } from "mobx-react-lite"

const TaskLogsPageComponent: React.FC = () => {
  const params = useParams<{ sourceId: string; taskId: string }>()
  const services = useServices()
  const location = useLocation()
  const history = useHistory()
  const queryRaw = location.search
  const query = new URLSearchParams(queryRaw)
  const [filterStatus, setFilterStatus] = useState<TaskStatus>((query.get("status") as TaskStatus) || undefined)
  const [filterCollection, setFilterCollection] = useState<string>(query.get("collection") || undefined)
  const [filterStart, setFilterStart] = useState(
    query.get("start") ? moment.utc(query.get("start")) : moment.utc().subtract(1, "days").startOf("day")
  )
  const [filterEnd, setFilterEnd] = useState(
    query.get("end") ? moment.utc(query.get("end")) : moment.utc().endOf("day")
  )
  const source = sourcesStore.get(params.sourceId)

  useEffect(() => {
    if (source) {
      const connectorSource = allSources.find(
        (candidate: SourceConnector) => snakeCase(candidate.id) === source?.sourceProtoType ?? ({} as SourceConnector)
      )

      currentPageHeaderStore.setBreadcrumbs(
        { title: "Sources", link: projectRoute(sourcesPageRoutes.root) },
        {
          title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode="edit" />,
          link: "/sources/edit/" + source.sourceId,
        },
        { title: "Logs" }
      )
    }
  }, [source?.sourceId])

  const setFilter = (param, val, stateAction, toString?: (any) => string) => {
    toString = toString || (val => val + "")
    if (val !== undefined) {
      query.set(param, toString(val))
    } else {
      query.delete(param)
    }
    let queryStr = query.toString()
    if (queryStr.length > 0) {
      queryStr = "?" + queryStr
    }
    history.push(`/prj-${services.activeProject.id}/sources/logs/${source.sourceId}${queryStr}`)
    stateAction(val)
  }

  if (!source) {
    return <CenteredSpin />
  }
  return (
    <>
      <div className="flex flex-row mb-4 space-x-2">
        <div>
          <span className={styles.filterLabel}>Status:</span>
          <span className={styles.filterEdit}>
            <Select
              className="w-full"
              defaultValue={query.get("status") || "ALL"}
              onChange={val => {
                setFilter("status", val === "ALL" ? undefined : (val as TaskStatus), setFilterStatus)
              }}
            >
              <Select.Option value="ALL">ALL</Select.Option>
              {Object.entries(colorMap).map(([status, color]) => (
                <Select.Option key={status} value={status}>
                  <Tag color={color}>{status}</Tag>
                </Select.Option>
              ))}
            </Select>
          </span>
        </div>
        <div>
          <span className={styles.filterLabel}>Collection:</span>
          <span className={styles.filterEdit}>
            <Select
              className="w-full"
              defaultValue={query.get("collection") || "ALL"}
              onChange={val => {
                setFilter("collection", val === "ALL" ? undefined : val, setFilterCollection)
              }}
            >
              <Select.Option value="ALL">ALL</Select.Option>
              {(source["collections"] ?? []).map(({ name }) => (
                <Select.Option key={name} value={name}>
                  {name}
                </Select.Option>
              ))}
            </Select>
          </span>
        </div>
        <div>
          <span className={styles.filterLabel}>From: </span>
          <span className={styles.filterEdit}>
            <DatePicker
              className="w-full"
              allowClear={false}
              onChange={val => {
                setFilter("start", val.startOf("day"), setFilterStart, d => d.toISOString())
              }}
              defaultValue={filterStart}
            />
          </span>
        </div>
        <div>
          <span className={styles.filterLabel}>To: </span>
          <span className={styles.filterEdit}>
            <DatePicker
              className="w-full"
              allowClear={false}
              onChange={val => {
                setFilter("end", val.endOf("day"), setFilterEnd, d => d.toISOString())
              }}
              defaultValue={filterEnd}
            />
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
      />
    </>
  )
}

const TaskLogsPage = observer(TaskLogsPageComponent)

TaskLogsPage.displayName = "TaskLogsPage"

export { TaskLogsPage }
