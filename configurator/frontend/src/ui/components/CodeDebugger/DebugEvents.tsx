// @Libs
import moment from 'moment';
import { Card, Collapse, Input } from 'antd';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Hooks
import useLoader from 'hooks/useLoader';
// @Types
import { Event } from 'lib/components/EventsStream/EventsStream';
// @Styles
import styles from './CodeDebugger.module.less';
import { useMemo, useState } from 'react';
import debounce from 'lodash/debounce';

interface Props {
  handleClick: (ev: Event) => () => void;
}

const DebugEvents = ({ handleClick }: Props) => {
  const services = ApplicationServices.get();

  const [, eventsData] = useLoader(async() => await services.backendApiClient.get(`/events/cache?project_id=${services.activeProject.id}&limit=100000`, { proxy: true }));

  const allEvents = useMemo(() => (eventsData?.events ?? []).map(event => ({
    data: event,
    time: moment(event.original._timestamp)
  })).sort((e1: Event, e2: Event) => {
    if (e1.time.isAfter(e2.time)) {
      return -1;
    } else if (e2.time.isAfter(e1.time)) {
      return 1;
    }
    return 0;
  }), [eventsData?.events]);

  return (
    <Card className={styles.events}>
      {
        allEvents.slice(0, 100).map(ev => (
          <p
            className="cursor-pointer"
            onClick={handleClick(ev.data.original)}
            key={Math.random()}
          >
            {ev.time.utc().format()}, {ev.data.original.event_type}
          </p>
        ))
      }
    </Card>
  );
};

DebugEvents.displayName = 'DebugEvents';

export { DebugEvents };
