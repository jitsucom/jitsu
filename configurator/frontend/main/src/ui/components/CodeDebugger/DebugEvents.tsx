// @Libs
import { useMemo } from "react"
import { Card, List, Skeleton } from "antd"
import { range } from "lodash"
import moment from "moment"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
import { Event } from "../../../lib/services/events"
// @Hooks
import { useLoaderAsObject } from "hooks/useLoader"
// @Styles
import styles from "./CodeDebugger.module.less"
import { destinationsStore } from "stores/destinations"

interface Props {
  handleClick: (ev: Event) => () => void
}

const destinationIds = destinationsStore.list.map(dest => dest._uid)
destinationIds.length = 5

const DebugEvents = ({ handleClick }: Props) => {
  const services = ApplicationServices.get()

  const { data: eventsData, isLoading } = useLoaderAsObject(
    async () =>
      await services.backendApiClient.get(`/events/cache?project_id=${services.activeProject.id}&limit=10`, {
        proxy: true,
      })
  )

  const allEvents = useMemo(() => {
    const events = eventsData?.events ?? []
    if (events.length > 100) events.length = 100
    return events
      .map(event => ({
        data: event,
        time: moment(event.original._timestamp),
      }))
      .sort((e1: Event, e2: Event) => {
        if (e1.time.isAfter(e2.time)) {
          return -1
        } else if (e2.time.isAfter(e1.time)) {
          return 1
        }
        return 0
      })
  }, [eventsData?.events])

  return (
    <Card bordered={false} className={`${styles.events}`}>
      {isLoading ? (
        <List
          dataSource={range(0, 25)}
          renderItem={() => (
            <Skeleton active title={false} paragraph={{ rows: 2, width: ["100%", "70%"] }} className="mb-2" />
          )}
        />
      ) : (
        <List
          className={`h-full w-full overflow-y-auto overflow-x-hidden ${styles.withSmallScrollbar}`}
          dataSource={allEvents}
          renderItem={(item: any) => {
            return (
              <div
                className={`flex flex-col items-stretch ${styles.eventItem}`}
                onClick={handleClick(item?.data.original)}
              >
                <p className="truncate mb-0">{item?.time?.utc?.()?.format?.()}</p>
                {item?.data?.original?.event_type ? (
                  <p className="truncate mb-0">{item?.data?.original?.event_type}</p>
                ) : (
                  ""
                )}
              </div>
            )
          }}
        />
      )}
    </Card>
  )
}

DebugEvents.displayName = "DebugEvents"

export { DebugEvents }
