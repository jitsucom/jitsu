// @Libs
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Prompt, useHistory, useParams } from 'react-router';
import { snakeCase } from 'lodash';
// @Types
import { CommonSourcePageProps } from 'ui/pages/SourcesPage/SourcesPage';
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
// @Store
import { sourcesStore } from 'stores/sources';
// @Catalog
import { allSources as sourcesCatalog } from 'catalog/sources/lib';
// @Components
import { SourceEditorViewTabs } from './SourceEditorViewTabs';
import { withHome as breadcrumbsWithHome } from 'ui/components/Breadcrumbs/Breadcrumbs';
import { sourcesPageRoutes } from 'ui/pages/SourcesPage/SourcesPage.routes';
import { PageHeader } from 'ui/components/PageHeader/PageHeader';
import { sourceEditorUtils } from './SourceEditor.utils';
// @Utils

export type SourceEditorState = {
  /**
   * Source configuration tab
   */
  configuration: ConfigurationState;
  /**
   * Source streams tab
   */
  streams: StreamsState;
  /**
   * Source connected destinations tab
   */
  connections: ConnectionsState;
  /**
   * Whether user made any changes
   */
  stateChanged: boolean;
};

type CommonStateProperties = {
  errorsCount: number;
};

type ConfigurationState = {
  config: SourceConfigurationData;
} & CommonStateProperties;

type StreamsState = {
  streams: SourceStreamData[];
} & CommonStateProperties;

type ConnectionsState = {
  destinations: string[];
} & CommonStateProperties;

export type SourceConfigurationData = {
  sourceId: string;
  sourceName?: string;
  schedule: string;
} & PlainObjectWithPrimitiveValues;
export type SourceStreamData = CollectionSource | AirbyteStreamData;

export type UpdateConfigurationFields = (
  newFileds: Partial<ConfigurationState>
) => void;
export type UpdateStreamsFields = (newFileds: Partial<StreamsState>) => void;
export type UpdateConnectionsFields = (
  newFileds: Partial<ConnectionsState>
) => void;

const SourceEditor: React.FC<CommonSourcePageProps> = ({ setBreadcrumbs }) => {
  const history = useHistory();
  const allSourcesList = sourcesStore.sources;
  const { sourceId } = useParams<{ sourceId?: string }>();

  const initialSourceDataFromBackend = useMemo<Optional<SourceData>>(
    () => allSourcesList.find((src) => src.sourceId === sourceId),
    [sourceId, allSourcesList]
  );

  /**
   * `useState` is currently used for drafting purposes
   * it will be changed to `useReducer` later on
   */
  const [state, setState] = useState<SourceEditorState>(
    sourceEditorUtils.getInitialState(sourceId, initialSourceDataFromBackend)
  );

  const sourceDataFromCatalog = useMemo<CatalogSourceConnector>(() => {
    let sourceType = sourceId
      ? allSourcesList.find((src) => src.sourceId === sourceId)?.sourceProtoType
      : undefined;

    return sourceType
      ? sourcesCatalog.find(
          (source: CatalogSourceConnector) =>
            snakeCase(source.id) === snakeCase(sourceType)
        )
      : undefined;
  }, [sourceId, allSourcesList]);

  const updateConfiguration = useCallback<UpdateConfigurationFields>(
    (newConfigurationFields) => {
      setState((state) => ({
        ...state,
        configuration: { ...state.configuration, ...newConfigurationFields },
        stateChanged: true
      }));
    },
    []
  );

  const updateStreams = useCallback<UpdateStreamsFields>((newStreamsFields) => {
    setState((state) => ({
      ...state,
      streams: { ...state.streams, ...newStreamsFields },
      stateChanged: true
    }));
  }, []);

  const updateConnections = useCallback<UpdateConnectionsFields>(
    (newConnectionsFields) => {
      setState((state) => ({
        ...state,
        connections: { ...state.connections, ...newConnectionsFields },
        stateChanged: true
      }));
    },
    []
  );

  const handleTestConnection = useCallback<VoidFunction>(async () => {
    // sourcePageUtils.testConnection();
    const sourceData = sourceEditorUtils.getSourceDataFromState(
      state,
      sourceDataFromCatalog,
      initialSourceDataFromBackend
    );

    console.log(sourceData);
  }, [state, sourceDataFromCatalog, initialSourceDataFromBackend]);

  const handleLeave = useCallback<VoidFunction>(() => history.goBack(), []);

  useEffect(() => {
    setBreadcrumbs(
      breadcrumbsWithHome({
        elements: [
          { title: 'Sources', link: sourcesPageRoutes.root },
          {
            title: (
              <PageHeader
                title={sourceDataFromCatalog?.displayName}
                icon={sourceDataFromCatalog?.pic}
                mode={'Mode not set' as any}
              />
            )
          }
        ]
      })
    );
  }, [sourceDataFromCatalog, setBreadcrumbs]);

  return (
    <>
      <SourceEditorViewTabs
        initialSourceDataFromBackend={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        onConfigurationChange={updateConfiguration}
        onStreamsChange={updateStreams}
        onConnectionsChange={updateConnections}
        handleTestConnection={handleTestConnection}
        handleLeaveEditor={handleLeave}
      />

      <Prompt
        message={
          'You have unsaved changes. Are you sure you want to leave without saving?'
        }
        when={state.stateChanged}
      />

      {/* <DocumentationDrawer /> */}
    </>
  );
};

const Wrapped = observer(SourceEditor);

Wrapped.displayName = 'SourceEditor';

export { Wrapped as SourceEditor };
