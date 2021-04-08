// import cloneDeep from 'lodash/cloneDeep';
// import { useParams, NavLink, useHistory, Prompt } from 'react-router-dom';
// import ApplicationServices from '@./lib/services/ApplicationServices';
// import { DestinationConfig, destinationConfigTypes, destinationsByTypeId } from '@./lib/services/destinations';
// import { loadDestinations } from '@page/DestinationsPage/commons';
// import { CenteredError, CenteredSpin, handleError } from '@./lib/components/components';
// import { Button, Form, message, Tabs, Tooltip } from 'antd';
// import useLoader from '@./lib/commons/useLoader';
// import * as React from 'react';
// import DestinationsList, { getIconSrc } from '@page/DestinationsPage/partials/DestinationsList/DestinationsList';
// import ConnectionPropertiesTab from '@page/DestinationsPage/partials/ConnectionProperties/ConnectionPropertiesTab';
// import classNames from 'classnames';
// import { ReactNode, useState } from 'react';
// import QuestionCircleOutlined from '@ant-design/icons/lib/icons/QuestionCircleOutlined';
// import Marshal from '@./lib/commons/marshalling';
// import { MappingEditor } from '@page/DestinationsPage/partials/MappingEditor/MappingEditor';
//
// export type Callback<T> = (p: T) => void
//
// function pickId(type: string, destinations: DestinationConfig[]) {
//   let id = type;
//   let baseId = type;
//   let counter = 1;
//   while (destinations.find((el) => el.id == id) !== undefined) {
//     id = baseId + counter;
//     counter++;
//   }
//   return id;
// }
//
// export function ComingSoon({ children, documentation }: { children: ReactNode, documentation: ReactNode }) {
//   return <>
//     <Tooltip title={documentation}>
//       {children}
//       <sup>
//         <i>Coming Soon!</i>
//       </sup>
//     </Tooltip>
//   </>
// }
//
// function DestinationEditor() {
//   const params = useParams<{ id?: string, type?: string }>();
//   const destinationId = params.id;
//   const history = useHistory();
//   const [activeTabKey, setActiveTabKey] = useState('config')
//   let [modCount, setModCount] = useState(0);
//   let [connectionTesting, setTestingConnection] = useState(false);
//   let [form] = Form.useForm();
//   const [sourcesError, sources, updateSources] = useLoader<DestinationConfig>(async() => {
//     return await ApplicationServices.get().storageService.get('sources', ApplicationServices.get().activeProject.id)
//   });
//
//   const [destinationError, destination, updateDestination] = useLoader<DestinationConfig>(async() => {
//     let destinations = await loadDestinations(ApplicationServices.get());
//
//     let destination: DestinationConfig;
//
//     if (params.id) {
//       destination = destinations.find(dest => dest.id === params.id);
//       if (!destination) {
//         new Error(`Unknown destination id: ${destinationId}. All destinations: ${JSON.stringify(destinations, null, 2)}`)
//       }
//     } else if (params.type) {
//       destination = destinationsByTypeId[params.type].factory(pickId(params.type, destinations))
//     } else {
//       throw new Error(':type of :id should present')
//     }
//     return destination;
//   }
//   );
//
//   if (sourcesError || destinationError) {
//     return <CenteredError error={sourcesError || destinationError}/>
//   } else if (!destination || !sources) {
//     return <CenteredSpin/>
//   } else {
//     let type = destinationsByTypeId[destination.type];
//
//     let img = <img
//       src={getIconSrc(type.type)} className="h-6 align-baseline ml-2" alt="[destination]"
//     />;
//     return <div className={classNames('flex flex-col items-stretch', styles.wrapper)}>
//       <div className=""><h2><NavLink to="/destinations">Destinations</NavLink> / {img} Edit {type.name} connection
//         (id: {destination.id})</h2></div>
//       <div className={classNames('flex-grow', styles.mainArea)}>
//         <Tabs type="card" className={styles.tabCard} activeKey={activeTabKey} onChange={(key) => setActiveTabKey(key)}>
//           <Tabs.TabPane key="config" tab="Connection Properties">
//             <ConnectionPropertiesTab form={form} destination={destination}
//               onModification={() => setModCount(modCount + 1)}/>
//           </Tabs.TabPane>
//           <Tabs.TabPane key="mappings" tab="Mappings">
//             <MappingEditor mappings={destination.mappings} onChange={(mappings) => {
//               destination.mappings = mappings;
//               updateDestination(destination);
//               setModCount(modCount + 1);
//             }} />
//
//           </Tabs.TabPane>
//         </Tabs>
//       </div>
//       <div className="flex-shrink border-t pt-2">
//         <Button type="primary" size="large" className="mr-3">Save</Button>
//         <Button type="default" onClick={async() => {
//           setTestingConnection(true);
//           let values;
//           try {
//             values = await form.validateFields();
//           } catch (e) {
//             setTestingConnection(false);
//             setActiveTabKey('config')
//             return;
//           }
//           try {
//             destination.update(values);
//             await ApplicationServices.get().backendApiClient.post(
//               '/destinations/test',
//               Marshal.toPureJson(destination)
//             );
//             message.success('Successfully connected!');
//             updateDestination(destination);
//             setTestingConnection(false);
//           } catch (e) {
//             handleError(e, 'Failed to validate connection');
//             setTestingConnection(false);
//           }
//         }} size="large"  className="mr-3" loading={connectionTesting}>Test Connection</Button>
//         <Button type="default" size="large" onClick={() => {
//           history.push('/destinations')
//         }} danger>Cancel</Button>
//       </div>
//       <Prompt message={() => {
//         if (modCount > 0) {
//           return 'You have unsaved changes. Are you sure you want to leave the page?'
//         }
//       }}/>
//     </div>
//   }
// }
//
// export default DestinationEditor;

// @Libs
import React, { useMemo, useRef } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import cn from 'classnames';
// @Components
import { TabsConfigurator } from '@molecule/TabsConfigurator';
import { ComingSoon } from '@atom/ComingSoon';
import { DestinationEditorConfig } from './DestinationEditorConfig';
// @CatalogDestinations
import * as destinationsCatalog from '@catalog/destinations/lib';
// @Types
import { Destination } from '@catalog/destinations/types';
import { Tab } from '@molecule/TabsConfigurator/TabsConfigurator.types';
// @Styles
import styles from './DestinationEditor.module.less'

const DestinationEditor = () => {
  const params = useParams<{ type: string; }>();

  const destinationReference = useMemo<Destination>(() => destinationsCatalog[`${params.type}Destination`], [params.type]);

  const destinationsTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    component: <DestinationEditorConfig destination={destinationReference} />
  },
  {
    key: 'mappings',
    name: 'Mappings'
  },
  {
    key: 'sources',
    name: <ComingSoon render="Connected sources" documentation={<>Edit sources which will send data to the destination</>} />,
    isDisabled: true
  },
  {
    key: 'settings',
    name: <ComingSoon render="Settings Library" documentation={<>A predefined library of settings such as <a href="https://jitsu.com/docs/other-features/segment-compatibility" target="_blank" rel="noreferrer">Segment-like schema</a></>} />,
    isDisabled: true
  },
  {
    key: 'statistics',
    name: <ComingSoon render="Statistics" documentation={<>A detailed statistics on how many events have been sent to the destinations</>} />,
    isDisabled: true
  }]);

  return (
    <div>
      <div className=""><h2><NavLink to="/destinations">Destinations</NavLink> / <span style={{ display: 'inline-block', width: '32px', height: '32px' }}>{destinationReference.ui.icon}</span> Edit {destinationReference.displayName} connection (id: {destinationReference.id})</h2></div>

      <div className={cn('flex-grow', styles.mainArea)}>
        <TabsConfigurator type="card" className={styles.tabCard} tabsList={destinationsTabs.current} />
      </div>
    </div>
  );
};

DestinationEditor.displayName = 'DestinationEditor';

export { DestinationEditor }
