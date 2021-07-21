/* eslint-disable */
// @Libs
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import React, { useEffect } from 'react';
import moment from 'moment';
import Xarrow from 'react-xarrows';
import LeaderLine from 'leader-line-new';
import { NavLink } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button, Card, Col, Row, Badge } from 'antd';
// @Components
import { EntityIcon } from 'lib/components/EntityIcon/EntityIcon';
import { EntityCard } from 'lib/components/EntityCard/EntityCard';
import { CodeInline, LoadableComponent, StatCard } from 'lib/components/components';
// @Store
import { sourcesStore } from 'stores/sources';
import { destinationsStore } from 'stores/destinations';
// @Icons
import ReloadOutlined from '@ant-design/icons/lib/icons/ReloadOutlined';
import WarningOutlined from '@ant-design/icons/lib/icons/WarningOutlined';
// @Services
import {
  addSeconds,
  DatePoint,
  EventsComparison,
  StatService,
  StatServiceImpl
} from 'lib/services/stat';
import ApplicationServices from 'lib/services/ApplicationServices';
// @Utils
import { withDefaultVal } from 'lib/commons/utils';
// @Styles
import styles from './Connections.module.less';
import './StatusPage.less';

type State = {
  designationsCount?: number;
  hourlyEvents?: DatePoint[];
  dailyEvents?: DatePoint[];
  hourlyComparison?: EventsComparison;
  dailyComparison?: EventsComparison;
};

interface Props {
  timeInUTC?: boolean;
}

const ConnectionsLinesComponent: React.FC = () => {
  return (
    <>
      {sourcesStore.sources.reduce(
        (connections, { sourceId, destinations }) => {
          debugger;
          return [
            ...connections,
            ...destinations.map((destinationUid) => (
              <Xarrow start={sourceId} end={destinationUid} />
            ))
          ];
        },
        []
      )}
    </>
  );
};

const ConnectionsLines = observer(ConnectionsLinesComponent);

ConnectionsLines.displayName = 'ConnectionsLines';

const connections = {};

const StatusPageComponent: React.FC = () => {
  const drawLines = () => {
    sourcesStore.sources.map(({ sourceId, destinations }) => {
      destinations.forEach((destinationUid) => {
        connections[`${sourceId}-${destinationUid}`] = new LeaderLine(
          document.getElementById(sourceId),
          document.getElementById(destinationUid),
          { endPlug: 'behind', size: 4 }
        );
      });
    });
  };

  useEffect(() => {
    drawLines();
  }, []);

  return (
    <div className="flex justify-center w-full h-full">
      <div className="flex items-stretch w-full h-full max-w-3xl">
        <Column className="max-w-xs">
          {sourcesStore.sources.map(({ sourceId, sourceType, connected }) => {
            return (
              <CardContainer id={sourceId}>
                <EntityCard
                  name={sourceId}
                  message={<EntityMessage connectionTestOk={connected} />}
                  icon={
                    <EntityIconWrapper>
                      <EntityIcon
                        entityType="source"
                        entitySubType={sourceType}
                      />
                    </EntityIconWrapper>
                  }
                />
              </CardContainer>
            );
          })}
        </Column>

        <Column />

        <Column className="max-w-xs">
          {destinationsStore.destinations.map(
            ({ _id, _uid, _type, _connectionTestOk }) => {
              return (
                <CardContainer id={_uid}>
                  <EntityCard
                    name={_id}
                    message={
                      <EntityMessage connectionTestOk={_connectionTestOk} />
                    }
                    icon={
                      <EntityIconWrapper>
                        <EntityIcon
                          entityType="destination"
                          entitySubType={_type}
                        />
                      </EntityIconWrapper>
                    }
                  />
                </CardContainer>
              );
            }
          )}
        </Column>
      </div>
      {/* <ConnectionsLines /> */}
    </div>
  );
};

const StatusPage = observer(StatusPageComponent);
StatusPage.displayName = 'StatusPage';

export default StatusPage;

const EntityMessage: React.FC<{ connectionTestOk: boolean }> = ({
  connectionTestOk
}) => {
  return (
    <div>
      <Badge
        size="default"
        status={connectionTestOk ? 'processing' : 'error'}
        text={
          connectionTestOk ? (
            <span className={styles.processing}>{'Connected'}</span>
          ) : (
            <span className={styles.error}>{'Connection test failed'}</span>
          )
        }
      />
    </div>
  );
};

const EntityIconWrapper: React.FC = ({ children }) => {
  return (
    <div className="flex justify-center items-center h-14 w-14 m-3">
      {children}
    </div>
  );
};

const Column: React.FC<{ className?: string }> = ({ className, children }) => {
  return (
    <div className={`flex flex-col flex-auto ${className}`}>{children}</div>
  );
};

const CardContainer: React.FC<{ id: string }> = ({ id, children }) => {
  return (
    <div key={id} className={`my-2`} id={id}>
      {children}
    </div>
  );
};

export class _StatusPage extends LoadableComponent<Props, State> {
  private readonly services: ApplicationServices;
  private stats: StatService;
  private timeInUTC: boolean;

  constructor(props: Props, context: any) {
    super(props, context);
    this.timeInUTC = withDefaultVal(this.props.timeInUTC, true);
    this.services = ApplicationServices.get();
    this.stats = new StatServiceImpl(
      this.services.backendApiClient,
      this.services.activeProject,
      this.timeInUTC
    );
    this.state = {};
  }

  async componentDidMount(): Promise<void> {
    await super.componentDidMount();
  }

  renderReady() {
    let utcPostfix = this.timeInUTC ? ' [UTC]' : '';
    return (
      <>
        <div className="status-and-events-panel">
          <NavLink to="/events_stream" className="status-and-events-panel-main">
            Recent Events
          </NavLink>
          <Button
            className="status-and-events-panel-reload"
            icon={<ReloadOutlined />}
            onClick={() => {
              this.reload();
            }}
          />
        </div>
        <div className="status-page-cards-row">
          <Row gutter={16}>
            <Col span={8}>
              <StatCard
                value={this.state.designationsCount}
                title="Total destinations"
                bordered={false}
              />
            </Col>
            <Col span={8}>
              <StatCard
                value={this.state.dailyComparison.current}
                valuePrev={this.state.dailyComparison.previous}
                title={'Today'}
                bordered={false}
              />
            </Col>
            <Col span={8}>
              <StatCard
                value={this.state.hourlyComparison.current}
                valuePrev={this.state.hourlyComparison.previous}
                title={`Last hour (${moment().utc().format('HH:[00]')} UTC) `}
                bordered={false}
              />
            </Col>
          </Row>
        </div>
        <div className="status-page-cards-row">
          <Row gutter={16}>
            <Col span={12}>
              <Card title="Events last 30 days" bordered={false}>
                <Chart data={this.state.dailyEvents} granularity={'day'} />
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Events last 24 hours" bordered={false}>
                <Chart data={this.state.hourlyEvents} granularity={'hour'} />
              </Card>
            </Col>
          </Row>
        </div>
      </>
    );
  }

  format(date: Date, granularity: 'day' | 'hour') {
    let base = this.formatDate(date);

    if (granularity === 'day') {
      return base;
    } else {
      return (
        base +
        ' ' +
        this.padZero(date.getHours()) +
        ':' +
        this.padZero(date.getMinutes())
      );
    }
  }

  padZero(val: any) {
    let str = val + '';
    return str.length > 1 ? str : '0' + str;
  }

  async load(): Promise<State> {
    let now = new Date();
    let [hourlyEvents, dailyEvents, designationsCount] = await Promise.all([
      this.stats.get(addSeconds(now, -24 * 60 * 60), now, 'hour'),
      this.stats.get(addSeconds(now, -30 * 24 * 60 * 60), now, 'day'),
      this.getNumberOfDestinations()
    ]);

    return {
      designationsCount,
      hourlyEvents,
      dailyEvents,
      hourlyComparison: new EventsComparison(hourlyEvents, 'hour'),
      dailyComparison: new EventsComparison(dailyEvents, 'day')
    };
  }

  async getNumberOfDestinations() {
    let destinations = await this.services.storageService.get(
      'destinations',
      this.services.activeProject.id
    );
    return destinations && destinations.destinations
      ? destinations.destinations.length
      : 0;
  }

  protected renderError(e: Error): React.ReactNode {
    return (
      <div className="w-2/4 mx-auto mt-3">
        <Card
          title={
            <>
              <span className="text-warning">
                <WarningOutlined />
              </span>{' '}
              Dashboard cannot be displayed
            </>
          }
          bordered={false}
        >
          <div>
            Connection to Jitsu server cannot be established. That's not a
            critical error, you still will be able to configure Jitsu. However,
            statistic and monitoring for Jitsu Nodes won't be available. To fix
            that:
            <ul className="mt-5">
              <li>
                Make sure that <CodeInline>jitsu.base_url</CodeInline> property
                is set in Jitsu Configurator yaml file
              </li>
              <li>
                If <CodeInline>jitsu.base_url</CodeInline> is set, make sure
                that this URL is accessible (not blocked by firewall) from Jitsu
                Configurator
              </li>
            </ul>
          </div>
        </Card>
      </div>
    );
  }

  formatDate(d: Date) {
    let month = '' + (d.getMonth() + 1),
      day = '' + d.getDate(),
      year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
  }
}

const testData = [
  { name: 'Page A', uv: 4000, pv: 2400, amt: 2400 },
  { name: 'Page B', uv: 3000, pv: 1398, amt: 2210 },
  { name: 'Page C', uv: 2000, pv: 9800, amt: 2290 },
  { name: 'Page D', uv: 2780, pv: 3908, amt: 2000 },
  { name: 'Page E', uv: 1890, pv: 4800, amt: 2181 },
  { name: 'Page F', uv: 2390, pv: 3800, amt: 2500 },
  { name: 'Page G', uv: 3490, pv: 4300, amt: 2100 }
];

const CustomizedXAxisTick = (props) => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} dy={16} fontSize="10" textAnchor="end" fill="white">
      {props.payload.value}
    </text>
  </g>
);

const CustomizedYAxisTick = (props) => (
  <g transform={`translate(${props.x},${props.y})`}>
    <text x={0} y={0} fontSize="10" textAnchor="end" fill="white">
      {new Intl.NumberFormat('en').format(props.payload.value)}
    </text>
  </g>
);

const Chart = ({ data, granularity }: { data: DatePoint[]; granularity: 'hour' | 'day' }) => (
  <ResponsiveContainer width="100%" minHeight={300} minWidth={300}>
    <LineChart
      data={data.map((point) => ({
        label: granularity == 'hour' ? point.date.format('HH:mm') : point.date.format('DD MMM'),
        events: point.events
      }))}
    >
      <XAxis dataKey="label" tick={<CustomizedXAxisTick />} stroke="#394e5a" />
      <YAxis tick={<CustomizedYAxisTick />} stroke="#394e5a" />
      <CartesianGrid strokeDasharray="3 3" stroke="#394e5a" />
      <Tooltip
        wrapperStyle={{ backgroundColor: '#22313a', border: '1px solid #394e5a' }}
        itemStyle={{ color: '#9bbcd1' }}
        labelStyle={{ color: '#dcf3ff' }}
        formatter={(value) => new Intl.NumberFormat('en').format(value)}
      />
      <Line type="monotone" dataKey="events" stroke="#878afc" activeDot={{ r: 8 }} strokeWidth={2} />
    </LineChart>
  </ResponsiveContainer>
);
