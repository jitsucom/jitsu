// @Libs
import React, { useMemo, useState } from "react"
import { useHistory, useLocation } from "react-router-dom"
import { Button, Card, Col, Tooltip, Row } from "antd"
// @Components
import { CodeInline } from "lib/components/components"
import { StatisticsChart } from "ui/components/StatisticsChart/StatisticsChart"
// @Icons
import {
  ReloadOutlined,
  QuestionCircleOutlined,
  ThunderboltFilled,
  EditOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons"
// @Services
import { addSeconds, StatisticsService } from "lib/services/stat"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { useServices } from "../../../hooks/useServices"
import { SelectFilter } from "../Filters/SelectFilter"
import {
  FilterOption,
  getAllApiKeysAsOptions,
  getAllDestinationsAsOptions,
  getAllSourcesAsOptions,
} from "../Filters/shared"
import ProjectLink, { projectRoute } from "../ProjectLink/ProjectLink"
import { withQueryParams } from "utils/queryParams"

type DataType = "total" | "success" | "skip" | "errors"

type Props =
  | {
      entityType: "api_key" | "destination"
      entityId: string
      editEntityRoute: string
      entitiesListRoute: string
    }
  | {
      entityType?: never
      entityId?: never
      editEntityRoute?: never
      entitiesListRoute?: never
    }

/**
 * Displays statistics for all entities - sources, API keys, destinations - if no props passed or
 * displays statistics and specific controls for the entity specified using the props
 */
export const StatusPage: React.FC<Props> = ({ entityType, entityId, editEntityRoute, entitiesListRoute }) => {
  const isGeneralStatsPage: boolean = !entityType
  const entityDisplayName: string | null = isGeneralStatsPage
    ? null
    : entityType === "destination"
    ? "Destination"
    : "API Key"
  const services = useServices()
  const history = useHistory()
  const location = useLocation()
  const params = new URLSearchParams(
    isGeneralStatsPage
      ? location.search
      : entityType === "destination"
      ? { destination_push: entityId, destination_pull: entityId }
      : { source_push: entityId }
  )
  const [period, setPeriod] = useState(params.get("period") || "month")
  const [reloadCount, setReloadCount] = useState(0)
  const stats = new StatisticsService(services.backendApiClient, services.activeProject.id, true)
  const isSelfHosted = services.features.environment !== "jitsu_cloud"
  const now = new Date()
  const periodMap = {
    month: addSeconds(now, -30 * 24 * 60 * 60),
    week: addSeconds(now, -7 * 24 * 60 * 60),
    day: addSeconds(now, -24 * 60 * 60),
  }

  const periods = [
    { label: "Last 30 days", value: "month" },
    { label: "Last 7 days", value: "week" },
    { label: "Last 24 hours", value: "day" },
  ]

  const liveEventsUrlParams = useMemo(() => {
    const apiKey = params.get("source_push")
    if (apiKey && apiKey !== "all") return { type: "token", id: apiKey }
    const destination = params.get("destination_push")
    if (destination && destination !== "all") return { type: "destination", id: destination }
    return {}
  }, [params])

  const destinationsOptions = getAllDestinationsAsOptions(true)
  const apiKeysOptions = getAllApiKeysAsOptions(true)
  const sourcesOptions = getAllSourcesAsOptions(true)

  const handlePeriodSelect = value => {
    const newPeriod = value.value
    setPeriod(newPeriod)
    setReloadCount(reloadCount + 1)
    const queryParams = new URLSearchParams(window.location.search)
    queryParams.set("period", newPeriod)
    history.replace({ search: queryParams.toString() })
  }

  return (
    <>
      <div className="flex flex-row space-x-2 justify-between items-center mb-4">
        <div className="flex-col">
          <SelectFilter label="Period" onChange={handlePeriodSelect} options={periods} initialValue={period} />
        </div>
        <div className="flex-col">
          <ProjectLink to={withQueryParams("/events_stream", liveEventsUrlParams)} className="inline-block mr-5">
            <Button type="ghost" size="large" icon={<ThunderboltFilled />} className="w-full mb-2">
              Live Events
            </Button>
          </ProjectLink>
          {!isGeneralStatsPage && !!entityDisplayName && !!entitiesListRoute && !!editEntityRoute && !!entityId && (
            <>
              <Button
                type="ghost"
                size="large"
                className="mr-5"
                icon={<EditOutlined />}
                onClick={() =>
                  history.push(
                    projectRoute(editEntityRoute, {
                      id: entityId,
                    })
                  )
                }
              >
                {`Edit ${entityDisplayName}`}
              </Button>
              <Button
                type="ghost"
                size="large"
                className="mr-5"
                icon={<UnorderedListOutlined />}
                onClick={() => history.push(projectRoute(entitiesListRoute))}
              >
                {`${entityDisplayName}s List`}
              </Button>
            </>
          )}
          <Button
            size="large"
            icon={<ReloadOutlined />}
            onClick={() => {
              setReloadCount(reloadCount + 1)
            }}
          >
            Reload
          </Button>
        </div>
      </div>

      {isSelfHosted && isGeneralStatsPage && (
        <Row>
          <span className={`text-secondaryText mb-4`}>
            Jitsu 1.37 brought an update that enables for serving more fine-grained statistics data. The new charts will
            not show the events processed by the previous versions of Jitsu.
          </span>
        </Row>
      )}
      <Row gutter={16} className="status-page-cards-row mb-4">
        {(isGeneralStatsPage || entityType === "api_key") && (
          <Col span={isGeneralStatsPage ? 12 : 24}>
            <StatusChart
              title={
                <span>
                  Incoming{" "}
                  <ProjectLink to="/api_keys" stripLink={!isGeneralStatsPage}>
                    events
                  </ProjectLink>
                </span>
              }
              stats={stats}
              period={periodMap[period]}
              namespace="source"
              type="push"
              granularity={period === "day" ? "hour" : "day"}
              dataToDisplay={["success", "skip", "errors"]}
              legendLabels={{ skip: "skip (no dst.)" }}
              filterOptions={apiKeysOptions}
              reloadCount={reloadCount}
              hideFilter={!isGeneralStatsPage}
              params={params}
            />
          </Col>
        )}
        {(isGeneralStatsPage || entityType === "destination") && (
          <Col span={isGeneralStatsPage ? 12 : 24}>
            <StatusChart
              title={
                <span>
                  Processed{" "}
                  <ProjectLink to="/destinations" stripLink={!isGeneralStatsPage}>
                    events
                  </ProjectLink>
                </span>
              }
              stats={stats}
              period={periodMap[period]}
              namespace="destination"
              type="push"
              granularity={period === "day" ? "hour" : "day"}
              dataToDisplay={["success", "skip", "errors"]}
              filterOptions={destinationsOptions}
              reloadCount={reloadCount}
              hideFilter={!isGeneralStatsPage}
              params={params}
            />
          </Col>
        )}
      </Row>
      {(isGeneralStatsPage || entityType === "destination") && (
        <Row>
          <Col span={24}>
            <StatusChart
              title={<span>Rows synchronized from sources</span>}
              stats={stats}
              period={periodMap[period]}
              namespace={entityType === "destination" ? "destination" : "source"}
              type="pull"
              granularity={period === "day" ? "hour" : "day"}
              dataToDisplay={["success", "skip", "errors"]}
              filterOptions={entityType === "destination" ? destinationsOptions : sourcesOptions}
              reloadCount={reloadCount}
              extra={SyncEventsDocsTooltip}
              hideFilter={!isGeneralStatsPage}
              params={params}
            />
          </Col>
        </Row>
      )}
    </>
  )
}

const StatusChart: React.FC<{
  title: React.ReactNode | string
  stats: StatisticsService
  period: Date
  namespace: "source" | "destination"
  type: "push" | "pull"
  granularity: "hour" | "day"
  dataToDisplay: DataType | DataType[]
  legendLabels?: { [key: string]: string }
  filterOptions: FilterOption[]
  reloadCount: number
  extra?: React.ReactNode
  hideFilter?: boolean
  params?: URLSearchParams
}> = ({
  title,
  stats,
  period,
  namespace,
  type,
  granularity,
  dataToDisplay,
  legendLabels,
  filterOptions,
  reloadCount,
  extra = null,
  hideFilter = false,
  params: _params,
}) => {
  const history = useHistory()
  const location = useLocation()
  const params = new URLSearchParams(_params ?? location.search)
  const idFilterKey = `${namespace}_${type}`
  const [idFilter, setIdFilter] = useState(params.get(idFilterKey) || filterOptions[0]?.value)

  const {
    error,
    data,
    isLoading: loading,
  } = useLoaderAsObject(async () => {
    return namespace === "source"
      ? await stats.getCombinedStatisticsBySources(period, new Date(), granularity, type, idFilter)
      : await stats.getCombinedStatisticsByDestinations(period, new Date(), granularity, type, idFilter)
  }, [idFilter, reloadCount])

  const handleFilterSelect = value => {
    setIdFilter(value.value)
    const queryParams = new URLSearchParams(window.location.search)
    queryParams.set(idFilterKey, value.value)
    history.replace({ search: queryParams.toString() })
  }

  return (
    <Card
      title={
        <span>
          {title}
          {!hideFilter && (
            <SelectFilter
              className="inline-block ml-5"
              onChange={handleFilterSelect}
              options={filterOptions}
              initialValue={idFilter}
            />
          )}
        </span>
      }
      bordered={false}
      loading={loading}
      className="mb-5 h-full"
      extra={extra}
    >
      {error ? (
        <StatisticsError />
      ) : (
        <StatisticsChart
          data={data || []}
          granularity={granularity}
          dataToDisplay={dataToDisplay}
          legendLabels={legendLabels}
        />
      )}
    </Card>
  )
}

const StatisticsError = () => {
  return (
    <div>
      <h3>Chart cannot be displayed</h3>
      Connection to Jitsu server cannot be established. That's not a critical error, you still will be able to configure
      Jitsu. However, statistic and monitoring for Jitsu Nodes won't be available. To fix that:
      <ul className="mt-5">
        <li>
          Make sure that <CodeInline>jitsu.base_url</CodeInline> property is set in Jitsu Configurator yaml file
        </li>
        <li>
          If <CodeInline>jitsu.base_url</CodeInline> is set, make sure that this URL is accessible (not blocked by
          firewall) from Jitsu Configurator
        </li>
      </ul>
    </div>
  )
}

const SyncEventsDocsTooltip: React.FC = ({ children }) => {
  const content = (
    <div className="max-w-xs">
      <p>
        Events sent from sources may be multiplexed in order to be sent to different destinations. Therefore, total
        amount of destinations events is greater or equal to the total amount of sources events
      </p>
    </div>
  )
  return (
    <span className="cursor-pointer status-page_info-popover">
      <Tooltip title={content}>{children ? children : <QuestionCircleOutlined />}</Tooltip>
    </span>
  )
}
