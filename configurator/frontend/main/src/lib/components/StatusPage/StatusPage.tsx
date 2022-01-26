/* eslint-disable */
// @Libs
import React from "react"
import moment from "moment"
import { NavLink } from "react-router-dom"
import { Button, Card, Col, Tooltip, Row } from "antd"
// @Components
import { CodeInline } from "lib/components/components"
import { StatisticsChart } from "ui/components/StatisticsChart/StatisticsChart"
// @Icons
import { ReloadOutlined, WarningOutlined, QuestionCircleOutlined, ThunderboltFilled } from "@ant-design/icons"
// @Services
import { addSeconds, CombinedStatisticsDatePoint, StatisticsService } from "lib/services/stat"
import { useLoaderAsObject } from "../../../hooks/useLoader"
import { useServices } from "../../../hooks/useServices"

type State = {
  destinationsCount?: number
  lastHourEventsBySources?: CombinedStatisticsDatePoint[]
  lastDayEventsBySources?: CombinedStatisticsDatePoint[]
  lastHourRowsFromSources?: CombinedStatisticsDatePoint[]
  lastDayRowsFromSources?: CombinedStatisticsDatePoint[]
  totalEventsLastHour?: number
  totalEventsToday?: number
}

interface Props {
  timeInUTC?: boolean
}

export const StatusPage: React.FC<{}> = () => {
  const services = useServices()
  const stats = new StatisticsService(services.backendApiClient, services.activeProject, true)
  const isSelfHosted = services.features.environment !== "jitsu_cloud"
  const now = new Date()
  const dayAgo = addSeconds(now, -24 * 60 * 60)
  const monthAgo = addSeconds(now, -30 * 24 * 60 * 60)
  const {
    error,
    data,
    reloader: reload,
    isLoading: loading,
  } = useLoaderAsObject(async () => {
    return await Promise.all([
      stats.getCombinedStatisticsBySources(dayAgo, now, "hour", "push"),
      stats.getCombinedStatisticsBySources(monthAgo, now, "day", "push"),
      stats.getCombinedStatisticsBySources(dayAgo, now, "hour", "pull"),
      stats.getCombinedStatisticsBySources(monthAgo, now, "day", "pull"),
    ])
  })
  const [lastHourIncomingEvents, lastDayIncomingEvents, lastHourRowsFromSources, lastDayRowsFromSources] = data || [
    [],
    [],
    [],
    [],
  ]
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
            <StatisticsChart
              data={lastDayIncomingEvents || []}
              granularity={"day"}
              dataToDisplay={["success", "skip"]}
            />
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
              data={lastHourIncomingEvents || []}
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
              data={lastDayRowsFromSources || []}
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
              data={lastHourRowsFromSources || []}
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
