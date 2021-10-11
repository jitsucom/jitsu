// @Libs
import React, { useCallback, useState } from 'react';
import cn from 'classnames';
// @Types
import { CommonSourcePageProps } from 'ui/pages/SourcesPage/SourcesPage';
// @View
import { SourceEditorViewTabs } from './SourceEditorViewTabs';

type SourceEditorState = {
  configuration: ConfigurationState;
  streams: StreamsState;
  connections: ConnectionsState;
};

type CommonStateProperties = {
  errorsCount: number;
};

type ConfigurationState = {
  config: unknown;
} & CommonStateProperties;

type StreamsState = {
  streams: unknown[];
} & CommonStateProperties;

type ConnectionsState = {
  destinations: unknown[];
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
  connections: { destinations: [], errorsCount: 0 }
};

export const SourceEditor: React.FC<CommonSourcePageProps> = () => {
  /**
   * `useState` is currently used for drafting purposes
   * it will be changed to `useReducer` later on
   */
  const [state, setState] = useState<SourceEditorState>(initialState);

  const updateConfiguration = useCallback<UpdateConfigurationFields>(
    (newConfigurationFields) => {
      setState((state) => ({
        ...state,
        configuration: { ...state.configuration, ...newConfigurationFields }
      }));
    },
    []
  );

  const updateStreams = useCallback<UpdateStreamsFields>((newStreamsFields) => {
    setState((state) => ({
      ...state,
      streams: { ...state.streams, ...newStreamsFields }
    }));
  }, []);

  const updateConnections = useCallback<UpdateConnectionsFields>(
    (newConnectionsFields) => {
      setState((state) => ({
        ...state,
        connections: { ...state.connections, ...newConnectionsFields }
      }));
    },
    []
  );

  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto')}>
        <div className={cn('flex-grow')}>
          <SourceEditorViewTabs
            onConfigurationChange={updateConfiguration}
            onStreamsChange={updateStreams}
            onConnectionsChange={updateConnections}
          />
        </div>

        <div className="flex-shrink border-t pt-2">{/* Buttons */}</div>
      </div>

      {/* <Prompt /> -- for unsaved changes */}

      {/* <DocumentationDrawer /> */}
    </>
  );
};
