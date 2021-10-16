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

type SourceEditorState = {
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
  changed: boolean;
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

export type UpdateConfigurationFields = (
  newFileds: Partial<ConfigurationState>
) => void;
export type UpdateStreamsFields = (newFileds: Partial<StreamsState>) => void;
export type UpdateConnectionsFields = (
  newFileds: Partial<ConnectionsState>
) => void;

const initialState: SourceEditorState = {
  configuration: { config: {}, errorsCount: 0 },
  streams: { streams: [], errorsCount: 0 },
  connections: { destinations: [], errorsCount: 0 },
  changed: false
};

const SourceEditor: React.FC<CommonSourcePageProps> = ({ setBreadcrumbs }) => {
  const { sourceId } = useParams<{ sourceId?: string }>();

  const history = useHistory();

  const allSourcesList = sourcesStore.sources;

  /**
   * `useState` is currently used for drafting purposes
   * it will be changed to `useReducer` later on
   */
  const [state, setState] = useState<SourceEditorState>(initialState);

  const initialSourceDataFromBackend = useMemo<Optional<SourceData>>(
    () => allSourcesList.find((src) => src.sourceId === sourceId),
    [sourceId, allSourcesList]
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
        changed: true
      }));
    },
    []
  );

  const updateStreams = useCallback<UpdateStreamsFields>((newStreamsFields) => {
    setState((state) => ({
      ...state,
      streams: { ...state.streams, ...newStreamsFields },
      changed: true
    }));
  }, []);

  const updateConnections = useCallback<UpdateConnectionsFields>(
    (newConnectionsFields) => {
      setState((state) => ({
        ...state,
        connections: { ...state.connections, ...newConnectionsFields },
        changed: true
      }));
    },
    []
  );

  const handleTestConnection = useCallback<VoidFunction>(() => {}, []);

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
        handleLeaveEditor={handleLeave}
      />

      <Prompt
        message={
          'You have unsaved changes. Are you sure you want to leave without saving?'
        }
        when={state.changed}
      />

      {/* <DocumentationDrawer /> */}
    </>
  );
};

const Wrapped = observer(SourceEditor);

Wrapped.displayName = 'SourceEditor';

export { Wrapped as SourceEditor };
