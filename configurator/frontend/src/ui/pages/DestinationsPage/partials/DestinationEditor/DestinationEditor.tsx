// @Libs
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Prompt, useHistory, useParams } from 'react-router-dom';
import { Form } from 'antd';
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
// @Utils, @Hooks, @Services
import ApplicationServices from '@service/ApplicationServices';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Styles
import styles from './DestinationEditor.module.less';

const DestinationEditor = ({ destinations, setBreadcrumbs }: CommonDestinationPageProps) => {
  const history = useHistory();

  const params = useParams<{ type?: string; id?: string; }>();

  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [testConnectingPopover, switchTestConnectingPopover] = useState<boolean>(false);
  const [destinationSaving, setDestinationSaving] = useState<boolean>(false);

  const destinationData = useMemo<DestinationData>(() => destinations.find(dst => dst._id === params.id) ?? {} as DestinationData, [destinations, params.id]);

  const destinationReference = useMemo<Destination>(() => {
    if (params.type) {
      return destinationsReferenceMap[params.type]
    }

    return destinationsReferenceMap[destinationData._type];
  }, [destinationData, params.type]);

  const services = useMemo(() => ApplicationServices.get(), []);

  const touchedFields = useRef<boolean>(false);

  const destinationsTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    getComponent: (form: FormInstance) => <DestinationEditorConfig handleTouchAnyField={setTouchedFields} form={form} destinationReference={destinationReference} destinationData={destinationData} />,
    form: Form.useForm()[0]
  },
  {
    key: 'mappings',
    name: <ComingSoon render="Mappings"  documentation={<>Edit destination mappings</>} />,
    isDisabled: true
  },
  {
    key: 'sources',
    name: 'Connected sources',
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

      // DestinationData.update({ ...makeObjectFromFieldsValues(config) });

      // console.log('DestinationData: ', DestinationData);

      // const dest = Object.assign(DestinationData, { ...makeObjectFromFieldsValues(config) });
      //
      // console.log('dest: ', dest);
      //
      // destinationEditorUtils.testConnection(dest);
      //
      // console.log('testConnection: ', testConnection);
    } catch (errors) {
      // setConnectionTestResult
      // console.log('errors: ', errors);
    } finally {
      setTestConnecting(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    setDestinationSaving(true);

    Promise
      .all(destinationsTabs.current.filter((tab: Tab) => !!tab.form).map((tab: Tab, index: number) => validateTabForm(tab)))
      .then(async allValues => {
        // const { connectCmd, title } = destinationReference.ui;
        // const _formData = makeObjectFromFieldsValues(allValues[0]);

        // const newDestinationBlank = Object.assign(
        //   DestinationData,
        //   {
        //     ..._formData,
        //     _description: {
        //       displayURL: title(_formData),
        //       commandLineConnect: connectCmd(_formData)
        //     }
        //   }
        // );
        //
        // try {
        //   await services.storageService.save('destinations', { destinations: [...destinations, newDestinationBlank] }, services.activeProject.id);
        //
        //   setTouchedFields(false);
        //
        //   history.push(destinationPageRoutes.root);
        //
        //   message.success('New destination has been added!');
        // } catch (errors) {
        //   console.log('errors: ', errors);
        // } finally {
        //   setDestinationSaving(false);
        // }
      })
      .catch(errors => console.log(errors));
  }, [history, services, params.type, validateTabForm, destinationReference, destinations, setTouchedFields]);

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
      <div className={cn('flex flex-col items-stretch', styles.wrapper)}>
        <div className={cn('flex-grow', styles.mainArea)}>
          <TabsConfigurator type="card" className={styles.tabCard} tabsList={destinationsTabs.current} defaultTabIndex={0} />
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
