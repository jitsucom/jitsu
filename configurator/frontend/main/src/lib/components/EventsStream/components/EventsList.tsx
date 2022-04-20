// @Libs
import { useEffect, useRef, useState } from "react"
import { Alert, Button, Input, Tooltip } from "antd"
import { default as moment } from "moment"
import { isNull, omitBy } from "lodash"
import murmurhash from "murmurhash"
import * as uuid from "uuid"
import cn from "classnames"
// @Other
import { EventsView } from "./EventsView"
import { NavLink, useHistory, useLocation } from "react-router-dom"
import { useServices } from "hooks/useServices"
import { destinationsStore } from "stores/destinations"
import { useLoaderAsObject } from "hooks/useLoader"
import { ExclamationCircleOutlined, MinusCircleOutlined, ReloadOutlined } from "@ant-design/icons"
import { CenteredError, CenteredSpin } from "../../components"
import CheckCircleOutlined from "@ant-design/icons/lib/icons/CheckCircleOutlined"
import RightCircleOutlined from "@ant-design/icons/lib/icons/RightCircleOutlined"
import { Event, EventStatus, EventType } from "../shared"
import JitsuClientLibraryCard, { jitsuClientLibraries } from "../../JitsuClientLibrary/JitsuClientLibrary"
import { SelectFilter } from "../../Filters/SelectFilter"
import { FilterOption } from "../../Filters/shared"
import ApplicationServices from "lib/services/ApplicationServices"
import ProjectLink from "lib/components/ProjectLink/ProjectLink"
// @Styles
import styles from "../EventsSteam.module.less"

function getEventId(type: EventType, json: any) {
  if (type === EventType.Token) {
    return uuid.v4()
  }
  return json?.eventn_ctx_event_id || json?.eventn_ctx?.event_id || murmurhash.v3(JSON.stringify(json))
}

function normalizeEvent(type: EventType, id: string, status: EventStatus, data: any): Event {
  let original = data.original ?? data
  return {
    type: type,
    timestamp: moment.utc(data.timestamp || original._timestamp || original.utc_time || new Date(2022, 2, 20)),
    eventId: getEventId(type, original),
    rawJson: original,
    id: id,
    status: status,
    resultJson: data.success || data.error || data.skip || data.malformed,
  }
}

function processEvents(type: EventType, data: { id: string; events: any }) {
  let eventsIndex: Record<string, Event> = {}
  data.events.events.forEach(event => {
    let status
    if (event.success) {
      status = EventStatus.Success
    } else if (event.error || event.malformed) {
      status = EventStatus.Error
    } else if (event.skip) {
      status = EventStatus.Skip
    } else {
      status = type === EventType.Token ? EventStatus.Success : EventStatus.Pending
    }
    let normalizedEvent = normalizeEvent(type, data.id, status, event)
    eventsIndex[normalizedEvent.eventId] = normalizedEvent
  })

  let events = [...Object.values(eventsIndex)]
  eventsIndex = {} //for GC

  events = events.sort((a, b) => {
    if (isNaN(a.timestamp.unix())) {
      return 1
    } else if (isNaN(b.timestamp.unix())) {
      return -1
    }
    return b.timestamp.unix() - a.timestamp.unix()
  })

  return events
}

const NoDataFlowing: React.FC<{ showAPIKeyHint: boolean }> = ({ showAPIKeyHint }) => {
  return (
    <div className="flex flex-col justify-center items-center min-h-full pt-6">
      <div className="text-center font-heading font-bold text-lg w-1/4 mb-4">No data flowing</div>
      <div className="text-secondaryText">
        <ol className={`${showAPIKeyHint ? "list-decimal" : "list-none"} list-inside mb-2 ml-2 text-center`}>
          {showAPIKeyHint && (
            <li className="mb-4">
              Get <NavLink to="../api-keys">API key, or create a new one</NavLink>
            </li>
          )}
          <li>
            Use one of the following libraries and APIs to send events to Jitsu
            <div className="flex flex-row justify-center flex-wrap items-center pt-6">
              {Object.values(jitsuClientLibraries).map(props => (
                <div className="mx-3 my-4" key={props.name}>
                  <JitsuClientLibraryCard {...props} />
                </div>
              ))}
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}
const statusOptions = [{ label: "All", value: "" } as const, { label: "Error", value: "error" } as const] as const

export const EventsList: React.FC<{
  type: EventType
  filterOptions: FilterOption[]
}> = ({ type, filterOptions }) => {
  const services = useServices()
  const history = useHistory()
  const listInnerRef = useRef()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [autoReload, setAutoReload] = useState<boolean>(true)
  const [selectedEvent, setSelectedEvent] = useState<string | null | undefined>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [filteredEvents, setFilteredEvents] = useState<Event[]>([])
  const [term, setTerm] = useState<string | undefined>(params.get("q"))
  const [idFilter, setIdFilter] = useState<FilterOption["value"]>(
    filterOptions.find(f => f.value === params.get("id"))?.value ?? filterOptions[0]?.value
  )
  const [statusFilter, setStatusFilter] = useState<string>(
    statusOptions.find(f => f.value === params.get("status"))?.value ?? statusOptions[0]?.value
  )
  const [reloadCount, setReloadCount] = useState<number>(0)

  const destinationsMap: Record<string, DestinationData> = destinationsStore.listIncludeHidden.reduce((index, dst) => {
    index[dst._uid] = dst
    return index
  }, {})

  useEffect(() => {
    if (!idFilter) {
      history.push({ search: null })
      return
    }
    let queryParams = omitBy({ type, id: idFilter, status: statusFilter }, isNull)
    if (term) {
      queryParams["q"] = term
    }
    history.push({ search: new URLSearchParams(queryParams).toString() })
  }, [idFilter, statusFilter, term])

  const { data, error } = useLoaderAsObject<{ events: any; id: string }>(() => {
    if (!idFilter) {
      return null
    }

    return fetchEvents(services, {
      type,
      id: idFilter,
      status: statusFilter,
      limit: 500,
      onBeforeFetch: () => setSelectedEvent(null),
    })
  }, [idFilter, statusFilter, reloadCount])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!autoReload || selectedEvent) {
        return
      }
      setReloadCount(reloadCount + 1)
    }, 15000)
    return () => clearInterval(interval)
  }, [autoReload, selectedEvent, reloadCount])

  const filterByTerm = (events: Event[], term: string): Event[] => {
    return term ? events.filter(i => JSON.stringify(i.rawJson).indexOf(term) !== -1) : events
  }

  const search = (term: string): void => {
    setTerm(term)
    setFilteredEvents(filterByTerm(events, term))
  }

  useEffect(() => {
    const initialEvents = error || !data ? [] : processEvents(type, data)
    setEvents(initialEvents)
    setFilteredEvents(filterByTerm(initialEvents, term))
  }, [error, data])

  if (!filterOptions.length) {
    return <NoDataFlowing showAPIKeyHint={true} />
  }

  const eventStatusMessage = event => {
    const error = event.status === EventStatus.Error
    const skip = event.status === EventStatus.Skip

    if (type === EventType.Token) {
      if (skip) {
        return `Skip`
      }
      return error ? event.rawJson.error ?? "Error" : "Success"
    }

    return error
      ? "Failed - at least one destination load is failed"
      : skip
      ? "Skipped - event was not sent to destination"
      : "Success - successfully sent to destination"
  }

  const { last_minute_limited, cache_capacity_per_interval, interval_seconds } = data?.events ?? {}
  const alert =
    last_minute_limited > 0 ? (
      <div className="mt-4">
        <Alert
          message={`This isn't a full list of all events. Jitsu doesn't cache all events, but the only ${cache_capacity_per_interval} events per ${interval_seconds} seconds. Other ${last_minute_limited} events from the last minute have been being processed and stored to the destinations but haven't been saved into the cache.`}
          type="warning"
        />
      </div>
    ) : null

  const onScroll = () => {
    if (!listInnerRef.current) {
      return
    }
    const { scrollTop } = listInnerRef.current
    const startAutoReload = scrollTop === 0
    if (startAutoReload === autoReload) {
      return
    }
    setAutoReload(startAutoReload)
  }

  return (
    <>
      {alert}
      <div className={`mb-6 flex justify-center items-center`}>
        <SelectFilter
          className="mr-5"
          label={type === EventType.Token ? "API Key" : "Destination"}
          initialValue={idFilter}
          options={filterOptions}
          onChange={option => {
            setIdFilter(option.value)
          }}
        />
        <SelectFilter
          className="mr-7"
          label="Status"
          value={statusFilter}
          initialValue={statusFilter}
          options={statusOptions}
          onChange={option => {
            setStatusFilter(option.value)
          }}
        />
        <ErrorsHint
          id={idFilter}
          type={type}
          statusFilter={statusFilter}
          className="mr-5"
          onClick={() => setStatusFilter(EventStatus.Error)}
        />
        <Button
          size="large"
          type="primary"
          className={`ml-auto my-2`}
          onClick={() => {
            setReloadCount(count => count + 1)
          }}
        >
          <ReloadOutlined /> Reload
        </Button>
      </div>
      <Input className="w-full" placeholder="Filter" value={term} onChange={e => search(e.target.value)} />
      <div
        className={`mt-3 transition-all duration-300 ${styles.autoReloadInfo} ${
          autoReload && !selectedEvent ? "" : "opacity-0"
        }`}
      >
        <ReloadOutlined spin={true} /> Auto reload is enabled. <a onClick={() => setAutoReload(false)}>Disable</a>
      </div>
      {error ? (
        <div className="w-full">
          <CenteredError error={error} />
        </div>
      ) : !data ? (
        <div className="w-full">
          <CenteredSpin />
        </div>
      ) : (
        <div className={styles.eventsList} ref={listInnerRef} onScroll={onScroll}>
          {!filteredEvents.length ? <NoDataFlowing showAPIKeyHint={false} /> : null}
          {filteredEvents.map(event => {
            const active = event.eventId === selectedEvent
            return (
              <div key={event.eventId}>
                <div
                  className={`overflow-hidden w-full flex flex-row border-b border-secondaryText border-opacity-50 items-center cursor-pointer h-12 ${
                    selectedEvent === event.eventId ? "bg-bgSecondary" : "hover:bg-bgComponent"
                  }`}
                  key="header"
                  onClick={() => setSelectedEvent(active ? null : event.eventId)}
                >
                  <div className="w-6 flex items-center justify-center px-3 text-lg" key="icon">
                    <Tooltip title={eventStatusMessage(event)}>
                      {event.status === EventStatus.Error ? (
                        <ExclamationCircleOutlined className="text-error" />
                      ) : event.status === EventStatus.Pending || event.status === EventStatus.Skip ? (
                        <MinusCircleOutlined className="text-warning" />
                      ) : (
                        <CheckCircleOutlined className="text-success" />
                      )}
                    </Tooltip>
                  </div>
                  <div
                    className={`text-xxs whitespace-nowrap text-secondaryText px-1 ${styles.timestampColumn}`}
                    key="time"
                  >
                    <div>{event.timestamp.format("YYYY-MM-DD HH:mm:ss")} UTC</div>
                    <div className="text-xxs">{event.timestamp.fromNow()}</div>
                  </div>
                  <div
                    className="pl-4 text-3xs text-secondaryText font-monospace overflow-hidden overflow-ellipsis h-12 leading-4 flex-shrink"
                    key="json"
                  >
                    {event.rawJson.malformed ? event.rawJson.malformed : JSON.stringify(event.rawJson, null, 2)}
                  </div>
                  <div
                    className={cn(
                      "w-12 text-testPale flex items-center justify-center px-2 text-xl transition-transform duration-500",
                      styles.expandBtn,
                      active && "transform rotate-90"
                    )}
                    key="expand"
                  >
                    <RightCircleOutlined />
                  </div>
                </div>
                <div key="details">
                  {active && <EventsView event={event} allDestinations={destinationsMap} className="pb-6" />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

async function fetchEvents(
  services: ApplicationServices,
  options: { type: EventType; id: string; status: string; limit?: number; onBeforeFetch?(): void }
): Promise<{ events: any; id: string }> {
  const { type, id, status, limit, onBeforeFetch } = options
  const ids = type === EventType.Destination ? `${services.activeProject.id}.${id}` : id

  onBeforeFetch?.()
  return services.backendApiClient
    .get(
      `/events/cache?project_id=${services.activeProject.id}&limit=${
        limit ?? "500"
      }&namespace=${type}&ids=${ids}&status=${status ?? ""}`,
      { proxy: true }
    )
    .then(events => {
      return { events, id }
    })
}

type ErrorsHintProps = {
  id: string
  type: EventType
  statusFilter: string
  className?: string
  onClick?: VoidFunction
}

const ErrorsHint: React.FC<ErrorsHintProps> = ({ id, type, statusFilter, className, onClick }) => {
  const services = useServices()
  const { data } = useLoaderAsObject<{ events: any; id: string }>(() => {
    // ;[id, type, statusFilter]
    // debugger
    if (statusFilter === EventStatus.Error) return null
    return fetchEvents(services, {
      id,
      type,
      status: EventStatus.Error,
      limit: 1,
    })
  }, [id, type, statusFilter])

  const latestError = data ? processEvents(type, data)[0] : null
  // if (latestError) debugger
  const show = !!latestError?.timestamp.isSameOrAfter(moment().subtract(1, "months"))
  return (
    show && (
      <span
        className={cn(
          className,
          "flex items-center p-2 text-sm text-error rounded-md cursor-pointer hover:bg-bgSecondary"
        )}
        onClick={onClick}
      >
        The most recent error(s) occured {latestError.timestamp.fromNow()}. Click to see all.
        {/* {<ProjectLink to="">See All</ProjectLink>} */}
      </span>
    )
  )
}
