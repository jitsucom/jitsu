import moment, { Moment, unitOfTime } from "moment"
import { BackendApiClient } from "./BackendApiClient"
import { Project } from "../../generated/conf-openapi"
/**
 * Events that come directly from sources are in the `source` namespace.
 * When events are processed internally in Jitsu thay may get multiplexed
 * in order to get delivered to different destinations and are counted in
 * the `destination` namespace. Total count of the `destination` events is
 * greater or equal to the total count of the `source` events due to the
 * multiplexing
 */
type EventsNamespace = "source" | "destination"

type EventsType = "push" | "pull"

type EventsCountType = "success" | "skip" | "errors"

type SourcesEventsCountTypePush = Exclude<EventsCountType, "errors">
type SourcesEventsCountType = EventsCountType
type DestinationsEventsCountTypePull = Exclude<EventsCountType, "errors">
type DestinationsEventsCountType = EventsCountType

type Granularity = "day" | "hour" | "total"

export type DatePoint = {
  date: Moment
  events: number
}

// type StatisticsPoint<T extends string> = {
//   [key in T]: number
// }
// type GenericDetailedStatisticsDatePoint<T extends string> = StatisticsPoint<T> & {
//   date: Moment
//   total: number
// }

// // export type DetailedStatisticsDatePoint = GenericDetailedStatisticsDatePoint<EventsCountType>

// export type SourcesStatisticsDatePoint = GenericDetailedStatisticsDatePoint<SourcesEventsCountType>
// export type DestinationsStatisticsDatePoint = GenericDetailedStatisticsDatePoint<DestinationsEventsCountType>

// type DetailedStatisticsDatePointFull = {
//   date: Moment
//   success: number
//   skip: number
//   error: number
// }

// type DetailedStatisticsDatePointWithoutErrors = {
//   date: Moment
//   success: number
//   skip: number
// }
// export type DetailedStatisticsDatePoint<Namespace extends EventsNamespace, Type extends EventsType> = Namespace extends "source"
//   ? Type extends "push"
//     ? DetailedStatisticsDatePointWithoutErrors
//     : DetailedStatisticsDatePointFull
//   : Type extends "push"
//   ? DetailedStatisticsDatePointFull
//   : DetailedStatisticsDatePointWithoutErrors

export type CombinedStatisticsDatePoint = {
  date: Moment
  total: number
  success: number
  skip: number
  error?: number
}

/**
 * Information about events per current period and prev
 * period
 */
export class EventsComparison {
  current: number

  currentExtrapolated: number //if current isn't representing a full period (example, we're in the middle

  //of the hour), this value will contain extrapolated value. Currently not calculated, reserver for future use
  previous: number

  lastPeriod: Moment

  constructor(series: DatePoint[], granularity: Granularity) {
    if (series == null || series.length == 0) {
      this.current = this.previous = 0
      this.lastPeriod = null
    } else {
      this.current = series[series.length - 1].events
      this.lastPeriod = series[series.length - 1].date
      this.previous = series.length > 1 ? series[series.length - 2].events : null
    }
  }
}

export interface IStatisticsService {
  get(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: "source",
    type: "push",
    status?: SourcesEventsCountTypePush
  ): Promise<DatePoint[]>
  get(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: "source",
    type: "pull",
    status?: SourcesEventsCountType
  ): Promise<DatePoint[]>
  get(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: "destination",
    type: "push",
    status?: DestinationsEventsCountType,
    destinationId?: string
  ): Promise<DatePoint[]>
  get(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: "destination",
    type: "pull",
    status?: DestinationsEventsCountTypePull,
    destinationId?: string
  ): Promise<DatePoint[]>
  getCombinedStatisticsBySources(
    start: Date,
    end: Date,
    granularity: Granularity,
    type: EventsType
  ): Promise<CombinedStatisticsDatePoint[]>
  getCombinedStatisticsByDestinations(
    start: Date,
    end: Date,
    granularity: Granularity,
    type: EventsType,
    destinationId: string
  ): Promise<CombinedStatisticsDatePoint[]>
}

export function addSeconds(date: Date, seconds: number): Date {
  let res = new Date(date.getTime())
  res.setSeconds(res.getSeconds() + seconds)
  return res
}

function emptySeries(from: Moment, to: Moment, granularity: Granularity): DatePoint[] {
  let res: DatePoint[] = []
  let end = moment(to)
    .utc()
    .startOf(granularity as unitOfTime.StartOf)
  let start = moment(from)
    .utc()
    .startOf(granularity as unitOfTime.StartOf)
  while (end.isSameOrAfter(start)) {
    res.push({ date: moment(end), events: 0 })
    end = end.subtract(1, granularity as unitOfTime.DurationConstructor)
  }
  return res
}

function mergeSeries(lowPriority: DatePoint[], highPriority: DatePoint[]): DatePoint[] {
  return Object.entries({ ...index(lowPriority), ...index(highPriority) })
    .map(([key, val]) => {
      return { date: moment(key).utc(), events: val }
    })
    .sort((e1, e2) => {
      if (e1.date > e2.date) {
        return 1
      } else if (e1.date < e2.date) {
        return -1
      }
      return 0
    })
}

function index(series: DatePoint[]): Record<string, number> {
  let res = {}
  series.forEach(point => {
    res[point.date.toISOString()] = point.events
  })
  return res
}

export class StatisticsService implements IStatisticsService {
  private readonly api: BackendApiClient

  private readonly projectId: string

  private readonly timeInUTC: boolean

  constructor(api: BackendApiClient, projectId: string, timeInUTC: boolean) {
    this.api = api
    this.projectId = projectId
    this.timeInUTC = timeInUTC
  }

  private combineStatisticsData<K extends string>(
    entries: Array<[EventsCountType, DatePoint[]]>
  ): CombinedStatisticsDatePoint[] {
    if (!entries.length) return []
    const datePoints = entries[0][1]
    return datePoints.map((_, idx) => {
      return entries.reduce(
        (point, entry) => {
          const date = entry[1][idx].date
          const name = entry[0]
          const value = entry[1][idx].events
          const total = point.total + value
          return {
            ...point,
            date,
            total,
            [name]: value,
          }
        },
        { total: 0 }
      ) as CombinedStatisticsDatePoint
    })
  }

  private getQuery(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: EventsNamespace,
    type: EventsType,
    status?: EventsCountType,
    destinationId?: string
  ): string {
    const queryParams = [
      ["project_id", this.projectId],
      ["start", start.toISOString()],
      ["end", end.toISOString()],
      ["granularity", granularity],
      ["type", type],
    ]
    if (namespace) queryParams.push(["namespace", namespace])
    if (status) queryParams.push(["status", status])
    if (destinationId) queryParams.push([namespace === "source" ? "source_id" : "destination_id", destinationId])
    const query = queryParams.reduce<string>((query, [name, value]) => `${query}${name}=${value}&`, "")
    return query.substring(0, query.length - 1) // removes the last '&' symbol
  }

  public async get(
    start: Date,
    end: Date,
    granularity: Granularity,
    namespace: EventsNamespace,
    type: EventsType,
    status?: EventsCountType,
    destinationId?: string
  ): Promise<DatePoint[]> {
    let response = await this.api.get(
      `/statistics/detailed?${this.getQuery(start, end, granularity, namespace, type, status, destinationId)}`,
      { proxy: true }
    )

    if (response["status"] !== "ok") {
      throw new Error("Failed to fetch statistics data")
    }

    const data = response["data"]

    return mergeSeries(
      emptySeries(moment(start).utc(), moment(end).utc(), granularity),
      data.map(el => {
        return {
          date: this.timeInUTC ? moment(el.key).utc() : moment(el.key),
          events: el.events,
        }
      })
    )
  }

  public async getCombinedStatisticsBySources(
    start: Date,
    end: Date,
    granularity: Granularity,
    type: EventsType,
    sourceId?: string
  ): Promise<CombinedStatisticsDatePoint[]> {
    if (sourceId === "all") {
      sourceId = ""
    }
    const requests = [
      this.get(start, end, granularity, "source", type, "success", sourceId),
      this.get(start, end, granularity, "source", type, "skip", sourceId),
      this.get(start, end, granularity, "source", type, "errors", sourceId),
    ]

    const [successData, skipData, errorData] = await Promise.all(requests)
    const sourceDataEntries: [SourcesEventsCountType, DatePoint[]][] = [
      ["success", successData],
      ["skip", skipData],
      ["errors", errorData],
    ]
    return this.combineStatisticsData(sourceDataEntries)
  }

  public async getCombinedStatisticsByDestinations(
    start: Date,
    end: Date,
    granularity: Granularity,
    type: EventsType,
    destinationId?: string
  ): Promise<CombinedStatisticsDatePoint[]> {
    if (destinationId === "all") {
      destinationId = ""
    }
    const errorsDataAvailable = type === "push"
    const requests = [
      this.get(start, end, granularity, "destination", type, "success", destinationId),
      this.get(start, end, granularity, "destination", type, "skip", destinationId),
    ]
    if (errorsDataAvailable)
      requests.push(this.get(start, end, granularity, "destination", type, "errors", destinationId))
    const [successData, skipData, errorData] = await Promise.all(requests)

    const destinationDataEntries: [DestinationsEventsCountType, DatePoint[]][] = [
      ["success", successData],
      ["skip", skipData],
    ]

    if (errorsDataAvailable) destinationDataEntries.push(["errors", errorData])

    return this.combineStatisticsData(destinationDataEntries)
  }
}
