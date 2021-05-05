/* eslint-disable */
import { Align, CodeSnippet, LoadableComponent } from '../components';
import ApplicationServices from '../../services/ApplicationServices';
import { withDefaultVal } from '../../commons/utils';
import { Button, Collapse } from 'antd';
import { NavLink } from 'react-router-dom';
import React from 'react';
import moment, { Moment } from 'moment';
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
import './EventsSteam.less';
import ReloadOutlined from '@ant-design/icons/lib/icons/ReloadOutlined';

type Event = {
  time: Moment;
  data: any;
};

type State = {
  events?: Event[];
};

export default class EventsStream extends LoadableComponent<{}, State> {
  private readonly services: ApplicationServices;
  private timeInUTC: boolean;

  constructor(props: any, context: any) {
    super(props, context);
    this.timeInUTC = withDefaultVal(undefined, true);
    this.services = ApplicationServices.get();
    this.state = {};
  }

  async componentDidMount(): Promise<void> {
    await super.componentDidMount();
  }

  eventHeader(event: Event) {
    return (
      <>
        <span className="events-stream-event-time">{event.time.utc().format()}</span>
        <span className="events-stream-event-preview">{JSON.stringify(event.data)}</span>
      </>
    );
  }

  eventContent(event: Event) {
    return (
      <CodeSnippet className="events-stream-full-json" language="json">
        {JSON.stringify(event.data, null, 2)}
      </CodeSnippet>
    );
  }

  protected renderReady(): React.ReactNode {
    let top = (
      <div className="status-and-events-panel">
        <NavLink to="/dahsboard" className="status-and-events-panel-main">
          Statistics
        </NavLink>
        <Button
          className="status-and-events-panel-reload"
          icon={<ReloadOutlined />}
          onClick={() => {
            this.reload();
          }}
        />
      </div>
    );

    if (!this.state.events || this.state.events.length == 0) {
      return (
        <>
          {top}
          <Align horizontal="center">No Data</Align>
        </>
      );
    }
    return (
      <>
        {top}
        <Collapse
          className="events-stream-events"
          bordered={false}
          expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
        >
          {this.state.events.map((event: Event) => {
            return (
              <Collapse.Panel className="events-stream-panel" header={this.eventHeader(event)} key={Math.random()}>
                <p>{this.eventContent(event)}</p>
              </Collapse.Panel>
            );
          })}
        </Collapse>
      </>
    );
  }

  protected async load(): Promise<State> {
    let events: Event[] = (
      await this.services.backendApiClient.get(`/events/cache?project_id=${this.services.activeProject.id}&limit=100`, {proxy: true })
    )['events'].map((rawEvent) => {
      return { time: moment(rawEvent['original']['_timestamp']), data: rawEvent };
    });
    events.sort((e1: Event, e2: Event) => {
      if (e1.time.isAfter(e2.time)) {
        return -1;
      } else if (e2.time.isAfter(e1.time)) {
        return 1;
      }
      return 0;
    });
    return { events };
  }
}
