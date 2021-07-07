import moment, { Moment, unitOfTime } from 'moment';
import ApplicationServices, { BackendApiClient } from 'lib/services/ApplicationServices';
import { Project } from 'lib/services/model';

export type DatePoint = {
  date: Moment;
  events: number;
};

/**
 * Information about events per current period and prev
 * period
 */
export class EventsComparison {
  current: number;

  currentExtrapolated: number; //if current isn't representing a full period (example, we're in the middle

  //of the hour), this value will contain extrapolated value. Currently not calculated, reserver for future use
  previous: number;

  lastPeriod: Moment;

  constructor(series: DatePoint[], granularity: Granularity) {
    if (series == null || series.length == 0) {
      this.current = this.previous = 0;
      this.lastPeriod = null;
    } else {
      this.current = series[series.length - 1].events;
      this.lastPeriod = series[series.length - 1].date;
      this.previous = series.length > 1 ? series[series.length - 2].events : null;
    }
  }
}

type Granularity = 'day' | 'hour' | 'total';

export interface StatService {
  get(start: Date, end: Date, granularity: Granularity): Promise<DatePoint[]>;
}

export function addSeconds(date: Date, seconds: number): Date {
  let res = new Date(date.getTime());
  res.setSeconds(res.getSeconds() + seconds);
  return res;
}

function roundDown(date: Date, granularity: Granularity): Date {
  let res = new Date(date);
  res.setMinutes(0, 0, 0);
  if (granularity == 'day') {
    res.setHours(0);
  }
  return res;
}

function emptySeries(from: Moment, to: Moment, granularity: Granularity): DatePoint[] {
  let res: DatePoint[] = [];
  let end = moment(to)
    .utc()
    .startOf(granularity as unitOfTime.StartOf);
  let start = moment(from)
    .utc()
    .startOf(granularity as unitOfTime.StartOf);
  while (end.isSameOrAfter(start)) {
    res.push({ date: moment(end), events: 0 });
    end = end.subtract(1, granularity as unitOfTime.DurationConstructor);
  }
  return res;
}

function mergeSeries(lowPriority: DatePoint[], highPriority: DatePoint[]): DatePoint[] {
  return Object.entries({ ...index(lowPriority), ...index(highPriority) })
    .map(([key, val]) => {
      return { date: moment(key).utc(), events: val };
    })
    .sort((e1, e2) => {
      if (e1.date > e2.date) {
        return 1;
      } else if (e1.date < e2.date) {
        return -1;
      }
      return 0;
    });
}

function index(series: DatePoint[]): Record<string, number> {
  let res = {};
  series.forEach((point) => {
    res[point.date.toISOString()] = point.events;
  });
  return res;
}

export class StatServiceImpl implements StatService {
  private readonly api: BackendApiClient;

  private readonly project: Project

  private readonly timeInUTC: boolean;

  constructor(api: BackendApiClient, project: Project, timeInUTC: boolean) {
    this.api = api;
    this.project = project;
    this.timeInUTC = timeInUTC;
  }

  async get(start: Date, end: Date, granularity: Granularity): Promise<DatePoint[]> {
    let data = (
      await this.api.get(
        `/statistics?project_id=${this.project.id}&start=${start.toISOString()}&end=${end.toISOString()}&granularity=${granularity}`,
        { proxy: true }
      )
    )['data'];
    return mergeSeries(
      emptySeries(moment(start).utc(), moment(end).utc(), granularity),
      data.map((el) => {
        return { date: this.timeInUTC ? moment(el.key).utc() : moment(el.key), events: el.events };
      })
    );
  }
}