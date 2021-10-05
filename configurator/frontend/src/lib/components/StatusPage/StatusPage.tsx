/* eslint-disable */
// @Libs
import React from 'react';
import moment from 'moment';
import { NavLink } from 'react-router-dom';
import { Button, Card, CardProps, Col, Tooltip, Row } from 'antd';
// @Components
import { CodeInline, LoadableComponent } from 'lib/components/components';
import { StatisticsChart } from 'ui/components/StatisticsChart/StatisticsChart';
// @Icons
import {
  ReloadOutlined,
  WarningOutlined,
  QuestionCircleOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
// @Services
import {
  addSeconds,
  DestinationsStatisticsDatePoint,
  IStatisticsService,
  SourcesStatisticsDatePoint,
  StatisticsService
} from 'lib/services/stat';
import ApplicationServices from 'lib/services/ApplicationServices';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Utils
import { numberFormat, withDefaultVal } from 'lib/commons/utils';
// @Styles
import './StatusPage.less';

type State = {
  destinationsCount?: number;
  hourlyEventsBySources?: SourcesStatisticsDatePoint[];
  dailyEventsBySources?: SourcesStatisticsDatePoint[];
  hourlyEventsByDestinations?: DestinationsStatisticsDatePoint[];
  dailyEventsByDestinations?: DestinationsStatisticsDatePoint[];
  totalEventsLastHour?: number;
  totalEventsToday?: number;
};

interface Props {
  timeInUTC?: boolean;
}

export default class StatusPage extends LoadableComponent<Props, State> {
  private readonly services: ApplicationServices;
  private stats: IStatisticsService;
  private timeInUTC: boolean;

  constructor(props: Props, context: any) {
    super(props, context);
    this.timeInUTC = withDefaultVal(this.props.timeInUTC, true);
    this.services = ApplicationServices.get();
    this.stats = new StatisticsService(
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
        <Row gutter={16} className="status-page-cards-row">
          <Col flex={10}>
            <StatisticsCard
              value={this.state.destinationsCount}
              title="Total destinations"
              bordered={false}
            />
          </Col>
          <Col flex={10}>
            <StatisticsCard
              value={this.state.totalEventsToday}
              title={'Today'}
              bordered={false}
            />
          </Col>
          <Col flex={10}>
            <StatisticsCard
              value={this.state.totalEventsLastHour}
              title={`Last hour (${moment().utc().format('HH:[00]')} UTC) `}
              bordered={false}
            />
          </Col>
          <Col flex={1}>
            <Card
              bordered={false}
              className="flex flex-col justify-center h-full"
            >
              <div className="flex flex-col items-stretch h-full">
                <NavLink to="/events_stream">
                  <Button
                    type="ghost"
                    size="large"
                    icon={<UnorderedListOutlined />}
                    className="w-full mb-2"
                  >
                    Recent Events
                  </Button>
                </NavLink>
                <Button
                  size="large"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    this.reload();
                  }}
                >
                  Reload
                </Button>
              </div>
            </Card>
          </Col>
        </Row>
        <Row gutter={16} className="status-page-cards-row">
          <Col span={12}>
            <Card
              title={<span>Events from sources in the last 30 days</span>}
              bordered={false}
              extra={<SourcesEventsDocsTooltip />}
            >
              <StatisticsChart
                data={this.state.dailyEventsBySources}
                granularity={'day'}
                dataToDisplay={['success', 'skip']}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card
              title={<span>Events from sources in the last 24 hours</span>}
              bordered={false}
              extra={<SourcesEventsDocsTooltip />}
            >
              <StatisticsChart
                data={this.state.hourlyEventsBySources}
                granularity={'hour'}
                dataToDisplay={['success', 'skip']}
              />
            </Card>
          </Col>
        </Row>
        <Row gutter={16} className="status-page-cards-row">
          <Col span={12}>
            <Card
              title={<span>Events by destinations in the last 30 days</span>}
              bordered={false}
              extra={<DestinationsEventsDocsTooltip />}
            >
              <StatisticsChart
                data={this.state.dailyEventsByDestinations}
                granularity={'day'}
                dataToDisplay={['success', 'skip', 'errors']}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card
              title={<span>Events by destinations in the last 24 hours</span>}
              bordered={false}
              extra={<DestinationsEventsDocsTooltip />}
            >
              <StatisticsChart
                data={this.state.hourlyEventsByDestinations}
                granularity={'hour'}
                dataToDisplay={['success', 'skip', 'errors']}
              />
            </Card>
          </Col>
        </Row>
      </>
    );
  }

  async load(): Promise<State> {
    const now = new Date();
    const dayAgo = addSeconds(now, -24 * 60 * 60);
    const monthAgo = addSeconds(now, -30 * 24 * 60 * 60);
    const [
      hourlyEventsBySources,
      dailyEventsBySources,
      hourlyEventsByDestinations,
      dailyEventsByDestinations
    ] = await Promise.all([
      this.stats.getDetailedStatisticsBySources(dayAgo, now, 'hour'),
      this.stats.getDetailedStatisticsBySources(monthAgo, now, 'day'),
      this.stats.getDetailedStatisticsByDestinations(dayAgo, now, 'hour'),
      this.stats.getDetailedStatisticsByDestinations(monthAgo, now, 'day')
    ]);

    return {
      destinationsCount: this.getNumberOfDestinations(),
      hourlyEventsBySources: hourlyEventsBySources.slice(0, -1),
      dailyEventsBySources: dailyEventsBySources.slice(0, -1),
      hourlyEventsByDestinations: hourlyEventsByDestinations.slice(0, -1),
      dailyEventsByDestinations: dailyEventsByDestinations.slice(0, -1),
      totalEventsLastHour: hourlyEventsBySources.slice(-1)[0].total,
      totalEventsToday: dailyEventsBySources.slice(-1)[0].total
    };
  }

  getNumberOfDestinations() {
    return destinationsStore.destinations.length;
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
}

const StatisticsCard: React.FC<CardProps & { value: number }> = ({
  value,
  ...cardProps
}) => {
  const formatter = numberFormat({});
  return (
    <Card {...cardProps}>
      <div className="stat-card-number">{formatter(value)}</div>
    </Card>
  );
};

const SourcesEventsDocsTooltip: React.FC = ({ children }) => {
  const content = (
    <div className="max-w-xs">
      <p>
        Events sent from sources may be count as skipped if and only if there
        was no connected destination to send the events to
      </p>
    </div>
  );
  return (
    <span className="cursor-pointer status-page_info-popover">
      <Tooltip title={content}>
        {children ? children : <QuestionCircleOutlined />}
      </Tooltip>
    </span>
  );
};

const DestinationsEventsDocsTooltip: React.FC = ({ children }) => {
  const content = (
    <div className="max-w-xs">
      <p>
        Events sent from sources may be multiplexed in order to be sent to
        different destinations. Therefore, total amount of destinations events
        is greater or equal to the total amount of sources events
      </p>
    </div>
  );
  return (
    <span className="cursor-pointer status-page_info-popover">
      <Tooltip title={content}>
        {children ? children : <QuestionCircleOutlined />}
      </Tooltip>
    </span>
  );
};


