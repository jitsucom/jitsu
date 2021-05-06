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
import { DestinationEditorConnectors } from './DestinationEditorConnectors';
import { DestinationEditorMappings } from './DestinationEditorMappings';
// @CatalogDestinations
import { destinationsReferenceMap } from '@page/DestinationsPage/commons';
// @Types
import { FormInstance } from 'antd/es';
import { Destination } from '@catalog/destinations/types';
import { Tab } from '@molecule/TabsConfigurator';
import { CommonDestinationPageProps } from '@page/DestinationsPage';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Routes
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @Styles
import styles from './DestinationEditor.module.less';
// @Utils
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
import { destinationEditorUtils } from '@page/DestinationsPage/partials/DestinationEditor/DestinationEditor.utils';
import { getUniqueAutoIncId, randomId } from '@util/numbers';
import { firstToLower } from '@./lib/commons/utils';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';

const DestinationEditor = ({ destinations, setBreadcrumbs, updateDestinations, editorMode, sources, sourcesError, updateSources }: CommonDestinationPageProps) => {
  const history = useHistory();

  const forceUpdate = useForceUpdate();

  const services = ApplicationServices.get();

  const params = useParams<{ type?: string; id?: string; tabName?: string; }>();

  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [testConnectingPopover, switchTestConnectingPopover] = useState<boolean>(false);

  const [savePopover, switchSavePopover] = useState<boolean>(false);
  const [destinationSaving, setDestinationSaving] = useState<boolean>(false);

  const destinationData = useRef<DestinationData>(
    destinations.find(dst => dst._id === params.id) || {
      _id: getUniqueAutoIncId(params.type, destinations.map(dst => dst._id)),
      _uid: randomId(),
      _type: params.type,
      _mappings: { _keepUnmappedFields: true },
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

  const submittedOnce = useRef<boolean>(false);

  const destinationsTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    getComponent: (form: FormInstance) =>
      <DestinationEditorConfig
        form={form}
        destinationReference={destinationReference}
        destinationData={destinationData.current}
        handleTouchAnyField={validateAndTouchField(0)}
      />,
    form: Form.useForm()[0],
    touched: false
  },
  {
    key: 'mappings',
    name: 'Mappings',
    getComponent: (form: FormInstance) =>
      <DestinationEditorMappings
        form={form}
        initialValues={destinationData.current?._mappings}
        handleTouchAnyField={validateAndTouchField(1)}
      />,
    form: Form.useForm()[0],
    touched: false
  },
  {
    key: 'sources',
    name: 'Linked Connectors & API Keys',
    getComponent: (form: FormInstance) =>
      <DestinationEditorConnectors
        form={form}
        initialValues={destinationData.current}
        destination={destinationReference}
        handleTouchAnyField={validateAndTouchField(2)}
        sources={sources}
        sourcesError={sourcesError}
      />,
    form: Form.useForm()[0],
    errorsLevel: 'warning',
    touched: false
  },
  {
    key: 'settings',
    name: <ComingSoon render="Settings Library" documentation={<>A predefined library of settings such as <a href="https://jitsu.com/docs/other-features/segment-compatibility" target="_blank" rel="noreferrer">Segment-like schema</a></>} />,
    isDisabled: true,
    touched: false
  },
  {
    key: 'statistics',
    name: <ComingSoon render="Statistics" documentation={<>A detailed statistics on how many events have been sent to the destinations</>} />,
    isDisabled: true,
    touched: false
  }]);

  const getPromptMessage = useCallback(() => destinationsTabs.current.some(tab => tab.touched)
    ? 'You have unsaved changes. Are you sure you want to leave the page?'
    : undefined, []);

  const handleCancel = useCallback(() => history.push(destinationPageRoutes.root), [history]);

  const testConnectingPopoverClose = useCallback(() => switchTestConnectingPopover(false), []);
  const savePopoverClose = useCallback(() => switchSavePopover(false), []);

  const validateTabForm = useCallback(async(tab: Tab) => {
    const form = tab.form;

    try {
      if (tab.key === 'sources') {
        const _sources = form.getFieldsValue()?._sources;

        if (!_sources) {
          tab.errorsCount = 1;
        }
      }

      tab.errorsCount = 0;

      return await form.validateFields();
    } catch (errors) {
      // ToDo: check errors count for fields with few validation rules
      tab.errorsCount = errors.errorFields?.length;

      throw errors;
    } finally {
      forceUpdate();
    }
  }, [forceUpdate]);

  const validateAndTouchField = useCallback(
    (index: number) => (value: boolean) => {
      destinationsTabs.current[index].touched = value === undefined ? true : value;

      if (submittedOnce.current) {
        validateTabForm(destinationsTabs.current[index]);
      }
    },
    [validateTabForm]
  );

  const handleTestConnection = useCallback(async() => {
    setTestConnecting(true);

    const tab = destinationsTabs.current[0];

    try {
      const config = await validateTabForm(tab);

      destinationData.current._formData = makeObjectFromFieldsValues<DestinationData>(config)._formData;

      await destinationEditorUtils.testConnection(destinationData.current);
    } catch (error) {
      switchTestConnectingPopover(true);
    } finally {
      setTestConnecting(false);
      forceUpdate();
    }
  }, [validateTabForm, forceUpdate]);

  const handleSubmit = useCallback(() => {
    submittedOnce.current = true;

    setDestinationSaving(true);

    Promise
      .all(destinationsTabs.current.filter((tab: Tab) => !!tab.form).map((tab: Tab) => validateTabForm(tab)))
      .then(async allValues => {
        destinationData.current = {
          ...destinationData.current,
          ...allValues.reduce((result: any, current: any) => {
            return {
              ...result,
              ...makeObjectFromFieldsValues(current)
            };
          }, {})
        };

        try {
          const updatedSources = await destinationEditorUtils.updateSources(sources, destinationData.current, services.activeProject.id);
          updateSources({ sources: updatedSources });
        } catch (error) {}

        // ToDo: remove this code after _mappings refactoring
        destinationData.current = {
          ...destinationData.current,
          _mappings: {
            ...destinationData.current._mappings,
            _keepUnmappedFields: Boolean(destinationData.current._mappings._keepUnmappedFields)
          }
        };

        try {
          await destinationEditorUtils.testConnection(destinationData.current, true);

          const payload = {
            destinations: editorMode === 'add'
              ? [...destinations, destinationData.current]
              : destinations.reduce((accumulator: DestinationData[], current: DestinationData) => [
                ...accumulator,
                current._uid !== destinationData.current._uid
                  ? current
                  : destinationData.current
              ], [])
          };

          await services.storageService.save('destinations', payload, services.activeProject.id);

          updateDestinations(payload);

          destinationsTabs.current.forEach((tab: Tab) => tab.touched = false);

          if (destinationData.current._connectionTestOk) {
            message.success('New destination has been added!');
          } else {
            message.warn(
              `Destination has been saved, but test has failed with '${firstToLower(
                destinationData.current._connectionErrorMessage
              )}'. Data will not be piped to this destination`,
              10
            );
          }

          history.push(destinationPageRoutes.root);
        } catch (errors) {}
      })
      .catch((errors) => {
        switchSavePopover(true);
      })
      .finally(() => {
        setDestinationSaving(false);
        forceUpdate();
      });
  }, [sources, history, validateTabForm, destinations, updateDestinations, forceUpdate, editorMode, services.activeProject.id, services.storageService, updateSources]);

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Destinations', link: destinationPageRoutes.root },
        {
          title: <PageHeader title={destinationReference.displayName} icon={destinationReference.ui.icon} mode="edit" />
        }
      ]
    }));
  }, [destinationReference, setBreadcrumbs]);

  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto', styles.wrapper)}>
        <div className={cn('flex-grow', styles.mainArea)} id="dst-editor-tabs">
          <TabsConfigurator
            type="card"
            className={styles.tabCard}
            tabsList={destinationsTabs.current}
            defaultTabIndex={0}
          />
        </div>

        <div className="flex-shrink border-t pt-2">
          <EditorButtons
            save={{
              isRequestPending: destinationSaving,
              isPopoverVisible: savePopover && destinationsTabs.current.some((tab: Tab) => tab.errorsCount > 0),
              handlePress: handleSubmit,
              handlePopoverClose: savePopoverClose,
              titleText: 'Destination editor errors',
              tabsList: destinationsTabs.current
            }}
            test={{
              isRequestPending: testConnecting,
              isPopoverVisible: testConnectingPopover && destinationsTabs.current[0].errorsCount > 0,
              handlePress: handleTestConnection,
              handlePopoverClose: testConnectingPopoverClose,
              titleText: 'Connection Properties errors',
              tabsList: [destinationsTabs.current[0]]
            }}
            handleCancel={handleCancel}
          />
        </div>
      </div>

      <Prompt message={getPromptMessage}/>
    </>
  );
};

DestinationEditor.displayName = 'DestinationEditor';

export { DestinationEditor }
