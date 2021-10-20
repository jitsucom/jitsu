// @Libs
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useHistory, useParams } from 'react-router';
import { cloneDeep, snakeCase } from 'lodash';
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
import {
  createInitialSourceData,
  sourceEditorUtils,
  sourceEditorUtilsAirbyte
} from './SourceEditor.utils';
import {
  addToArrayIfNotDuplicate,
  removeFromArrayIfFound,
  substituteArrayValueIfFound
} from 'utils/arrays';
import { sourcePageUtils } from 'ui/pages/SourcesPage/SourcePage.utils';
import { closeableMessage } from 'lib/components/components';
import { firstToLower } from 'lib/commons/utils';
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

export type SetSourceEditorState = React.Dispatch<
  React.SetStateAction<SourceEditorState>
>;

type ConfigurationState = {
  config: SourceConfigurationData;
  getErrorsCount: () => Promise<number>;
  errorsCount: number;
};

type StreamsState = {
  streams: SourceStreamsData;
  errorsCount: number;
};

type ConnectionsState = {
  connections: SourceConnectionsData;
  errorsCount: number;
};

export type SourceConfigurationData = PlainObjectWithPrimitiveValues;
export type SourceStreamsData = {
  [pathToStreamsInSourceData: string]: AirbyteStreamData[];
};
export type SourceConnectionsData = {
  [pathToConnectionsInSourceData: string]: string[];
};

export type UpdateConfigurationFields = (
  newFileds: Partial<SourceConfigurationData>
) => void;

export type AddStream = (
  pathToStreamsInSourceData: string,
  stream: AirbyteStreamData
) => void;
export type RemoveStream = (
  pathToStreamsInSourceData: string,
  stream: AirbyteStreamData
) => void;
export type UpdateStream = (
  pathToStreamsInSourceData: string,
  stream: AirbyteStreamData
) => void;
export type SetStreams = (
  pathToStreamsInSourceData: string,
  streams: any
) => void;

export type AddConnection = (
  pathToConnectionsInSourceData: string,
  connectionId: string
) => void;
export type RemoveConnection = (
  pathToConnectionsInSourceData: string,
  connectionId: string
) => void;
export type SetConnections = (
  pathToConnectionsInSourceData: string,
  connectionIds: string[]
) => void;

export type TabsErrorsState = {
  configuration: number;
  streams: number;
  connections: number;
};

const initialState: SourceEditorState = {
  configuration: {
    config: {},
    getErrorsCount: async () => 0,
    errorsCount: 0
  },
  streams: {
    streams: {},
    errorsCount: 0
  },
  connections: {
    connections: {},
    errorsCount: 0
  },
  stateChanged: false
};

const SourceEditor: React.FC<CommonSourcePageProps> = ({
  editorMode,
  setBreadcrumbs
}) => {
  const history = useHistory();
  const allSourcesList = sourcesStore.sources;
  const { source, sourceId } =
    useParams<{ source?: string; sourceId?: string }>();

  const sourceDataFromCatalog = useMemo<CatalogSourceConnector>(() => {
    let sourceType = source
      ? source
      : sourceId
      ? sourcesStore.sources.find((src) => src.sourceId === sourceId)
          ?.sourceProtoType
      : undefined;

    return sourceType
      ? sourcesCatalog.find(
          (source: CatalogSourceConnector) =>
            snakeCase(source.id) === snakeCase(sourceType)
        )
      : undefined;
  }, [sourceId, allSourcesList]);

  const initialSourceDataFromBackend = useMemo<Optional<Partial<SourceData>>>(
    () =>
      allSourcesList.find((src) => src.sourceId === sourceId) ??
      createInitialSourceData(sourceDataFromCatalog),
    [sourceId, allSourcesList]
  );

  const [state, setState] = useState<SourceEditorState>(initialState);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] =
    useState<boolean>(false);
  const [tabErrorsVisible, setTabErrorsVisible] = useState<boolean>(false);
  const [showDocumentation, setShowDocumentation] = useState<boolean>(false);
  const [configIsValidatedByStreams, setConfigIsValidatedByStreams] =
    useState<boolean>(false);

  const handleSetConfigValidatedByStreams = useCallback(() => {
    setConfigIsValidatedByStreams(true);
  }, []);

  const updateConfiguration = useCallback<UpdateConfigurationFields>(
    (newConfigurationFields) => {
      setState((state) => ({
        ...state,
        configuration: {
          ...state.configuration,
          config: { ...state.configuration.config, ...newConfigurationFields }
        },
        stateChanged: true
      }));
      setConfigIsValidatedByStreams(false);
      setTabErrorsVisible(false);
    },
    []
  );

  const setConfigurationValidator = useCallback<
    (validator: () => Promise<number>) => void
  >((validator) => {
    setState((state) => {
      const newState = cloneDeep(state);
      newState.configuration.getErrorsCount = validator;
      return newState;
    });
  }, []);

  const addStream = useCallback<AddStream>(
    (pathToStreamsInSourceData, stream) => {
      setState((state) => {
        const newState = cloneDeep(state);
        const oldStreams = newState.streams.streams[pathToStreamsInSourceData];

        const newStreams = addToArrayIfNotDuplicate(
          oldStreams,
          stream,
          sourceEditorUtilsAirbyte.streamsAreEqual
        );

        newState.streams.streams[pathToStreamsInSourceData] = newStreams;

        return newState;
      });
    },
    []
  );

  const removeStream = useCallback<RemoveStream>(
    (pathToStreamsInSourceData, stream) => {
      setState((state) => {
        const newState = cloneDeep(state);
        const oldStreams = newState.streams.streams[pathToStreamsInSourceData];

        const newStreams = removeFromArrayIfFound(
          oldStreams,
          stream,
          sourceEditorUtilsAirbyte.streamsAreEqual
        );

        newState.streams.streams[pathToStreamsInSourceData] = newStreams;

        return newState;
      });
    },
    []
  );

  const updateStream = useCallback<UpdateStream>(
    (pathToStreamsInSourceData, stream) => {
      setState((state) => {
        const newState = cloneDeep(state);
        const oldStreams = newState.streams.streams[pathToStreamsInSourceData];

        let newStreams = substituteArrayValueIfFound(
          oldStreams,
          stream,
          sourceEditorUtilsAirbyte.streamsAreEqual
        );

        newState.streams.streams[pathToStreamsInSourceData] = newStreams;

        return newState;
      });
    },
    []
  );

  const setStreams = useCallback<SetStreams>(
    (pathToStreamsInSourceData, streams) => {
      setState((state) => {
        const newState = cloneDeep(state);
        newState.streams.streams[pathToStreamsInSourceData] = streams;
        return newState;
      });
    },
    []
  );

  const addConnection = useCallback<AddConnection>(
    (pathToConnectionsInSourceData, connection) => {
      setState((state) => {
        const newState = cloneDeep(state);
        const oldConnections =
          newState.connections.connections[pathToConnectionsInSourceData];

        const newConnections = addToArrayIfNotDuplicate(
          oldConnections,
          connection
        );

        newState.connections.connections[pathToConnectionsInSourceData] =
          newConnections;

        return newState;
      });
    },
    []
  );

  const removeConnection = useCallback<RemoveConnection>(
    (pathToConnectionsInSourceData, connection) => {
      setState((state) => {
        const newState = cloneDeep(state);
        const oldConnections =
          newState.connections.connections[pathToConnectionsInSourceData];

        const newConnections = removeFromArrayIfFound(
          oldConnections,
          connection
        );

        newState.connections.connections[pathToConnectionsInSourceData] =
          newConnections;

        return newState;
      });
    },
    []
  );

  const setConnections = useCallback<SetConnections>(
    (pathToConnectionsInSourceData, connections) => {
      setState((state) => {
        const newState = cloneDeep(state);
        newState.connections.connections[pathToConnectionsInSourceData] =
          connections;
        return newState;
      });
    },
    []
  );

  const handleBringSourceData = () => {
    return sourceEditorUtils.getSourceDataFromState(
      state,
      sourceDataFromCatalog
    );
  };

  const validateCountErrors = async (): Promise<number> => {
    const configurationErrorsCount = await state.configuration.getErrorsCount();

    setState((state) => {
      const newState = cloneDeep(state);
      newState.configuration.errorsCount = configurationErrorsCount;
      return newState;
    });

    setTabErrorsVisible(true);

    return (
      configurationErrorsCount +
      state.streams.errorsCount +
      state.connections.errorsCount
    );
  };

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true);
    try {
      const isErrored = !!(await validateCountErrors());
      if (isErrored) return;

      const sourceData = handleBringSourceData();
      return await sourcePageUtils.testConnection(sourceData);
    } finally {
      setIsTestingConnection(false);
    }
  }, [state]);

  const handleSave = useCallback<AsyncVoidFunction>(async () => {
    setIsSaving(true);
    try {
      const sourceData = handleBringSourceData();
      const testConnectionResults = await sourcePageUtils.testConnection(
        sourceData,
        true
      );

      const sourceDataToSave: SourceData = {
        ...sourceData,
        ...testConnectionResults
      };

      if (editorMode === 'add') sourcesStore.addSource(sourceDataToSave);
      if (editorMode === 'edit') sourcesStore.editSources(sourceDataToSave);

      handleLeaveEditor({ goToSourcesList: true });

      if (sourceDataToSave.connected) {
        closeableMessage.success('New source has been added!');
      } else {
        closeableMessage.warn(
          `Source has been saved, but test has failed with '${firstToLower(
            sourceDataToSave.connectedErrorMessage
          )}'. Data from this source will not be available`
        );
      }
    } catch {
      setIsSaving(false);
    }
  }, [editorMode, state]);

  const handleLeaveEditor = useCallback<
    (options?: { goToSourcesList?: boolean }) => void
  >((options) => {
    options.goToSourcesList
      ? history.push(sourcesPageRoutes.root)
      : history.goBack();
  }, []);

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
                mode={editorMode}
              />
            )
          }
        ]
      })
    );
  }, [editorMode, sourceDataFromCatalog, setBreadcrumbs]);

  return (
    <>
      <SourceEditorViewTabs
        state={state}
        sourceId={sourceId}
        editorMode={editorMode}
        stateChanged={state.stateChanged}
        showTabsErrors={tabErrorsVisible}
        showDocumentationDrawer={showDocumentation}
        initialSourceDataFromBackend={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        configIsValidatedByStreams={configIsValidatedByStreams}
        isSaving={isSaving}
        isTestingConnection={isTestingConnection}
        setState={setState}
        setShowDocumentationDrawer={setShowDocumentation}
        handleSetConfigValidatedByStreams={handleSetConfigValidatedByStreams}
        onConfigurationChange={updateConfiguration}
        setConfigurationValidator={setConfigurationValidator}
        addStream={addStream}
        removeStream={removeStream}
        updateStream={updateStream}
        setStreams={setStreams}
        addConnection={addConnection}
        removeConnection={removeConnection}
        setConnections={setConnections}
        handleBringSourceData={handleBringSourceData}
        handleSave={handleSave}
        handleTestConnection={handleTestConnection}
        handleLeaveEditor={handleLeaveEditor}
      />
    </>
  );
};

const Wrapped = observer(SourceEditor);

Wrapped.displayName = 'SourceEditor';

export { Wrapped as SourceEditor };
