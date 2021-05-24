// @Libs
import moment from 'moment';
import { Collapse } from 'antd';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Types
import { Event } from '@./lib/components/EventsStream/EventsStream';
// @Styles
import styles from './CodeDebugger.module.less';

interface Props {
  handleClick: (ev: Event) => () => void;
}

const DebugEvents = ({ handleClick }: Props) => {
  const services = ApplicationServices.get();

  const [, eventsData] = useLoader(async() => await services.backendApiClient.get(`/events/cache?project_id=${services.activeProject.id}&limit=100000`, { proxy: true }));

  const events = (eventsData?.events ?? []).map(event => ({
    data: event,
    time: moment(event.original._timestamp)
  })).sort((e1: Event, e2: Event) => {
    if (e1.time.isAfter(e2.time)) {
      return -1;
    } else if (e2.time.isAfter(e1.time)) {
      return 1;
    }
    return 0;
  });

  return (
    <Collapse className={styles.events} ghost>
      {
        events.slice(0, 10).map(ev => (
          <Collapse.Panel className={styles.item} header={ev.time.utc().format()} key={Math.random()}>
            <p onClick={handleClick(ev)}>EVENT</p>
          </Collapse.Panel>
        ))
      }
    </Collapse>
  );
};

DebugEvents.displayName = 'DebugEvents';

export { DebugEvents };
