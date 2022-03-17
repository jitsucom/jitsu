// @Libs
import React, {useEffect, useState} from "react"
import {NavLink, useHistory, useLocation} from "react-router-dom"
import { Button, Card, Col, Tooltip, Row, Select } from "antd"
// @Components
import { CodeInline } from "lib/components/components"
import { StatisticsChart } from "ui/components/StatisticsChart/StatisticsChart"
// @Icons
import { ReloadOutlined, WarningOutlined, QuestionCircleOutlined, ThunderboltFilled } from "@ant-design/icons"
// @Services
import { addSeconds, StatisticsService } from "lib/services/stat"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { useServices } from "../../../hooks/useServices"
import styles from "../EventsStream/EventsSteam.module.less"
import { destinationsStore } from "../../../stores/destinations"
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
import { FilterOption } from "../EventsStream/shared"
import { apiKeysStore } from "../../../stores/apiKeys"
import { apiKeysReferenceMap } from "@jitsu/catalog/apiKeys/lib"
import {find, isNull, omitBy} from "lodash"
import { sourcesStore } from "../../../stores/sources"

const { Option } = Select

type DataType = "total" | "success" | "skip" | "errors"

export const StatusPage: React.FC<{}> = () => {
  const services = useServices()
  const [period, setPeriod] = useState("month")
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

  const destinationsOptions = destinationsStore.listIncludeHidden.map(d => {
    const icon = destinationsReferenceMap[d._type]?.ui.icon
    return { value: d._uid, label: d._id, icon } as FilterOption
  })
  const apiKeysOptions = apiKeysStore.list.map(key => {
    return { value: key.uid, label: key.comment ?? key.uid, icon: apiKeysReferenceMap.js.icon } as FilterOption
  })
  const sourcesOptions = sourcesStore.list.map(source => {
    return { value: source.sourceId, label: source.displayName ?? source.sourceId } as FilterOption
  })
  destinationsOptions.unshift({ label: "All destinations", value: "all" })
  apiKeysOptions.unshift({ label: "All API keys", value: "all" })
  sourcesOptions.unshift({ label: "All sources", value: "all" })

  return (
    <>
      <div className="flex flex-row space-x-2 justify-between items-center mb-4">
        <div className="flex-col">
          <Filter label="Period" onChange={value => setPeriod(value.value)} options={periods} />
        </div>
        <div className="flex-col">
          <NavLink to="/events_stream" className="inline-block mr-5">
            <Button type="ghost" size="large" icon={<ThunderboltFilled />} className="w-full mb-2">
              Live Events
            </Button>
          </NavLink>
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

      {isSelfHosted && (
        <Row>
          <span className={`text-secondaryText mb-4`}>
            Jitsu 1.37 brought an update that enables for serving more fine-grained statistics data. The new charts will
            not show the events processed by the previous versions of Jitsu.
          </span>
        </Row>
      )}
      <Row gutter={16} className="status-page-cards-row mb-4">
        <Col span={12}>
          <StatusChart
            title={<span>Incoming <NavLink to="/api_keys">events</NavLink></span>}
            stats={stats}
            period={periodMap[period]}
            namespace="source"
            type="push"
            granularity={period === "day" ? "hour" : "day"}
            dataToDisplay={["success", "errors"]}
            filterOptions={apiKeysOptions}
            reloadCount={reloadCount}
          />
        </Col>
        <Col span={12}>
          <StatusChart
            title={<span>Processed <NavLink to="/destinations">events</NavLink></span>}
            stats={stats}
            period={periodMap[period]}
            namespace="destination"
            type="push"
            granularity={period === "day" ? "hour" : "day"}
            dataToDisplay={["success", "skip", "errors"]}
            filterOptions={destinationsOptions}
            reloadCount={reloadCount}
          />
        </Col>
      </Row>
      <StatusChart
        title={<span>Rows synchronized from sources</span>}
        stats={stats}
        period={periodMap[period]}
        namespace="source"
        type="pull"
        granularity={period === "day" ? "hour" : "day"}
        dataToDisplay={["success", "skip", "errors"]}
        filterOptions={sourcesOptions}
        reloadCount={reloadCount}
        extra={SyncEventsDocsTooltip}
      />
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
  filterOptions: FilterOption[]
  reloadCount: number
  extra?: React.ReactNode
}> = ({ title, stats, period, namespace, type, granularity, dataToDisplay, filterOptions, reloadCount, extra = null }) => {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const history = useHistory()
  const [idFilter, setIdFilter] = useState(filterOptions[0].value)

  const {
    error,
    data,
    reloader: reload,
    isLoading: loading,
  } = useLoaderAsObject(async () => {
    return namespace === "source"
      ? await stats.getCombinedStatisticsBySources(period, new Date(), granularity, type, idFilter)
      : await stats.getCombinedStatisticsByDestinations(period, new Date(), granularity, type, idFilter)
  }, [period, idFilter, reloadCount])

  useEffect(() => {

  }, [idFilter])

  const handleFilterSelect = value => {
    setIdFilter(value.value)
    const queryParams = new URLSearchParams(window.location.search);
    queryParams.set(`${namespace}_${type}`, value.value)
    history.replace({ search: queryParams.toString() })
  }

  return (
    <Card
      title={
        <span>
          {title}
          <Filter className="inline-block ml-5" onChange={handleFilterSelect} options={filterOptions} />
        </span>
      }
      bordered={false}
      loading={loading}
      className="mb-5 h-full"
      extra={extra}
    >
      {
        error
          ? <StatisticsError />
          : <StatisticsChart data={data || []} granularity={granularity} dataToDisplay={dataToDisplay} />
      }
    </Card>
  )
}

const StatisticsError = () => {
  return (
    <div>
      <h3>Chart cannot be displayed</h3>
      Connection to Jitsu server cannot be established. That's not a critical error, you still will be able to
      configure Jitsu. However, statistic and monitoring for Jitsu Nodes won't be available. To fix that:
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

const Filter: React.FC<{
  label?: string
  onChange: (selected: FilterOption) => void
  options: FilterOption[]
  initialValue?: any
  className?: string
}> = ({ label = "", onChange, options, initialValue, className = "" }) => {
  const initialOption = options.find(o => o.value === initialValue) ?? options[0]
  const [selectedOption, setSelectedOption] = useState(initialOption)

  const handleChange = value => {
    const selectedOption = find(options, ["value", value]) ?? options[0]
    setSelectedOption(selectedOption)
    onChange(selectedOption)
  }

  return (
    <div className={className}>
      {label ? <label>{label}: </label> : null}
      <Select
        defaultValue={selectedOption.value}
        style={{ width: 170 }}
        onChange={handleChange}
        dropdownMatchSelectWidth={false}
      >
        {options.map(option => {
          return (
            <Option value={option.value} key={option.value}>
              <div className={styles.filterOption}>
                <span className={`icon-size-base ${styles.icon}`}>{option.icon}</span>{" "}
                <span className={`icon-size-base ${styles.label}`}>{option.label}</span>
              </div>
            </Option>
          )
        })}
      </Select>
    </div>
  )
}
