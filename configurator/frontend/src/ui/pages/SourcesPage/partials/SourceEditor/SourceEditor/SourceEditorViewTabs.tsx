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
import { SourceEditorState, SetSourceEditorState } from "./SourceEditor"
import { TabName } from "ui/components/Tabs/TabName"

type SourceEditorTabsViewProps = {
  state: SourceEditorState
  sourceId: string
  editorMode: "add" | "edit"
  showTabsErrors: boolean
  showDocumentationDrawer: boolean
  initialSourceDataFromBackend: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  configIsValidatedByStreams: boolean
  setSourceEditorState: SetSourceEditorState
  setTabsErrorsVisible: (value: boolean) => void
  setConfigIsValidatedByStreams: (value: boolean) => void
  setShowDocumentationDrawer: (value: boolean) => void
  handleBringSourceData: () => SourceData
  handleSave: AsyncUnknownFunction
  handleTestConnection: AsyncUnknownFunction
  handleLeaveEditor: VoidFunction
}

export const SourceEditorViewTabs: React.FC<SourceEditorTabsViewProps> = ({
  state,
  sourceId,
  editorMode,
  showTabsErrors,
  showDocumentationDrawer,
  initialSourceDataFromBackend,
  sourceDataFromCatalog,
  configIsValidatedByStreams,
  setSourceEditorState,
  setTabsErrorsVisible,
  setConfigIsValidatedByStreams,
  setShowDocumentationDrawer,
  handleBringSourceData,
  handleSave,
  handleTestConnection,
  handleLeaveEditor,
}) => {
  return (
    <>
      <div className={cn("flex flex-col items-stretch flex-auto")}>
        <div className={cn("flex-grow")}>
          <Tabs
            type="card"
            defaultActiveKey="configuration"
            tabBarExtraContent={
              <SourceEditorViewTabsExtraControls
                sourceId={sourceId}
                sourceDataFromCatalog={sourceDataFromCatalog}
                showLogsButton={editorMode === "edit"}
                setDocumentationVisible={setShowDocumentationDrawer}
              />
            }>
            <Tabs.TabPane
              key="configuration"
              tab={
                <TabName
                  name="Configuration"
                  errorsCount={state.configuration.errorsCount}
                  hideErrorsCount={!showTabsErrors}
                />
              }
              forceRender>
              <SourceEditorFormConfiguration
                editorMode={editorMode}
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                sourceDataFromCatalog={sourceDataFromCatalog}
                setSourceEditorState={setSourceEditorState}
                setTabErrorsVisible={setTabsErrorsVisible}
                setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
              />
            </Tabs.TabPane>
            <Tabs.TabPane
              key="streams"
              tab={<TabName name="Streams" errorsCount={state.streams.errorsCount} hideErrorsCount={!showTabsErrors} />}
              forceRender>
              <SourceEditorFormStreams
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                sourceDataFromCatalog={sourceDataFromCatalog}
                sourceConfigValidatedByStreamsTab={configIsValidatedByStreams}
                setSourceEditorState={setSourceEditorState}
                setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
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
              forceRender>
              <SourceEditorFormConnections
                initialSourceDataFromBackend={initialSourceDataFromBackend}
                setSourceEditorState={setSourceEditorState}
              />
            </Tabs.TabPane>
          </Tabs>
        </div>

        <div className="flex-shrink border-t pt-2">
          <SourceEditorViewControls
            saveButton={{
              showErrorsPopover: false,
              handleClick: handleSave,
            }}
            testConnectionButton={{
              showErrorsPopover: false,
              handleClick: handleTestConnection,
            }}
            handleCancel={handleLeaveEditor}
          />
        </div>
      </div>

      <Prompt
        message={"You have unsaved changes. Are you sure you want to leave without saving?"}
        when={state.stateChanged}
      />

      {sourceDataFromCatalog?.documentation && (
        <SourceEditorDocumentationDrawer
          visible={showDocumentationDrawer}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setVisible={setShowDocumentationDrawer}
        />
      )}
    </>
  )
}
