import { destinationsStore } from '../../../stores/destinations';
import { observer } from 'mobx-react-lite';
import { useServices } from '../../../hooks/useServices';
import useLoader from '../../../hooks/useLoader';
import { NavLink } from 'react-router-dom';
import { ErrorCard } from '../ErrorCard/ErrorCard';
import { CenteredError, CenteredSpin, CodeSnippet, Preloader } from '../components';
import { Badge, Skeleton, Tabs, Tooltip } from 'antd';
import { jitsuClientLibraries, default as JitsuClientLibraryCard } from '../JitsuClientLibrary/JitsuClientLibrary';
import { Moment, default as moment } from 'moment';
import orderBy from 'lodash/orderBy';
import CheckCircleOutlined from '@ant-design/icons/lib/icons/CheckCircleOutlined';
import { useState, ReactElement } from 'react';
import { destinationsReferenceMap } from '../../../catalog/destinations/lib';
import styles from './EventsSteam.module.less'
import murmurhash from 'murmurhash';
import RightCircleOutlined from '@ant-design/icons/lib/icons/RightCircleOutlined';
import { DownCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Code } from '../Code/Code';

type Event = {
  timestamp: Moment,
  eventId: string,
  rawJson: any
  destinationResults: Record<string, DestinationStatus>
}

type DestinationStatus = {
  status: 'success' | 'error' | 'pending'
  rawJson: any
}

function getEventId(json: any) {
  return json.eventn_ctx_event_id || json?.eventn_ctx?.event_id || murmurhash.v3(JSON.stringify(json));
}

function newEvent(json: any): Event {
  return {
    timestamp: moment.utc(json._timestamp),
    eventId: getEventId(json),
    rawJson: json,
    destinationResults: {}
  }
}

function NoDataFlowing() {
  return <div className="flex flex-col justify-center items-center min-h-full">
    <div className="text-center font-heading font-bold text-lg w-1/4 mb-4">No data flowing</div>
    <div className="text-secondaryText">
      <ol className="list-decimal list-inside mb-2 ml-2 text-center">
        <li className="mb-4">Get <NavLink to="/api_keys">API key, or create a new one</NavLink></li>
        <li>
          Use one of the following libraries and APIs to send events to Jitsu
          <div className="flex flex-row justify-center flex-wrap items-center pt-6">
            {Object.values(jitsuClientLibraries).map(props => <div className="mx-3 my-4" key={props.name}><JitsuClientLibraryCard {...props}  /></div>)}
          </div>
        </li>
      </ol>
    </div>
  </div>;
}

function processEvents(data: { destinationId: string; events: any }[]) {
  let eventsIndex: Record<string, Event> = {};
  data.forEach(dst => {
    dst.events.events.forEach(event => {
      const eventId = getEventId(event.original);
      let normalizedEvent = eventsIndex[eventId];
      if (!normalizedEvent) {
        normalizedEvent = newEvent(event.original)
        eventsIndex[eventId] = normalizedEvent;
      }
      normalizedEvent.destinationResults[dst.destinationId] = {
        status: event.success ?
          'success' :
          (event.error ?
            'error' :
            'pending'),
        rawJson: event.success || event.error
      }
    })
  })

  let events = [...Object.values(eventsIndex)];
  eventsIndex = {} //for GC

  return orderBy(events, (e) => e.timestamp).reverse();
}

function trim(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str
  } else {
    return str.substr(0, maxLen - 3) + '...';
  }
}

const TabTitle: React.FC<{icon: any, error?: boolean}> = ({ icon, error, children }) => {
  const maxLen = 10;
  const titleString = children.toString();
  const title = <div className="align-baseline flex items-center">
    <span className="inline-block h-6 w-6 pr-2">{icon}</span>
    <span>{trim(titleString, maxLen)}</span>
  </div>
  const content = titleString.length > maxLen ? <Tooltip title={children}>{title}</Tooltip> : title;
  return error ? <Badge count={'!'} size="small">{content}</Badge> : content;
}

const EventsView: React.FC<{event: Event, allDestinations: Record<string, DestinationData>}> = ({ event, allDestinations }) => {
  const codeProps = { className: 'bg-bgSecondary rounded-xl p-6 text-xs', language: 'json' };
  return <Tabs tabPosition="left" defaultActiveKey="original">
    <Tabs.TabPane tab={<TabTitle icon={<svg fill="currentColor"  viewBox="0 0 50 50" width="100%" height="100%"><path d="M 17.226563 46.582031 C 17.105469 46.582031 16.984375 46.5625 16.871094 46.519531 C 7.976563 43.15625 2 34.507813 2 25 C 2 12.316406 12.316406 2 25 2 C 37.683594 2 48 12.316406 48 25 C 48 34.507813 42.023438 43.15625 33.128906 46.519531 C 32.882813 46.613281 32.605469 46.605469 32.363281 46.492188 C 32.121094 46.386719 31.933594 46.183594 31.839844 45.9375 L 26.890625 32.828125 C 26.695313 32.3125 26.953125 31.734375 27.472656 31.539063 C 30.179688 30.519531 32 27.890625 32 25 C 32 21.140625 28.859375 18 25 18 C 21.140625 18 18 21.140625 18 25 C 18 27.890625 19.820313 30.519531 22.527344 31.539063 C 23.046875 31.734375 23.304688 32.3125 23.109375 32.828125 L 18.160156 45.933594 C 18.066406 46.183594 17.878906 46.382813 17.636719 46.492188 C 17.507813 46.554688 17.367188 46.582031 17.226563 46.582031 Z"/></svg>}>
      original
    </TabTitle>} key="original">
      <Code {...codeProps}>
        {JSON.stringify(event.rawJson, null, 2)}
      </Code>
    </Tabs.TabPane>
    {Object.entries(event.destinationResults).map(([destinationId, result]) => {

      const destination = allDestinations[destinationId];
      const destinationType = destinationsReferenceMap[destination._type];

      const error = result.status === 'error';
      const pending = result.status === 'pending';
      return <Tabs.TabPane tab={<TabTitle error={error} icon={destinationType.ui.icon}>{destination._id}</TabTitle>} key={destinationId}>
        {error ?
          <div className="font-monospace flex justify-center items-center text-error">
            {JSON.stringify(result.rawJson)} (error)
          </div> :
          (pending ?
            <div className="font-monospace flex justify-center items-center text-warning">
              Event is in queue and hasn't been sent to {destination._id} yet
            </div> :
            <Code {...codeProps}>
              {JSON.stringify(result.rawJson, null, 2)}
            </Code>)}
      </Tabs.TabPane>
    })}
  </Tabs>
}

const EventsList: React.FC<{events: Event[], allDestinations: Record<string, DestinationData>}> = ({ events , allDestinations }) => {
  const [selectedEvent, setSelectedEvent] = useState(null);
  let selectedEventObject = null;
  return <div className="w-full">
    {events.map(event => {
      const active = event.eventId === selectedEvent;
      const hasSuccessEvent = !!Object.values(event.destinationResults).find(dest => dest.status === 'success')
      const hasFailedEvent = !!Object.values(event.destinationResults).find(dest => dest.status === 'error')
      return <div key={event.eventId}><div
        className={`overflow-hidden flex flex-row border-b border-secondaryText border-opacity-50 items-center cursor-pointer h-12 ${selectedEvent === event.eventId ?
          'bg-bgSecondary' :
          'hover:bg-bgComponent'}`}
        key="header"
        onClick={() => setSelectedEvent(active ? null : event.eventId)}
      >
        <div className="w-6 flex items-center justify-center px-3 text-lg" key="icon">
          <Tooltip title={hasFailedEvent ? 'Failed - at least one destination load is failed' : (hasSuccessEvent ? 'Success - succesfully sent to all destinations' : 'Pending - status of some destinations is unknown')}>
            {hasFailedEvent ? <ExclamationCircleOutlined className="text-error" /> : (hasSuccessEvent ? <CheckCircleOutlined className="text-success" /> : <QuestionCircleOutlined className="text-warning" />)}
          </Tooltip>
        </div>
        <div className={`text-xxs whitespace-nowrap text-secondaryText px-1 ${styles.jsonPreview}`} key="time">
          <div>{event.timestamp.format('YYYY-MM-DD hh:mm:ss')} UTC</div>
          <div className="text-xxs">{event.timestamp.fromNow()}</div>
        </div>
        <div className="pl-4 text-3xs text-secondaryText font-monospace overflow-hidden h-12 leading-4 flex-shrink"  key="json">
          {JSON.stringify(event.rawJson)}
        </div>
        <div className="w-12 text-testPale flex items-center justify-center px-2 text-xl" key="expand">
          {active ?
            <DownCircleOutlined /> :
            <RightCircleOutlined /> }

        </div>
      </div>
      <div key="details">{active && <EventsView event={event} allDestinations={allDestinations} />}</div>

      </div>;
    })}
  </div>
}

const EventStreamComponent = () => {
  const services = useServices();
  const destinationsMap: Record<string, DestinationData> = destinationsStore.allDestinations.reduce((index, dst) => {
    index[dst._uid] = dst;
    return index;
  }, {});

  const promises = Object.values(destinationsMap).map(dst => {
    return services.backendApiClient.get(
      `/events/cache?project_id=${services.activeProject.id}&limit=500&destination_ids=${services.activeProject.id}.${dst._uid}`,
      { proxy: true }
    ).then((events) => {
      return { events, destinationId: dst._uid }
    });
  });
  const [error, data] = useLoader(() => Promise.all(promises));
  if (error) {
    return <CenteredError error={error} />
  } else if (!data) {
    return <CenteredSpin />
  }
  let events = processEvents(data);

  if (events.length === 0) {
    return <NoDataFlowing />
  }

  return <EventsList events={events} allDestinations={destinationsMap} />

}

const EventStream = observer(EventStreamComponent);

EventStream.displayName = 'EventStream';

export default EventStream;