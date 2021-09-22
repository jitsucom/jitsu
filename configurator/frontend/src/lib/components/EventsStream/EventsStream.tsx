import { destinationsStore } from '../../../stores/destinations';
import { observer } from 'mobx-react-lite';
import { useServices } from '../../../hooks/useServices';
import useLoader from '../../../hooks/useLoader';
import { NavLink, useHistory, useLocation, useParams } from 'react-router-dom';
import { ErrorCard } from '../ErrorCard/ErrorCard';
import { CenteredError, CenteredSpin, CodeInline, CodeSnippet, Preloader } from '../components';
import { Badge, Button, Checkbox, Popover, Skeleton, Table, Tabs, Tooltip, Typography } from 'antd';
import { jitsuClientLibraries, default as JitsuClientLibraryCard } from '../JitsuClientLibrary/JitsuClientLibrary';
import { Moment, default as moment } from 'moment';
import orderBy from 'lodash/orderBy';
import CheckCircleOutlined from '@ant-design/icons/lib/icons/CheckCircleOutlined';
import { useState, ReactElement, useEffect } from 'react';
import { destinationsReferenceMap } from '../../../catalog/destinations/lib';
import styles from './EventsSteam.module.less'
import murmurhash from 'murmurhash';
import RightCircleOutlined from '@ant-design/icons/lib/icons/RightCircleOutlined';
import { DownCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Code } from '../Code/Code';
import classNames from 'classnames';
import cn from 'classnames';
import { reactElementToString } from '../../commons/utils';
import { useForceUpdate } from '../../../hooks/useForceUpdate';

type Event = {
  timestamp: Moment,
  eventId: string,
  rawJson: any
  destinationResults: Record<string, DestinationStatus>
}

type DestinationStatus = {
  status: 'success' | 'error' | 'pending' | 'skip'
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
      let status
      if (event.success) {
        status = 'success'
      } else if (event.error) {
        status = 'error';
      } else if (event.skip) {
        status = 'skip'
      } else {
        status = 'pending'
      }
      normalizedEvent.destinationResults[dst.destinationId] = {
        status,
        rawJson: event.success || event.error || event.skip
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

const TabTitle: React.FC<{ icon: any, error?: boolean }> = ({ icon, error, children }) => {
  const maxLen = 10;
  const titleString = children.toString();
  const title = <div className="align-baseline flex items-center">
    <span className="inline-block h-6 w-6 pr-2">{icon}</span>
    <span>{trim(titleString, maxLen)}</span>
  </div>
  const content = titleString.length > maxLen ?
    <Tooltip title={children}>{title}</Tooltip> :
    title;
  return error ?
    <Badge count={'!'} size="small">{content}</Badge> :
    content;
}

/**
 * Displays string as is, if len is lesser than len. Or trims the string (middle chars) and displays tooltip
 * @param len
 * @param children
 */
const MaxLen: React.FC<{len: number}> = ({ len, children }) => {
  const string = reactElementToString(children);
  if (string.length <= len) {
    return <>{children}</>;
  } else {
    //technically it's not correct, we need to refactor that more carefully to handle
    //odd / even nulbers well
    const prefixLen = len / 2 - 2;
    const suffixLen = len / 2 - 2;
    return <Tooltip title={children}>{string.substr(0, prefixLen) + '...' + string.substr(-suffixLen)}</Tooltip>
  }
}

const EventsView: React.FC<{ event: Event, className?: string, allDestinations: Record<string, DestinationData> }> = ({ event, allDestinations, className }) => {

  const codeProps = { className: 'bg-bgSecondary rounded-xl p-6 text-xs', language: 'json' };
  const [opacityStyle, setOpacityStyle] = useState('opacity-0');
  useEffect(() => {
    setTimeout(() => {
      setOpacityStyle('opacity-100')
    }, 0);
  })
  return <Tabs tabPosition="left" defaultActiveKey="original" className={cn(className, opacityStyle, 'transition-all duration-1000')}>
    <Tabs.TabPane tab={<TabTitle icon={<svg fill="currentColor" viewBox="0 0 50 50" width="100%" height="100%">
      <path
        d="M 17.226563 46.582031 C 17.105469 46.582031 16.984375 46.5625 16.871094 46.519531 C 7.976563 43.15625 2 34.507813 2 25 C 2 12.316406 12.316406 2 25 2 C 37.683594 2 48 12.316406 48 25 C 48 34.507813 42.023438 43.15625 33.128906 46.519531 C 32.882813 46.613281 32.605469 46.605469 32.363281 46.492188 C 32.121094 46.386719 31.933594 46.183594 31.839844 45.9375 L 26.890625 32.828125 C 26.695313 32.3125 26.953125 31.734375 27.472656 31.539063 C 30.179688 30.519531 32 27.890625 32 25 C 32 21.140625 28.859375 18 25 18 C 21.140625 18 18 21.140625 18 25 C 18 27.890625 19.820313 30.519531 22.527344 31.539063 C 23.046875 31.734375 23.304688 32.3125 23.109375 32.828125 L 18.160156 45.933594 C 18.066406 46.183594 17.878906 46.382813 17.636719 46.492188 C 17.507813 46.554688 17.367188 46.582031 17.226563 46.582031 Z"/>
    </svg>}>
      original
    </TabTitle>} key="original">
      <Code {...codeProps}>
        {JSON.stringify(event.rawJson, null, 2)}
      </Code>
    </Tabs.TabPane>
    {Object.entries(event.destinationResults).map(([destinationId, result]) => {

      const destination = allDestinations[destinationId];
      const destinationType = destinationsReferenceMap[destination._type];
      let display;
      if (result.status === 'error') {
        display = <div className="font-monospace flex justify-center items-center text-error">
          {JSON.stringify(result.rawJson)} (error)
        </div>
      } else if (result.status === 'pending') {
        display = <div className="font-monospace flex justify-center items-center text-warning">
          Event is in queue and hasn't been sent to {destination._id} yet
        </div>
      } else if (result.status === 'skip') {
        display =<div className="font-monospace flex justify-center items-center">Event was skipped: {JSON.stringify(result.rawJson)}</div>
      } else {
        display = getResultView(result.rawJson);
      }
      const error = result.status === 'error';
      const pending = result.status === 'pending';
      return <Tabs.TabPane tab={<TabTitle error={error} icon={destinationType.ui.icon}>{destination._id}</TabTitle>} key={destinationId}>
        {display}
      </Tabs.TabPane>
    })}
  </Tabs>
}

function getResultView(obj: any) {
  if (obj.table && obj.record && Array.isArray(obj.record)) {
    let data = [...obj.record];
    data = orderBy(data, 'field');
    return <div>
      The event has been recorded to table <CodeInline>{obj.table}</CodeInline> with following structure:
      <Table
        className="mt-4"
        pagination={false}
        size="small"
        columns={[{
          title: 'Column Name',
          dataIndex: 'field',
          key: 'field'
        }, {
          title: 'Column Type',
          dataIndex: 'type',
          key: 'type'
        }, {
          title: 'Value',
          dataIndex: 'value',
          key: 'value'
        }]}
        dataSource={data}
      />
    </div>
  }
  return <Code className="bg-bgSecondary rounded-xl p-6 text-xs" language="json">
    {JSON.stringify(obj, null, 2)}
  </Code>;

}

const EventsList: React.FC<{ destinationsFilter: string[], reloadCount: number }> = ({ destinationsFilter , reloadCount }) => {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const services = useServices();

  const destinationsMap: Record<string, DestinationData> = destinationsStore.allDestinations.reduce((index, dst) => {
    index[dst._uid] = dst;
    return index;
  }, {});

  const promises = Object.values(destinationsMap).filter(dst => destinationsFilter === null || destinationsFilter.includes(dst._uid)).map(dst => {
    return services.backendApiClient.get(
      `/events/cache?project_id=${services.activeProject.id}&limit=500&destination_ids=${services.activeProject.id}.${dst._uid}`,
      { proxy: true }
    ).then((events) => {
      return { events, destinationId: dst._uid }
    });
  });
  const [error, data, ,reload] = useLoader(() => Promise.all(promises), [destinationsFilter, reloadCount]);
  if (error) {
    return <CenteredError error={error}/>
  } else if (!data) {
    return <CenteredSpin/>
  }
  let events = processEvents(data);

  if (events.length === 0) {
    return <NoDataFlowing/>
  }

  return <div className="w-full">
    {events.map(event => {
      const active = event.eventId === selectedEvent;
      const hasFailedEvent = !!Object.values(event.destinationResults).find(dest => dest.status === 'error')
      const hasPendingEvent = !!Object.values(event.destinationResults).find(dest => dest.status === 'pending')
      return <div key={event.eventId}>
        <div
          className={`overflow-hidden w-full flex flex-row border-b border-secondaryText border-opacity-50 items-center cursor-pointer h-12 ${selectedEvent === event.eventId ?
            'bg-bgSecondary' :
            'hover:bg-bgComponent'}`}
          key="header"
          onClick={() => setSelectedEvent(active ?
            null :
            event.eventId)}
        >
          <div className="w-6 flex items-center justify-center px-3 text-lg" key="icon">
            <Tooltip title={hasFailedEvent ?
              'Failed - at least one destination load is failed' :
              (hasPendingEvent ?
                'Pending - status of some destinations is unknown' :
                'Success - succesfully sent to all destinations')}>
              {hasFailedEvent ?
                <ExclamationCircleOutlined className="text-error"/> :
                (hasPendingEvent ?
                  <QuestionCircleOutlined className="text-warning"/> :
                  <CheckCircleOutlined className="text-success"/>
                )}
            </Tooltip>
          </div>
          <div className={`text-xxs whitespace-nowrap text-secondaryText px-1 ${styles.jsonPreview}`} key="time">
            <div>{event.timestamp.format('YYYY-MM-DD hh:mm:ss')} UTC</div>
            <div className="text-xxs">{event.timestamp.fromNow()}</div>
          </div>
          <div className="pl-4 text-3xs text-secondaryText font-monospace overflow-hidden overflow-ellipsis h-12 leading-4 flex-shrink" key="json">
            {JSON.stringify(event.rawJson, null, 2)}
          </div>
          <div className={cn('w-12 text-testPale flex items-center justify-center px-2 text-xl transition-transform duration-500', active && 'transform rotate-90')} key="expand">
            <RightCircleOutlined/>
          </div>
        </div>
        <div key="details">{active && <EventsView event={event} allDestinations={destinationsMap} className="pb-6"/>}</div>
      </div>
    })}
  </div>
}

const EventStreamComponent = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [filterByIds, setFilterByIds] = useState(params.get('onlyIds') ? params.get('onlyIds').split(',') : null);
  const [reloadCount, setReloadCount] = useState(0)
  const history = useHistory();
  return <div>
    <div className="mb-6 flex justify-between">
      <DestinationsFilter initialFilter={filterByIds} allDestinations={destinationsStore.allDestinations} onChange={(ids) => {
        setFilterByIds(ids);
        history.push({ search: `onlyIds=${ids}` })
      }}/>
      <Button size="large" type="primary" onClick={() => {
        setReloadCount(reloadCount+1);
      }}>Reload</Button>
    </div>
    <EventsList destinationsFilter={filterByIds} reloadCount={reloadCount} />
  </div>
}

const DestinationsFilter: React.FC<{onChange: (destinations: string[]) => void, allDestinations: DestinationData[], initialFilter?: string[] }> = ({ initialFilter, onChange, allDestinations }) => {
  const [selectedIds, setSelectedIds] = useState(initialFilter || allDestinations.map(dst => dst._uid));
  const [popoverVisible, setPopoverVisible] = useState(false);
  const selectedAll = selectedIds.length === allDestinations.length;

  return <Popover  visible={popoverVisible} placement="bottom" title={null} content={
    <div className="w-96 h-96 overflow-y-hidden overflow-hidden pr-6">
      <div className="flex pb-4">
        <div className="flex-grow">
          <Button type="link" size="small" onClick={() => setSelectedIds(allDestinations.map(dst => dst._uid))}>Select All</Button>
          <Button type="link" size="small" onClick={() => setSelectedIds([])}>Clear Selection</Button>
        </div>
        <div className="flex justify-end">
          <Button type="link" size="small" onClick={() => {
            setPopoverVisible(false);
            onChange(selectedIds);
          }}>Apply</Button>
        </div>
      </div>
      <div className="flex flex-col h-96 overflow-y-auto pr-2">{allDestinations.map(dst => {
        const toggleCheckBox = () => {
          let newIds;
          if (selectedIds.includes(dst._uid)) {
            newIds = selectedIds.filter(el => el !== dst._uid);
          } else {
            newIds = [...selectedIds];
            newIds.push(dst._uid)
          }
          setSelectedIds(newIds)
        }
        const destinationType = destinationsReferenceMap[dst._type];
        return <div className="flex space-y-2" key={dst._uid}>
          <div onClick={toggleCheckBox} className="flex flex-nowrap items-center space-x-2 w-96">
            <span className="icon-size-base">{destinationType.ui.icon}</span>
            <span><MaxLen len={40}>{dst._id}</MaxLen></span>
          </div>
          <div><Checkbox checked={selectedIds.includes(dst._uid)} onClick={toggleCheckBox} /></div>

        </div>
      })}</div>
    </div>} trigger="click">
    <Button size="large" className="w-72" onClick={() => setPopoverVisible(!popoverVisible)}>Show Destinations: {selectedAll ? 'all' : `${selectedIds.length} out of ${allDestinations.length}`}</Button>
  </Popover>
}

const EventStream = observer(EventStreamComponent);

EventStream.displayName = 'EventStream';

export default EventStream;