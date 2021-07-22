// @Libs
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prompt, useHistory, useParams } from 'react-router-dom';
import { Card, Form, message } from 'antd';
import cn from 'classnames';
// @Components
import { TabsConfigurator } from 'ui/components/Tabs/TabsConfigurator';
import { EditorButtons } from 'ui/components/EditorButtons/EditorButtons';
import { ComingSoon } from 'ui/components/ComingSoon/ComingSoon';
import { PageHeader } from 'ui/components/PageHeader/PageHeader';
import { closeableMessage } from 'lib/components/components';
import { DestinationEditorConfig } from './DestinationEditorConfig';
import { DestinationEditorConnectors } from './DestinationEditorConnectors';
import { DestinationEditorMappings } from './DestinationEditorMappings';
import { DestinationEditorMappingsLibrary } from './DestinationEditorMappingsLibrary';
// @Store
import { destinationsStore } from 'stores/destinations';
// @CatalogDestinations
import { destinationsReferenceMap } from 'catalog/destinations/lib';
// @Types
import { FormInstance } from 'antd/es';
import { Destination } from 'catalog/destinations/types';
import { Tab } from 'ui/components/Tabs/TabsConfigurator';
import { CommonDestinationPageProps } from 'ui/pages/DestinationsPage/DestinationsPage';
import { withHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Routes
import { destinationPageRoutes } from 'ui/pages/DestinationsPage/DestinationsPage.routes';
// @Styles
import styles from './DestinationEditor.module.less';
// @Utils
import { makeObjectFromFieldsValues } from 'utils/forms/marshalling';
import { destinationEditorUtils } from 'ui/pages/DestinationsPage/partials/DestinationEditor/DestinationEditor.utils';
import { getUniqueAutoIncId, randomId } from 'utils/numbers';
import { firstToLower } from 'lib/commons/utils';
// @Hooks
import { useForceUpdate } from 'hooks/useForceUpdate';
// @Icons
import WarningOutlined from '@ant-design/icons/lib/icons/WarningOutlined';
import { sourcesStore } from 'stores/sources';

type DestinationTabKey = 'config' | 'mappings' | 'sources' | 'settings' | 'statistics';

type DestinationParams = {
  type?: DestinationType;
  id?: string;
  tabName?: string;
}

type DestinationURLParams = {
  type?: string;
  id?: string;
  tabName?: string;
}

type ConfigProps = {paramsByProps?: DestinationParams}

type ControlsProps = {
  disableForceUpdateOnSave?: boolean;
  onAfterSaveSucceded?: () => void;
  onCancel?: () => void;
}

type Props =
  & CommonDestinationPageProps
  & ConfigProps
  & ControlsProps;

const DestinationEditor = ({
  editorMode,
  paramsByProps,
  disableForceUpdateOnSave,
  setBreadcrumbs,
  onAfterSaveSucceded,
  onCancel
}: Props) => {
  const history = useHistory();

  const forceUpdate = useForceUpdate();

  const services = ApplicationServices.get();

  const urlParams = useParams<DestinationURLParams>();
  const params = paramsByProps || urlParams;

  const [activeTabKey, setActiveTabKey] = useState<DestinationTabKey>('config');
  const [savePopover, switchSavePopover] = useState<boolean>(false);
  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [destinationSaving, setDestinationSaving] = useState<boolean>(false);
  const [testConnectingPopover, switchTestConnectingPopover] =
    useState<boolean>(false);

  const sources = sourcesStore.sources;
  const destinationData = useRef<DestinationData>(getDestinationData(params));

  const destinationReference = useMemo<Destination>(() => {
    if (params.type) {
      debugger;
      return destinationsReferenceMap[params.type];
    }
    const deb = destinationsReferenceMap[getDestinationData(params)._type];
    debugger;
    return destinationsReferenceMap[getDestinationData(params)._type];
  }, [params.type, params.id]);

  const submittedOnce = useRef<boolean>(false);

  const handleUseLibrary = async (
    newMappings: DestinationMapping,
    newTableName?: string
  ) => {
    destinationData.current = {
      ...destinationData.current,
      _formData: {
        ...destinationData.current._formData,
        tableName: newTableName
          ? newTableName
          : destinationData.current._formData?.tableName
      },
      _mappings: newMappings
    };

    const { form: mappingsForm } = destinationsTabs.current[1];
    const { form: configForm } = destinationsTabs.current[0];

    await mappingsForm.setFieldsValue({
      '_mappings._mappings': newMappings._mappings,
      '_mappings._keepUnmappedFields': newMappings._keepUnmappedFields ? 1 : 0
    });

    destinationsTabs.current[1].touched = true;

    if (newTableName) {
      await configForm.setFieldsValue({
        '_formData.tableName': newTableName
      });

      destinationsTabs.current[0].touched = true;
    }

    await forceUpdate();

    message.success('Mappings library has been successfully set');
  };

  const validateTabForm = useCallback(
    async (tab: Tab) => {
      const tabForm = tab.form;

      try {
        if (tab.key === 'sources') {
          const _sources = tabForm.getFieldsValue()?._sources;

          if (!_sources) {
            tab.errorsCount = 1;
          }
        }

        tab.errorsCount = 0;

        return await tabForm.validateFields();
      } catch (errors) {
        // ToDo: check errors count for fields with few validation rules
        tab.errorsCount = errors.errorFields?.length;
        throw errors;
      } finally {
        forceUpdate();
      }
    },
    [forceUpdate]
  );

  const validateAndTouchField = useCallback(
    (index: number) => (value: boolean) => {
      destinationsTabs.current[index].touched =
        value === undefined ? true : value;

      if (submittedOnce.current) {
        validateTabForm(destinationsTabs.current[index]);
      }
    },
    [validateTabForm]
  );

  const tabsInitialData: Tab<DestinationTabKey>[] = [
      {
        key: 'config',
        name: 'Connection Properties',
        getComponent: (form: FormInstance) => (
          <DestinationEditorConfig
            form={form}
            destinationReference={destinationReference}
            destinationData={destinationData.current}
            handleTouchAnyField={validateAndTouchField(0)}
          />
        ),
        form: Form.useForm()[0],
        touched: false
      },
      {
        key: 'mappings',
        name: 'Mappings',
        getComponent: (form: FormInstance) => (
          <DestinationEditorMappings
            form={form}
            initialValues={destinationData.current._mappings}
            handleTouchAnyField={validateAndTouchField(1)}
          />
        ),
        form: Form.useForm()[0],
        touched: false
      },
      {
        key: 'sources',
        name: 'Linked Connectors & API Keys',
        getComponent: (form: FormInstance) => (
          <DestinationEditorConnectors
            form={form}
            initialValues={destinationData.current}
            destination={destinationReference}
            handleTouchAnyField={validateAndTouchField(2)}
          />
        ),
        form: Form.useForm()[0],
        errorsLevel: 'warning',
        touched: false
      },
      {
        key: 'settings',
        name: 'Configuration Templates',
        touched: false,
        getComponent: () => (
          <DestinationEditorMappingsLibrary
            handleDataUpdate={handleUseLibrary}
          />
        )
      },
      {
        key: 'statistics',
        name: (
          <ComingSoon
            render="Statistics"
            documentation={
              <>
                A detailed statistics on how many events have been sent to the
                destinations
              </>
            }
          />
        ),
        isDisabled: true,
        touched: false
      }
    ]

  const destinationsTabs = useRef<Tab<DestinationTabKey>[]>(tabsInitialData);

  const handleCancel = useCallback(() => {
    onCancel ? onCancel() : history.push(destinationPageRoutes.root);
  }, [history, onCancel]);

  const testConnectingPopoverClose = useCallback(
    () => switchTestConnectingPopover(false),
    []
  );

  const savePopoverClose = useCallback(() => switchSavePopover(false), []);

  const handleTestConnection = useCallback(async () => {
    setTestConnecting(true);

    const tab = destinationsTabs.current[0];

    try {
      const config = await validateTabForm(tab);

      destinationData.current._formData =
        makeObjectFromFieldsValues<DestinationData>(config)._formData;

      await destinationEditorUtils.testConnection(destinationData.current);
    } catch (error) {
      switchTestConnectingPopover(true);
    } finally {
      setTestConnecting(false);
      forceUpdate();
    }
  }, [validateTabForm, forceUpdate]);

  const handleSaveDestination = useCallback(() => {
    debugger;
    submittedOnce.current = true;

    setDestinationSaving(true);

    Promise.all(
      destinationsTabs.current
        .filter((tab: Tab) => !!tab.form)
        .map((tab: Tab) => validateTabForm(tab))
    )
      .then(async (allValues) => {
        debugger;
        destinationData.current = {
          ...destinationData.current,
          ...allValues.reduce((result: any, current: any) => {
            return {
              ...result,
              ...makeObjectFromFieldsValues(current)
            };
          }, {})
        };

        const updatedSources = await destinationEditorUtils.updateSources(
          sources,
          destinationData.current,
          services.activeProject.id
        );

        sourcesStore.editSources(updatedSources);

        // ToDo: remove this code after _mappings refactoring
        destinationData.current = {
          ...destinationData.current,
          _mappings: {
            ...destinationData.current._mappings,
            _keepUnmappedFields: Boolean(
              destinationData.current._mappings._keepUnmappedFields
            )
          }
        };

        try {
          await destinationEditorUtils.testConnection(
            destinationData.current,
            true
          );

          if (editorMode === 'add')
            destinationsStore.addDestination(destinationData.current);
          if (editorMode === 'edit')
            destinationsStore.editDestination(destinationData.current);

          destinationsTabs.current.forEach((tab: Tab) => (tab.touched = false));

          if (destinationData.current._connectionTestOk) {
            message.success('New destination has been added!');
          } else {
            closeableMessage.warn(
              `Destination has been saved, but test has failed with '${firstToLower(
                destinationData.current._connectionErrorMessage
              )}'. Data will not be piped to this destination`
            );
          }

          onAfterSaveSucceded
            ? onAfterSaveSucceded()
            : history.push(destinationPageRoutes.root);
        } catch (errors) {}
      })
      .catch(() => {
        switchSavePopover(true);
      })
      .finally(() => {
        setDestinationSaving(false);
        !disableForceUpdateOnSave && forceUpdate();
      });
  }, [
    sources,
    history,
    validateTabForm,
    forceUpdate,
    editorMode,
    services.activeProject.id,
    services.storageService
  ]);

  const connectedSourcesNum = sources.filter((src) =>
    (src.destinations || []).includes(destinationData.current._uid)
  ).length;

  const isAbleToConnectItems = () =>
    editorMode === 'edit' &&
    connectedSourcesNum === 0 &&
    !destinationData.current?._onlyKeys?.length;

  useEffect(() => {
    debugger;
    destinationData.current = getDestinationData(params);
    destinationsTabs.current = tabsInitialData;
    setBreadcrumbs(
      withHome({
        elements: [
          { title: 'Destinations', link: destinationPageRoutes.root },
          {
            title: (
              <PageHeader
                title={destinationReference.displayName}
                icon={destinationReference.ui.icon}
                mode={editorMode}
              />
            )
          }
        ]
      })
    );
    forceUpdate();
  }, [params.id, params.type]);

  return (
    <>
      <div
        className={cn('flex flex-col items-stretch flex-auto', styles.wrapper)}
      >
        <div className={styles.mainArea} id="dst-editor-tabs">
          {isAbleToConnectItems() && (
            <Card className={styles.linkedWarning}>
              <WarningOutlined className={styles.warningIcon} />
              <article>
                This destination is not linked to any API keys or Connector. You{' '}
                <span
                  className={styles.pseudoLink}
                  onClick={() => setActiveTabKey('sources')}
                >
                  can link the destination here
                </span>
                .
              </article>
            </Card>
          )}

          <TabsConfigurator
            type="card"
            className={styles.tabCard}
            tabsList={destinationsTabs.current}
            activeTabKey={activeTabKey}
            onTabChange={setActiveTabKey}
          />
        </div>

        <div className="flex-shrink border-t pt-2">
          <EditorButtons
            save={{
              isRequestPending: destinationSaving,
              isPopoverVisible:
                savePopover &&
                destinationsTabs.current.some(
                  (tab: Tab) => tab.errorsCount > 0
                ),
              handlePress: handleSaveDestination,
              handlePopoverClose: savePopoverClose,
              titleText: 'Destination editor errors',
              tabsList: destinationsTabs.current
            }}
            test={{
              isRequestPending: testConnecting,
              isPopoverVisible:
                testConnectingPopover &&
                destinationsTabs.current[0].errorsCount > 0,
              handlePress: handleTestConnection,
              handlePopoverClose: testConnectingPopoverClose,
              titleText: 'Connection Properties errors',
              tabsList: [destinationsTabs.current[0]]
            }}
            handleCancel={handleCancel}
          />
        </div>
      </div>

      <Prompt
        message={destinationEditorUtils.getPromptMessage(
          destinationsTabs.current
        )}
      />
    </>
  );
};;

DestinationEditor.displayName = 'DestinationEditor';

export { DestinationEditor }

const getDestinationData = (params: {
  id?: string;
  type?: string;
}): DestinationData =>
  destinationsStore.destinations.find((dst) => dst._id === params.id) ||
  ({
    _id: getUniqueAutoIncId(
      params.type,
      destinationsStore.destinations.map((dst) => dst._id)
    ),
    _uid: randomId(),
    _type: params.type,
    _mappings: { _keepUnmappedFields: true },
    _comment: null,
    _onlyKeys: []
  } as DestinationData);
