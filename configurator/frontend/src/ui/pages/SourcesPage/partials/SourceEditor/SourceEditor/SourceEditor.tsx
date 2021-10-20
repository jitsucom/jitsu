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

type ConfigurationState = {
  config: SourceConfigurationData;
  getErrorsCount: () => Promise<number>;
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
  streams: AirbyteStreamData[]
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

const initialState: SourceEditorState = {
  configuration: {
    config: {},
    getErrorsCount: async () => 0
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

  console.log(initialSourceDataFromBackend);

  const [state, setState] = useState<SourceEditorState>(initialState);
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

  const handleTestConnection = useCallback<VoidFunction>(async () => {
    // sourcePageUtils.testConnection();
    const configurationErrorsCount = await state.configuration.getErrorsCount();
    const streamsErrorsCount = state.streams.errorsCount;
    const connectionsErrorsCount = state.connections.errorsCount;

    const errorsCounts = {
      configuration: configurationErrorsCount,
      streams: state.streams.errorsCount,
      connectins: state.connections.errorsCount
    };

    console.log(errorsCounts);

    if (Object.values(errorsCounts).some((count) => !!count)) return;

    const sourceData = handleBringSourceData();

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
        sourceId={sourceId}
        editorMode={editorMode}
        stateChanged={state.stateChanged}
        showDocumentationDrawer={showDocumentation}
        initialSourceDataFromBackend={initialSourceDataFromBackend}
        sourceDataFromCatalog={sourceDataFromCatalog}
        configIsValidatedByStreams={configIsValidatedByStreams}
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
        handleTestConnection={handleTestConnection}
        handleLeaveEditor={handleLeave}
      />
    </>
  );
};

const Wrapped = observer(SourceEditor);

Wrapped.displayName = 'SourceEditor';

export { Wrapped as SourceEditor };
