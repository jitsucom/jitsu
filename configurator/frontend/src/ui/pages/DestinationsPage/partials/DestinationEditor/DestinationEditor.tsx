// @Libs
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prompt, useHistory, useParams } from 'react-router-dom';
import { Form, message } from 'antd';
import cn from 'classnames';
// @Components
import { TabsConfigurator } from '@molecule/TabsConfigurator';
import { EditorButtons } from '@molecule/EditorButtons';
import { ComingSoon } from '@atom/ComingSoon';
import { PageHeader } from '@atom/PageHeader';
import { DestinationEditorConfig } from './DestinationEditorConfig';
import { DestinationEditorSources } from './DestinationEditorSources';
// @CatalogDestinations
import { destinationsReferenceMap } from '@page/DestinationsPage/commons';
// @Types
import { FormInstance } from 'antd/es';
import { Destination } from '@catalog/destinations/types';
import { Tab } from '@molecule/TabsConfigurator/TabsConfigurator';
import { CommonDestinationPageProps } from '@page/DestinationsPage/DestinationsPage';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Styles
import styles from './DestinationEditor.module.less';
// @Utils
import { makeObjectFromFieldsValues } from '@util/Form';
import { destinationEditorUtils } from '@page/DestinationsPage/partials/DestinationEditor/DestinationEditor.utils';
import { getUniqueAutoIncId, randomId } from '@util/numbers';

const DestinationEditor = ({ destinations, setBreadcrumbs, updateDestinations }: CommonDestinationPageProps) => {
  const history = useHistory();

  const params = useParams<{ type?: string; id?: string; }>();

  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [testConnectingPopover, switchTestConnectingPopover] = useState<boolean>(false);
  const [destinationSaving, setDestinationSaving] = useState<boolean>(false);

  const destinationData = useRef<DestinationData>(
    destinations.find(dst => dst._id === params.id) || {
      _id: getUniqueAutoIncId(params.type, destinations.map(dst => dst._type)),
      _uid: randomId(),
      _type: params.type,
      _mappings: { _keepUnmappedFields: true, _mappings: [] },
      _comment: null,
      _onlyKeys: []
    } as DestinationData
  );

  const destinationReference = useMemo<Destination>(() => {
    if (params.type) {
      return destinationsReferenceMap[params.type]
    }

    return destinationsReferenceMap[destinationData.current._type];
  }, [params.type]);

  const services = useMemo(() => ApplicationServices.get(), []);

  const touchedFields = useRef<boolean>(false);

  const destinationsTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    getComponent: (form: FormInstance) => <DestinationEditorConfig handleTouchAnyField={setTouchedFields} form={form} destinationReference={destinationReference} destinationData={destinationData.current} />,
    form: Form.useForm()[0]
  },
  {
    key: 'mappings',
    name: <ComingSoon render="Mappings"  documentation={<>Edit destination mappings</>} />,
    isDisabled: true
  },
  {
    key: 'sources',
    name: 'Connectors',
    getComponent: (form: FormInstance) => <DestinationEditorSources form={form} />,
    form: Form.useForm()[0]
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

  const setTouchedFields = useCallback((value: boolean) => {
    touchedFields.current = value
  }, []);

  const getPromptMessage = useCallback(() => touchedFields.current
    ? 'You have unsaved changes. Are you sure you want to leave the page?'
    : undefined, []);

  const handleCancel = useCallback(() => history.push(destinationPageRoutes.root), [history]);

  const testConnectingPopoverClose = useCallback(() => switchTestConnectingPopover(false), []);

  const validateTabForm = useCallback(async(tab: Tab) => {
    const form = tab.form;

    try {
      return await form.validateFields();
    } catch (errors) {
      // ToDo: check errors count for fields with few validation rules
      tab.errorsCount = errors.errorFields?.length;

      throw errors;
    }
  }, []);

  const handleTestConnection = useCallback(async() => {
    setTestConnecting(true);

    const tab = destinationsTabs.current[0];
    const form = tab.form;

    try {
      const config = await form.validateFields();

      destinationData.current._formData = makeObjectFromFieldsValues<DestinationData>(config)._formData;

      await destinationEditorUtils.testConnection(destinationData.current);
    } catch (error) {
    } finally {
      setTestConnecting(false);
    }
  }, [destinationData]);

  const handleSubmit = useCallback(() => {
    setDestinationSaving(true);

    Promise
      .all(destinationsTabs.current.filter((tab: Tab) => !!tab.form).map((tab: Tab, index: number) => validateTabForm(tab)))
      .then(async allValues => {
        destinationData.current._formData = makeObjectFromFieldsValues<DestinationData>(allValues[0])._formData;

        try {
          await destinationEditorUtils.testConnection(destinationData.current);

          const newDestinationsList = [...destinations, destinationData.current];

          await services.storageService.save('destinations', { destinations: newDestinationsList }, services.activeProject.id);

          updateDestinations({ destinations: newDestinationsList });

          setTouchedFields(false);

          history.push(destinationPageRoutes.root);

          message.success('New destination has been added!');
        } catch (errors) {
          console.log('errors: ', errors);
        } finally {
          setDestinationSaving(false);
        }
      })
      .catch(errors => console.log(errors));
  }, [history, services, validateTabForm, destinations, setTouchedFields, updateDestinations]);

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Destinations', link: destinationPageRoutes.root },
        {
          title: <PageHeader title={destinationReference.displayName} icon={destinationReference.ui.icon} mode="edit" />
        }
      ]
    }));
  }, [destinationReference, setBreadcrumbs])

  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto', styles.wrapper)}>
        <div className={cn('flex-grow', styles.mainArea)}>
          <TabsConfigurator type="card" className={styles.tabCard} tabsList={destinationsTabs.current} defaultTabIndex={2} />
        </div>

        <div className="flex-shrink border-t pt-2">
          <EditorButtons
            handleSubmit={handleSubmit}
            handleTestConnection={handleTestConnection}
            testConnectingPopoverClose={testConnectingPopoverClose}
            handleCancel={handleCancel}
            destinationSaving={destinationSaving}
            testConnecting={testConnecting}
            isTestConnectingPopoverVisible={testConnectingPopover && destinationsTabs.current[0].errorsCount > 0}
          />
        </div>
      </div>

      <Prompt message={getPromptMessage}/>
    </>
  );
};

DestinationEditor.displayName = 'DestinationEditor';

export { DestinationEditor }
