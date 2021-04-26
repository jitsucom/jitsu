// @Libs
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prompt, useHistory, useParams } from 'react-router-dom';
import { Form } from 'antd';
import cn from 'classnames';
import { snakeCase } from 'lodash';
// @Page
import { SourceEditorConfig } from './SourceEditorConfig';
import { SourceEditorCollections } from './SourceEditorCollections';
import { SourceEditorDestinations } from './SourceEditorDestinations';
// @Components
import { Tab, TabsConfigurator } from '@molecule/TabsConfigurator';
import { PageHeader } from '@atom/PageHeader';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage';
import { SourceConnector } from '@catalog/sources/types';
import { FormInstance } from 'antd/es';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @CCatalog sources
import { allSources } from '@catalog/sources/lib';
import { EditorButtons } from '@molecule/EditorButtons';

const SourceEditor = ({ projectId, sources, updateSources, setBreadcrumbs, editorMode }: CommonSourcePageProps) => {
  const history = useHistory();

  const params = useParams<{ source?: string; sourceId?: string; }>();

  const [sourceSaving, setSourceSaving] = useState<boolean>(false);
  const [savePopover, setSavePopover] = useState<boolean>(false);
  const [testConnecting, setTestConnecting] = useState<boolean>(false);
  const [testConnectingPopover, setTestConnectingPopover] = useState<boolean>(false);

  // const sourceData = useMemo<SourceData>(() => sources.find((source: SourceData) => source.sourceId === params.sourceId), [sources, params.sourceId]);
  const sourceData = useRef<SourceData>(sources.find(source => source.sourceId === params.sourceId));

  const connectorSource = useMemo<SourceConnector>(
    () => sourceData.current?.sourceProtoType
      ? allSources.find((source: SourceConnector) => snakeCase(source.id) === sourceData.current?.sourceProtoType)
      : allSources.find((source: SourceConnector) => snakeCase(source.id) === snakeCase(params.source)) ?? {} as SourceConnector,
    [sourceData.current?.sourceProtoType, params.source]
  );

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
      />
    ),
    form: Form.useForm()[0]
  },
  {
    key: 'collections',
    name: 'Collections',
    getComponent: (form: FormInstance) => <SourceEditorCollections form={form} />,
    form: Form.useForm()[0]
  },
  {
    key: 'destinations',
    name: 'Connected Destinations',
    getComponent: (form: FormInstance) => (
      <SourceEditorDestinations
        form={form}
        initialValues={sourceData.current}
        projectId={projectId}
      />
    ),
    form: Form.useForm()[0],
    errorsLevel: 'warning'
  }]);

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: routes.root },
        {
          title: <PageHeader title={connectorSource?.displayName} icon={connectorSource?.pic} mode="edit" />
        }
      ]
    }));
  }, [connectorSource, setBreadcrumbs]);

  const savePopoverClose = useCallback(() => setSavePopover(false), []);
  const testConnectingPopoverClose = useCallback(() => setTestConnectingPopover(false), []);

  const handleCancel = useCallback(() => history.push(routes.root), [history]);

  const touchedFields = useRef<boolean>(false);

  const getPromptMessage = useCallback(
    () => touchedFields.current ? 'You have unsaved changes. Are you sure you want to leave the page?': undefined,
    []
  );

  const handleSubmit = useCallback(() => {}, []);

  const handleTestConnection = useCallback(() => {}, []);

  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto')}>
        <div className={cn('flex-grow')}>
          <TabsConfigurator type="card" tabsList={sourcesTabs.current} defaultTabIndex={0} />
        </div>

        <div className="flex-shrink border-t pt-2">
          <EditorButtons
            save={{
              isRequestPending: sourceSaving,
              isPopoverVisible: savePopover,
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

      <Prompt message={getPromptMessage}/>
    </>
  );
};

SourceEditor.displayName = 'SourceEditor';

export { SourceEditor };
