/**
 * This is a template for a possible further switch from useState
 * to useReducer hook used for managing SourceEditor state
 */

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

type SourceConfigurationData = PlainObjectWithPrimitiveValues;
type SourceStreamData = CollectionSource | AirbyteStreamData;

const initialState: SourceEditorState = {
  configuration: { config: {}, errorsCount: 0 },
  streams: { streams: [], errorsCount: 0 },
  connections: { destinations: [], errorsCount: 0 },
  stateChanged: false
};

enum SourceEditorActionsTypes {
  UPDATE_CONFIGURATION = 'UPDATE_CONFIGURATION',
  UPDATE_STREAMS = 'UPDATE_STREAMS',
  UPDATE_CONNECTIONS = 'UPDATE_CONNECTIONS'
}

type UpdateConfigurationAction = {
  type: SourceEditorActionsTypes.UPDATE_CONFIGURATION;
  payload: Partial<ConfigurationState>;
};

type UpdateStreamsAction = {
  type: SourceEditorActionsTypes.UPDATE_STREAMS;
  payload: Partial<StreamsState>;
};

type UpdateConnectionsAction = {
  type: SourceEditorActionsTypes.UPDATE_CONNECTIONS;
  payload: Partial<ConnectionsState>;
};

type SourceEditorActions =
  | UpdateConfigurationAction
  | UpdateStreamsAction
  | UpdateConnectionsAction;

const reducer = (state: SourceEditorState, action: SourceEditorActions) => {
  switch (action.type) {
    case SourceEditorActionsTypes.UPDATE_CONFIGURATION:
      return state;
    case SourceEditorActionsTypes.UPDATE_STREAMS:
      return state;
    case SourceEditorActionsTypes.UPDATE_CONNECTIONS:
      return state;
    // default:
    //   throw new Error(
    //     `Internal error. Please, file an issue.\nError Details: SourceEditor state reducer encountered an unknown action type: ${
    //       (action as any).type
    //     }.`
    //   );
  }
};

/**
 * Actions factories
 */

/** */
const updateConfigurationState = (
  payload: UpdateConfigurationAction['payload']
): UpdateConfigurationAction => ({
  type: SourceEditorActionsTypes.UPDATE_CONFIGURATION,
  payload
});

/** */
const updateStreamsState = (
  payload: UpdateStreamsAction['payload']
): UpdateStreamsAction => ({
  type: SourceEditorActionsTypes.UPDATE_STREAMS,
  payload
});

/** */
const updateConnectionsState = (
  payload: UpdateConnectionsAction['payload']
): UpdateConnectionsAction => ({
  type: SourceEditorActionsTypes.UPDATE_CONNECTIONS,
  payload
});
