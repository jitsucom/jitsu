/* eslint-disable */
import { Align, CodeSnippet, LoadableComponent } from '../components';
import ApplicationServices from '../../services/ApplicationServices';
import { formatTimeOfRawUserEvents, sortTimeFormattedUserEventsDescending, withDefaultVal } from '../../commons/utils';
import { Button, Collapse } from 'antd';
import { NavLink } from 'react-router-dom';
import React from 'react';
import moment, { Moment } from 'moment';
import CaretRightOutlined from '@ant-design/icons/lib/icons/CaretRightOutlined';
import './EventsSteam.less';
import ReloadOutlined from '@ant-design/icons/lib/icons/ReloadOutlined';

export type Event = {
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
                <span>{this.eventContent(event)}</span>
              </Collapse.Panel>
            );
          })}
        </Collapse>
      </>
    );
  }

  protected async load(): Promise<State> {
    const rawEvents = await this.services.backendApiClient.get(
      `/events/cache?project_id=${this.services.activeProject.id}&limit=100000`, 
      {proxy: true }
    );
    const formattedEvents = formatTimeOfRawUserEvents(rawEvents);

    // events are sorted in ascending order (default by api)
    // sorts them in descending order
    // (might want to change to events.reverse(), but only if the api always returns asc)
    const events = sortTimeFormattedUserEventsDescending(formattedEvents);

    return { events };
  }
}
