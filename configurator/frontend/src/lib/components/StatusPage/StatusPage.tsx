/* eslint-disable */
// @Libs
import React from "react"
import moment from "moment"
import { NavLink } from "react-router-dom"
import { Button, Card, CardProps, Col, Tooltip, Row } from "antd"
// @Components
import { CodeInline, LoadableComponent } from "lib/components/components"
import { StatisticsChart } from "ui/components/StatisticsChart/StatisticsChart"
// @Icons
import { ReloadOutlined, WarningOutlined, QuestionCircleOutlined, ThunderboltFilled } from "@ant-design/icons"
// @Services
import {
  addSeconds,
  DestinationsStatisticsDatePoint,
  IStatisticsService,
  SourcesStatisticsDatePoint,
  StatisticsService,
} from "lib/services/stat"
import ApplicationServices from "lib/services/ApplicationServices"
// @Store
import { destinationsStore } from "stores/destinations"
// @Utils
import { numberFormat, withDefaultVal } from "lib/commons/utils"
// @Styles
import "./StatusPage.less"
import { sourcesStore } from "../../../stores/sources"
import useLoader, { useLoaderAsObject } from "../../../hooks/useLoader"
import { useServices } from "../../../hooks/useServices"

type State = {
  destinationsCount?: number
  hourlyEventsBySources?: SourcesStatisticsDatePoint[]
  dailyEventsBySources?: SourcesStatisticsDatePoint[]
  hourlyRowsFromSources?: SourcesStatisticsDatePoint[]
  dailyRowsFromSources?: SourcesStatisticsDatePoint[]
  totalEventsLastHour?: number
  totalEventsToday?: number
}

interface Props {
  timeInUTC?: boolean
}

export const StatusPage: React.FC<{}> = () => {
  const services = useServices()
  const stats = new StatisticsService(services.backendApiClient, services.activeProject, true)
  const now = new Date()
  const dayAgo = addSeconds(now, -24 * 60 * 60)
  const monthAgo = addSeconds(now, -30 * 24 * 60 * 60)
  const [error, data, , reload, loading] = useLoader(async () => {
    return await Promise.all([
      stats.getDetailedIncomingStatistics(dayAgo, now, "hour", "push_source"),
      stats.getDetailedIncomingStatistics(monthAgo, now, "day", "push_source"),
      stats.getDetailedIncomingStatistics(dayAgo, now, "hour", "source"),
      stats.getDetailedIncomingStatistics(monthAgo, now, "day", "source"),
    ])
  })
  const [hourlyIncomingEvents, dailyIncomingEvents, hourlyRowsFromSources, dailyRowsFromSources] = data || [
    null,
    null,
    null,
    null,
  ]
  let utcPostfix = "[UTC]"
  if (error) {
    return <StatisticsError />
  }

  return (
    <>
      <div className="flex flex-row space-x-2 justify-end mb-4">
        <NavLink to="/events_stream">
          <Button type="ghost" size="large" icon={<ThunderboltFilled />} className="w-full mb-2">
            Live Events
          </Button>
        </NavLink>
        <Button
          size="large"
          icon={<ReloadOutlined />}
          onClick={() => {
            reload()
          }}
        >
          Reload
        </Button>
      </div>

      <Row gutter={16} className="status-page-cards-row">
        <Col span={12}>
          <Card
            title={
              <span>
                Incoming <NavLink to="/api_keys">events</NavLink> (last 30 days)
              </span>
            }
            bordered={false}
            loading={loading}
            extra={<SourcesEventsDocsTooltip />}
          >
            <StatisticsChart data={dailyIncomingEvents || []} granularity={"day"} dataToDisplay={["success", "skip"]} />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={
              <span>
                Incoming <NavLink to="/api_keys">events</NavLink> (last 24 hours)
              </span>
            }
            bordered={false}
            extra={<SourcesEventsDocsTooltip />}
            loading={loading}
          >
            <StatisticsChart
              data={hourlyIncomingEvents || []}
              granularity={"hour"}
              dataToDisplay={["success", "skip"]}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} className="status-page-cards-row">
        <Col span={12}>
          <Card
            title={<span>Rows synchronized from sources (last 30 days)</span>}
            bordered={false}
            extra={<DestinationsEventsDocsTooltip />}
            loading={loading}
          >
            <StatisticsChart
              data={dailyRowsFromSources || []}
              granularity={"day"}
              dataToDisplay={["success", "skip", "errors"]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={<span>Rows synchronized from sources (last 24 hours)</span>}
            bordered={false}
            loading={loading}
            extra={<DestinationsEventsDocsTooltip />}
          >
            <StatisticsChart
              data={hourlyRowsFromSources || []}
              granularity={"hour"}
              dataToDisplay={["success", "skip", "errors"]}
            />
          </Card>
        </Col>
      </Row>
    </>
  )
}

const StatisticsError = () => {
  return (
    <div className="w-2/4 mx-auto mt-3">
      <Card
        title={
          <>
            <span className="text-warning">
              <WarningOutlined />
            </span>{" "}
            Dashboard cannot be displayed
          </>
        }
        bordered={false}
      >
        <div>
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
      </Card>
    </div>
  )
}

const SourcesEventsDocsTooltip: React.FC = ({ children }) => {
  const content = (
    <div className="max-w-xs">
      <p>
        Events sent from sources may be count as skipped if and only if there was no connected destination to send the
        events to
      </p>
    </div>
  )
  return (
    <span className="cursor-pointer status-page_info-popover">
      <Tooltip title={content}>{children ? children : <QuestionCircleOutlined />}</Tooltip>
    </span>
  )
}

const DestinationsEventsDocsTooltip: React.FC = ({ children }) => {
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
