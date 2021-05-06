// @Libs
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prompt, Redirect, useHistory, useParams } from 'react-router-dom';
import { Form, message } from 'antd';
import cn from 'classnames';
import { snakeCase } from 'lodash';
// @Page
import { SourceEditorConfig } from './SourceEditorConfig';
import { SourceEditorCollections } from './SourceEditorCollections';
import { SourceEditorDestinations } from './SourceEditorDestinations';
// @Components
import { Tab, TabsConfigurator } from '@molecule/TabsConfigurator';
import { PageHeader } from '@atom/PageHeader';
import { EditorButtons } from '@molecule/EditorButtons';
// @Types
import { CollectionSourceData, CommonSourcePageProps } from '@page/SourcesPage';
import { SourceConnector } from '@catalog/sources/types';
import { FormInstance } from 'antd/es';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/SourcesPage.routes';
// @Catalog sources
import { allSources } from '@catalog/sources/lib';
// @Utils
import { sourcePageUtils } from '@page/SourcesPage/SourcePage.utils';
import { validateTabForm } from '@util/forms/validateTabForm';
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import { handleError } from '@./lib/components/components';
import { firstToLower } from '@./lib/commons/utils';
// @Styles
import styles from './SourceEditor.module.less';

const SourceEditor = ({ projectId, sources, updateSources, setBreadcrumbs, editorMode }: CommonSourcePageProps) => {
  const services = ApplicationServices.get();

  const history = useHistory();

  const forceUpdate = useForceUpdate();

  const params = useParams<{ source?: string; sourceId?: string; tabName?: string; }>();

  const [sourceSaving, setSourceSaving] = useState<boolean>(false);
  const [savePopover, switchSavePopover] = useState<boolean>(false);
  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [testConnectingPopover, switchTestConnectingPopover] = useState<boolean>(false);

  const connectorSource = useMemo<SourceConnector>(
    () => {
      let sourceType = params.source
        ? params.source
        : params.sourceId
          ? sources.find(src => src.sourceId === params.sourceId)?.sourceProtoType
          : undefined;

      return sourceType
        ? allSources.find((source: SourceConnector) => snakeCase(source.id) === snakeCase(sourceType))
        : undefined;
    },
    [params.source, params.sourceId, sources]
  );

  const sourceData = useRef<SourceData>(
    sources.find(src => src.sourceId === params.sourceId) ?? {
      sourceId: sourcePageUtils.getSourceId(params.source, sources.map(src => src.sourceId)),
      connected: false,
      sourceType: sourcePageUtils.getSourceType(connectorSource),
      sourceProtoType: snakeCase(params.source)
    } as SourceData
  );

  const submittedOnce = useRef<boolean>(false);

  const sourcesTabs = useRef<Tab[]>([{
    key: 'config',
    name: 'Connection Properties',
    getComponent: (form: FormInstance) => (
      <SourceEditorConfig
        form={form}
        sourceReference={connectorSource}
        isCreateForm={editorMode === 'add'}
        initialValues={sourceData.current}
        sources={sources}
        handleTouchAnyField={validateAndTouchField(0)}
      />
    ),
    form: Form.useForm()[0],
    touched: false
  },
  {
    key: 'collections',
    name: 'Collections',
    getComponent: (form: FormInstance) => (
      <SourceEditorCollections
        form={form}
        initialValues={sourceData.current}
        connectorSource={connectorSource}
        handleTouchAnyField={validateAndTouchField(1)}
      />
    ),
    form: Form.useForm()[0],
    isHidden: connectorSource?.isSingerType,
    touched: false
  },
  {
    key: 'destinations',
    name: 'Linked Destinations',
    getComponent: (form: FormInstance) => (
      <SourceEditorDestinations
        form={form}
        initialValues={sourceData.current}
        projectId={projectId}
        handleTouchAnyField={validateAndTouchField(2)}
      />
    ),
    form: Form.useForm()[0],
    errorsLevel: 'warning',
    touched: false
  }]);

  const validateAndTouchField = useCallback(
    (index: number) => (value: boolean) => {
      const tab = sourcesTabs.current[index];

      tab.touched = value === undefined ? true : value

      if (submittedOnce.current) {
        validateTabForm(tab, { forceUpdate, beforeValidate: () => tab.errorsCount = 0, errorCb: errors => tab.errorsCount = errors.errorFields?.length });
      }
    },
    [forceUpdate]
  );

  const savePopoverClose = useCallback(() => switchSavePopover(false), []);
  const testConnectingPopoverClose = useCallback(() => switchTestConnectingPopover(false), []);

  const handleCancel = useCallback(() => history.push(sourcesPageRoutes.root), [history]);

  const handleTestConnection = useCallback(async() => {
    setTestConnecting(true);

    const tab = sourcesTabs.current[0];

    try {
      const beforeValidate = () => tab.errorsCount = 0;

      const errorCb = (errors) => tab.errorsCount = errors.errorFields?.length;

      const config = await validateTabForm(tab, { forceUpdate, errorCb, beforeValidate });

      sourceData.current = {
        ...sourceData.current,
        ...makeObjectFromFieldsValues(config)
      };

      const testConnectionResults = await sourcePageUtils.testConnection(sourceData.current);

      sourceData.current = {
        ...sourceData.current,
        ...testConnectionResults
      };
    } catch(error) {
      switchTestConnectingPopover(true);
    } finally {
      setTestConnecting(false);
      forceUpdate();
    }
  }, [forceUpdate]);

  const handleSubmit = useCallback(() => {
    submittedOnce.current = true;

    setSourceSaving(true);

    Promise
      .all(sourcesTabs.current.map(tab => validateTabForm(tab, { forceUpdate, beforeValidate: () => tab.errorsCount = 0, errorCb: errors => tab.errorsCount = errors.errorFields?.length })))
      .then(async allValues => {
        sourceData.current = {
          ...sourceData.current,
          ...allValues.reduce((result: any, current: any) => {
            return {
              ...result,
              ...makeObjectFromFieldsValues(current)
            };
          }, {})
        };

        if (sourceData.current.collections) {
          sourceData.current.collections = sourceData.current.collections.map((collection: CollectionSource) => {
            if (!collection.parameters) {
              collection.parameters = {} as Array<{ [key: string]: string[]; }>;
            }

            return collection;
          });
        }

        const testConnectionResults = await sourcePageUtils.testConnection(sourceData.current, true);

        sourceData.current = {
          ...sourceData.current,
          ...testConnectionResults
        };

        try {
          const payload: CollectionSourceData = {
            sources: editorMode === 'edit'
              ? sources.reduce((accumulator: SourceData[], current: SourceData) => [
                ...accumulator,
                current.sourceId !== sourceData.current.sourceId
                  ? current
                  : sourceData.current
              ], [])
              : [...sources, sourceData.current]
          };

          await services.storageService.save('sources', payload, projectId);

          updateSources(payload);

          sourcesTabs.current.forEach((tab: Tab) => tab.touched = false);

          history.push(sourcesPageRoutes.root);

          if (sourceData.current.connected) {
            message.success('New destination has been added!');
          } else {
            message.warn(
              `Source has been saved, but test has failed with '${firstToLower(
                sourceData.current.connectedErrorMessage
              )}'. Data from this source will not be available`,
              3
            );
          }
        } catch(error) {
          handleError(error, 'Something goes wrong, source hasn\'t been added');
        }
      })
      .catch(() => {
        switchSavePopover(true);
      })
      .finally(() => {
        setSourceSaving(false);
        forceUpdate();
      });
  }, [forceUpdate, editorMode, projectId, history, services.storageService, sources, updateSources]);

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: sourcesPageRoutes.root },
        {
          title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode={editorMode} />
        }
      ]
    }));
  }, [connectorSource, setBreadcrumbs]);

  if (!connectorSource) {
    return <Redirect to={sourcesPageRoutes.add} />;
  }

  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto')}>
        <div className={cn('flex-grow')}>
          <TabsConfigurator
            type="card"
            className={styles.tabCard}
            tabsList={sourcesTabs.current}
            defaultTabIndex={0}
          />
        </div>

        <div className="flex-shrink border-t pt-2">
          <EditorButtons
            save={{
              isRequestPending: sourceSaving,
              isPopoverVisible: savePopover && sourcesTabs.current.some((tab: Tab) => tab.errorsCount > 0),
              handlePress: handleSubmit,
              handlePopoverClose: savePopoverClose,
              titleText: 'Source editor errors',
              tabsList: sourcesTabs.current
            }}
            test={{
              isRequestPending: testConnecting,
              isPopoverVisible: testConnectingPopover && sourcesTabs.current[0].errorsCount > 0,
              handlePress: handleTestConnection,
              handlePopoverClose: testConnectingPopoverClose,
              titleText: 'Connection Properties errors',
              tabsList: [sourcesTabs.current[0]]
            }}
            handleCancel={handleCancel}
          />
        </div>
      </div>

      <Prompt message={sourcePageUtils.getPromptMessage(sourcesTabs.current)}/>
    </>
  );
};

SourceEditor.displayName = 'SourceEditor';

export { SourceEditor };
