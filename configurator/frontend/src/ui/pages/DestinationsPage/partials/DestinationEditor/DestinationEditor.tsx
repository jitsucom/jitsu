// @Libs
import React, { useCallback, useMemo, useRef } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Button, Form } from 'antd';
import cn from 'classnames';
import { camelCase } from 'lodash';
// @Components
import { TabsConfigurator } from '@molecule/TabsConfigurator';
import { ComingSoon } from '@atom/ComingSoon';
import { DestinationEditorConfig } from './DestinationEditorConfig';
// @CatalogDestinations
import * as destinationsCatalog from '@catalog/destinations/lib';
// @Types
import { Destination } from '@catalog/destinations/types';
import { Tab } from '@molecule/TabsConfigurator/TabsConfigurator.types';
import { FormInstance } from 'antd/es';
// @Styles
import styles from './DestinationEditor.module.less'
import { makeObjectFromFieldsValues } from '@util/Form';

const DestinationEditor = () => {
  const params = useParams<{ type: string; }>();

  const destinationReference = useMemo<Destination>(() => destinationsCatalog[`${camelCase(params.type)}Destination`], [params.type]);

  const destinationsTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    getComponent: (form: FormInstance<any>) => <DestinationEditorConfig form={form} destination={destinationReference} />,
    form: Form.useForm()[0]
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

  const handleSubmit = useCallback(() => {
    const form = destinationsTabs.current[0].form;
    console.log('values: ', makeObjectFromFieldsValues(form.getFieldsValue()));
  }, []);

  return (
    <div>
      <div className=""><h2><NavLink to="/destinations">Destinations</NavLink> / <span style={{ display: 'inline-block', width: '32px', height: '32px' }}>{destinationReference.ui.icon}</span> Edit {destinationReference.displayName} connection (id: {destinationReference.id})</h2></div>

      <div className={cn('flex-grow', styles.mainArea)}>
        <TabsConfigurator type="card" className={styles.tabCard} tabsList={destinationsTabs.current} />
      </div>

      <div className="flex-shrink border-t pt-2">
        <Button type="primary" size="large" className="mr-3" htmlType="button" onClick={handleSubmit}>Save</Button>
      </div>
    </div>
  );
};

DestinationEditor.displayName = 'DestinationEditor';

export { DestinationEditor }
