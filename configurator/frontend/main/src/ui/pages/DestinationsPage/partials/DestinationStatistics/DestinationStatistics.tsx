// @Libs
import { Button, Card, Col, Row } from "antd"
import { useEffect, useMemo } from "react"
import { useHistory, useParams } from "react-router-dom"
// @Store
import { destinationsStore } from "stores/destinations"
// @Components
import { StatisticsChart } from "ui/components/StatisticsChart/StatisticsChart"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { DestinationNotFound } from "../DestinationNotFound/DestinationNotFound"
// @Icons
import { EditOutlined, UnorderedListOutlined } from "@ant-design/icons"
// @Routes
import { destinationPageRoutes } from "../../DestinationsPage.routes"
// @Types
import { CommonDestinationPageProps } from "../../DestinationsPage"
// @Services
import { useServices } from "hooks/useServices"
import { CombinedStatisticsDatePoint, IStatisticsService, StatisticsService } from "lib/services/stat"
// @Utils
import { useLoaderAsObject } from "hooks/useLoader"
// @Styles
import { Destination } from "@jitsu/catalog/destinations/types"
import { projectRoute } from "../../../../../lib/components/ProjectLink/ProjectLink"
import { currentPageHeaderStore } from "../../../../../stores/currentPageHeader"
import { LiveEventsRedirectButton } from "ui/components/LiveEventsRedirectButton/LiveEventsRedirectButton"
import { EventType } from "lib/components/EventsStream/shared"

type StatisticsPageParams = {
  id: string
}

function monthlyDataLoader(
  destinationUid: string,
  destination: Destination,
  type: "push" | "pull",
  statisticsService: IStatisticsService
) {
  if (destination.syncFromSourcesStatus !== "supported" && type === "pull") {
    return async () => []
  }
  return async () => {
    const now = new Date()
    const monthAgo = new Date(+now - 30 * 24 * 60 * 60 * 1000)
    return destination
      ? (await statisticsService.getCombinedStatisticsByDestinations(monthAgo, now, "day", type, destinationUid)) || []
      : []
  }
}

function hourlyDataLoader(
  destinationUid: string,
  destination: Destination,
  type: "push" | "pull",
  statisticsService: IStatisticsService
) {
  if (destination.syncFromSourcesStatus !== "supported" && type === "pull") {
    return async () => []
  }
  return async () => {
    const now = new Date()
    const dayAgo = new Date(+now - 24 * 60 * 60 * 1000)
    return destinationUid
      ? (await statisticsService.getCombinedStatisticsByDestinations(dayAgo, now, "hour", type, destinationUid)) || []
      : []
  }
}

export const DestinationStatistics: React.FC<CommonDestinationPageProps> = () => {
  const history = useHistory()
  const services = useServices()
  const params = useParams<StatisticsPageParams>()
  const destination = destinationsStore.list.find(d => d._id === params.id)
  const destinationUid = destination?._uid
  const destinationReference = destinationsStore.getDestinationReferenceById(destinationUid)
  const statisticsService = useMemo<IStatisticsService>(
    () => new StatisticsService(services.backendApiClient, services.activeProject.id, true),
    []
  )

  const isSelfHosted = services.features.environment !== "jitsu_cloud"

  // Events last 30 days
  const lastMonthPushEvents = useLoaderAsObject<CombinedStatisticsDatePoint[]>(
    monthlyDataLoader(destinationUid, destinationReference, "push", statisticsService),
    [destinationUid]
  )
  const lastMonthPullEvents = useLoaderAsObject<CombinedStatisticsDatePoint[]>(
    monthlyDataLoader(destinationUid, destinationReference, "pull", statisticsService),
    [destinationUid]
  )

  // Last 24 hours
  const lastDayPushEvents = useLoaderAsObject<CombinedStatisticsDatePoint[]>(
    hourlyDataLoader(destinationUid, destinationReference, "push", statisticsService),
    [destinationUid]
  )
  const lastDayPullEvents = useLoaderAsObject<CombinedStatisticsDatePoint[]>(
    hourlyDataLoader(destinationUid, destinationReference, "pull", statisticsService),
    [destinationUid]
  )

  const somethingIsLoading =
    lastMonthPushEvents.isLoading ||
    lastMonthPullEvents.isLoading ||
    lastDayPushEvents.isLoading ||
    lastDayPullEvents.isLoading

  useEffect(() => {
    currentPageHeaderStore.setBreadcrumbs(
      { title: "Destinations", link: projectRoute(destinationPageRoutes.root) },
      {
        title: (
          <PageHeader
            title={destinationReference ? params.id : "Destination Not Found"}
            icon={destinationReference?.ui.icon}
            mode={destinationReference ? "statistics" : null}
          />
        ),
      }
    )
  }, [])

  return destinationReference ? (
    <>
      <div className="flex flex-row space-x-2 justify-end mb-4">
        <LiveEventsRedirectButton
          eventType={EventType.Destination}
          entityId={destination._uid}
          type="ghost"
          size="large"
        />
        <Button
          type="ghost"
          icon={<EditOutlined />}
          size="large"
          onClick={() =>
            history.push(
              projectRoute(destinationPageRoutes.editExact, {
                id: params.id,
              })
            )
          }
        >
          {"Edit Destination"}
        </Button>
        <Button
          type="ghost"
          icon={<UnorderedListOutlined />}
          size="large"
          onClick={() => history.push(projectRoute(destinationPageRoutes.root))}
        >
          {"Destinations List"}
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
      <Row gutter={16} className={"mb-4"}>
        <Col span={12}>
          <Card title="Incoming events (last 30 days)" bordered={false} className="w-full" loading={somethingIsLoading}>
            <StatisticsChart data={lastMonthPushEvents.data || []} granularity={"day"} />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title="Incoming events (last 24 hours)"
            bordered={false}
            className="w-full"
            loading={somethingIsLoading}
          >
            <StatisticsChart data={lastDayPushEvents.data || []} granularity={"hour"} />
          </Card>
        </Col>
      </Row>
      {destinationReference.syncFromSourcesStatus === "supported" && (
        <Row gutter={16}>
          <Col span={12}>
            <Card
              title="Rows synchronized from sources (last 30 days)"
              bordered={false}
              className="w-full"
              loading={somethingIsLoading}
            >
              <StatisticsChart
                data={lastMonthPullEvents.data || []}
                granularity={"day"}
                dataToDisplay={["success", "skip"]}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card
              title="Rows synchronized from sources (last 24 hours)"
              bordered={false}
              className="w-full"
              loading={somethingIsLoading}
            >
              <StatisticsChart
                data={lastDayPullEvents.data || []}
                granularity={"hour"}
                dataToDisplay={["success", "skip"]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </>
  ) : (
    <DestinationNotFound destinationId={params.id} />
  )
}
