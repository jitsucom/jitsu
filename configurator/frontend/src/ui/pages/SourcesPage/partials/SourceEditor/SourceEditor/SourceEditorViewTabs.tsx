import { Tabs } from 'antd';
import cn from 'classnames';
import { Prompt } from 'react-router';
// @Components
import { SourceEditorFormConfiguration } from './SourceEditorFormConfiguration';
import { SourceEditorFormStreams } from './SourceEditorFormStreams';
import { SourceEditorFormConnections } from './SourceEditorFormConnections';
import { SourceEditorViewControls } from './SourceEditorViewControls';
import { SourceEditorViewTabsExtraControls } from './SourceEditorViewTabsExtraControls';
import { SourceEditorDocumentationDrawer } from './SourceEditorDocumentationDrawer';
// @Types
import { SourceConnector as CatalogSourceConnector } from 'catalog/sources/types';
import {
  UpdateConfigurationFields,
  AddStream,
  RemoveStream,
  SetStreams,
  AddConnection,
  RemoveConnection,
  SetConnections,
  UpdateStream,
  SourceEditorState,
  SetSourceEditorState
} from './SourceEditor';
import { TabName } from 'ui/components/Tabs/TabName';

type SourceEditorTabsViewProps = {
  state: SourceEditorState;
  sourceId: string;
  editorMode: 'add' | 'edit';
  stateChanged: boolean;
  showTabsErrors: boolean;
  showDocumentationDrawer: boolean;
  initialSourceDataFromBackend: Optional<Partial<SourceData>>;
  sourceDataFromCatalog: CatalogSourceConnector;
  configIsValidatedByStreams: boolean;
  isSaving: boolean;
  isTestingConnection: boolean;
  setState: SetSourceEditorState;
  setShowDocumentationDrawer: (value: boolean) => void;
  handleSetConfigValidatedByStreams: VoidFunction;
  onConfigurationChange: UpdateConfigurationFields;
  setConfigurationValidator: (validator: () => Promise<number>) => void;
  addStream: AddStream;
  removeStream: RemoveStream;
  updateStream: UpdateStream;
  setStreams: SetStreams;
  addConnection: AddConnection;
  removeConnection: RemoveConnection;
  setConnections: SetConnections;
  handleBringSourceData: () => SourceData;
  handleSave: VoidFunction;
  handleTestConnection: VoidFunction;
  handleLeaveEditor: VoidFunction;
};

export const SourceEditorViewTabs: React.FC<SourceEditorTabsViewProps> = ({
  state,
  sourceId,
  editorMode,
  stateChanged,
  showTabsErrors,
  showDocumentationDrawer,
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  configIsValidatedByStreams,
  isSaving,
  isTestingConnection,
  setState,
  setShowDocumentationDrawer,
  handleSetConfigValidatedByStreams,
  onConfigurationChange,
  setConfigurationValidator,
  addStream,
  removeStream,
  setStreams,
  updateStream,
  addConnection,
  removeConnection,
  setConnections,
  handleBringSourceData,
  handleSave,
  handleTestConnection,
  handleLeaveEditor
}) => {
  return (
    <>
      <div className={cn('flex flex-col items-stretch flex-auto')}>
        <div className={cn('flex-grow')}>
          <Tabs
            type="card"
            defaultActiveKey="configuration"
            tabBarExtraContent={
              <SourceEditorViewTabsExtraControls
                sourceId={sourceId}
                sourceDataFromCatalog={sourceDataFromCatalog}
                showLogsButton={editorMode === 'edit'}
                setDocumentationVisible={setShowDocumentationDrawer}
              />
            }
          >
            <Tabs.TabPane
              key="configuration"
              tab={
                <TabName
                  name="Configuration"
                  errorsCount={state.configuration.errorsCount}
                  hideErrorsCount={!showTabsErrors}
                />
              }
              forceRender
            >
              <SourceEditorFormConfiguration
                editorMode={editorMode}
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                sourceDataFromCatalog={sourceDataFromCatalog}
                onChange={onConfigurationChange}
                setValidator={setConfigurationValidator}
              />
            </Tabs.TabPane>
            <Tabs.TabPane
              key="streams"
              tab={
                <TabName
                  name="Streams"
                  errorsCount={state.streams.errorsCount}
                  hideErrorsCount={!showTabsErrors}
                />
              }
              forceRender
            >
              <SourceEditorFormStreams
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                sourceDataFromCatalog={sourceDataFromCatalog}
                sourceConfigValidatedByStreamsTab={configIsValidatedByStreams}
                setSourceEditorState={setState}
                handleSetConfigValidatedByStreams={
                  handleSetConfigValidatedByStreams
                }
                addStream={addStream}
                removeStream={removeStream}
                updateStream={updateStream}
                setStreams={setStreams}
                handleBringSourceData={handleBringSourceData}
              />
            </Tabs.TabPane>
            <Tabs.TabPane
              key="connections"
              tab={
                <TabName
                  name="Connections"
                  errorsCount={state.connections.errorsCount}
                  hideErrorsCount={!showTabsErrors}
                />
              }
              forceRender
            >
              <SourceEditorFormConnections
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                addConnection={addConnection}
                removeConnection={removeConnection}
                setConnections={setConnections}
              />
            </Tabs.TabPane>
          </Tabs>
        </div>

        <div className="flex-shrink border-t pt-2">
          <SourceEditorViewControls
            saveButton={{
              showErrorsPopover: false,
              loading: isSaving,
              handleClick: handleSave
            }}
            testConnectionButton={{
              showErrorsPopover: false,
              loading: isTestingConnection,
              handleClick: handleTestConnection
            }}
            handleCancel={handleLeaveEditor}
          />
        </div>
      </div>

      <Prompt
        message={
          'You have unsaved changes. Are you sure you want to leave without saving?'
        }
        when={stateChanged && !isSaving}
      />

      {sourceDataFromCatalog?.documentation && (
        <SourceEditorDocumentationDrawer
          visible={showDocumentationDrawer}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setVisible={setShowDocumentationDrawer}
        />
      )}
    </>
  );
};
