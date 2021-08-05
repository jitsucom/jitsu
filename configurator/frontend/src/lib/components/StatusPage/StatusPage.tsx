/* eslint-disable */
// @Libs
import React from 'react';
import moment from 'moment';
import { NavLink } from 'react-router-dom';
import { Button, Card, Col, Row } from 'antd';
// @Components
import {
  CodeInline,
  LoadableComponent,
  StatCard
} from 'lib/components/components';
import { StatisticsChart } from 'ui/components/StatisticsChart/StatisticsChart';
// @Icons
import ReloadOutlined from '@ant-design/icons/lib/icons/ReloadOutlined';
import WarningOutlined from '@ant-design/icons/lib/icons/WarningOutlined';
// @Services
import {
  addSeconds,
  DetailedStatisticsDatePoint,
  IStatisticsService,
  StatisticsService
} from 'lib/services/stat';
import ApplicationServices from 'lib/services/ApplicationServices';
// @Store
import { destinationsStore } from 'stores/destinations';
// @Utils
import { withDefaultVal } from 'lib/commons/utils';
// @Styles
import './StatusPage.less';

type State = {
  destinationsCount?: number;
  hourlyEvents?: DetailedStatisticsDatePoint[];
  dailyEvents?: DetailedStatisticsDatePoint[];
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
                value={this.state.destinationsCount}
                title="Total destinations"
                bordered={false}
              />
            </Col>
            <Col span={8}>
              <StatCard
                value={this.state.totalEventsToday}
                title={'Today'}
                bordered={false}
              />
            </Col>
            <Col span={8}>
              <StatCard
                value={this.state.totalEventsLastHour}
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
                <StatisticsChart
                  data={this.state.dailyEvents}
                  granularity={'day'}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Events last 24 hours" bordered={false}>
                <StatisticsChart
                  data={this.state.hourlyEvents}
                  granularity={'hour'}
                />
              </Card>
            </Col>
          </Row>
        </div>
      </>
    );
  }

  async load(): Promise<State> {
    let now = new Date();
    let [hourlyEvents, dailyEvents] = await Promise.all([
      this.stats.getDetailedStatistics(addSeconds(now, -24 * 60 * 60), now, 'hour'),
      this.stats.getDetailedStatistics(addSeconds(now, -30 * 24 * 60 * 60), now, 'day')
    ]);

    return {
      destinationsCount: this.getNumberOfDestinations(),
      hourlyEvents: hourlyEvents.slice(0, -1),
      dailyEvents: dailyEvents.slice(0, -1),
      totalEventsLastHour: hourlyEvents.slice(-1)[0].total,
      totalEventsToday: dailyEvents.slice(-1)[0].total
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


