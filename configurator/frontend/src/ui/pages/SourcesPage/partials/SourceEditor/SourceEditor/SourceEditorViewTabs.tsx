import cn from "classnames"
import React, { useCallback, useState } from "react"
import { Tabs } from "antd"
import { SourceEditorControlsDisabled, SourceEditorViewControls } from "./SourceEditorViewControls"
import styles from "./SourceEditor.module.less"
import { NavLink, generatePath } from "react-router-dom"
import { taskLogsPageRoute } from "ui/pages/TaskLogs/TaskLogsPage"
import { SourceConnector } from "catalog/sources/types"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { TabName } from "ui/components/Tabs/TabName"
import { HandleSaveSource, HandleValidateTestConnection, SourceEditorDisabledTabs } from "./SourceEditor"
import { ErrorDetailed } from "lib/commons/errors"
import { uniqueId } from "lodash"

type Tab = {
  key: string
  title: string
  description: string
  render: React.ReactNode
  proceedButtonTitle?: string
  errorsCount?: number
  proceedAction?: AsyncUnknownFunction
}

type SourceEditorViewTabsProps = {
  tabs: Tab[]
  tabsDisabled: SourceEditorDisabledTabs
  sourceDataFromCatalog: SourceConnector
  controlsDisabled: SourceEditorControlsDisabled
  handleSave: HandleSaveSource
  handleValidateAndTestConnection: HandleValidateTestConnection
  handleLeaveEditor: VoidFunction
  setShowDocumentationDrawer: (value: boolean) => void
}

export const SourceEditorViewTabs: React.FC<SourceEditorViewTabsProps> = ({
  tabs,
  tabsDisabled,
  sourceDataFromCatalog,
  controlsDisabled,
  handleSave: _handleSave,
  handleValidateAndTestConnection,
  handleLeaveEditor,
  setShowDocumentationDrawer,
}) => {
  const [currentTab, setCurrentTab] = useState<string>("configuration")
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false)

  const [streamsTabKey, setStreamsTabKey] = useState<string>("streams")

  const handleTabChange = useCallback((key: string) => setCurrentTab(key), [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await _handleSave()
    } catch (error) {
      handleConnectOrSaveError(error)
    } finally {
      setIsSaving(false)
    }
  }, [_handleSave])

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true)
    try {
      await handleValidateAndTestConnection()
      actionNotification.success("Successfully connected")
    } catch (error) {
      handleConnectOrSaveError(error)
    } finally {
      setIsTestingConnection(false)
    }
  }, [handleValidateAndTestConnection])

  const handleConnectOrSaveError = (error: unknown) => {
    if (!(error instanceof ErrorDetailed)) {
      actionNotification.error(`${error}`)
      return
    }

    switch (error.name) {
      case "streams_changed": {
        actionNotification.warn(
          `Some of the previously selected streams are not available. Please, review your streams selection before saving.`
        )
        switchToAndReloadStreamsTab()
        return
      }
      default: {
        actionNotification.error(error.message)
        return
      }
    }
  }

  const switchToAndReloadStreamsTab = () => {
    const newStreamsTabKey = uniqueId("streams-")
    setStreamsTabKey(newStreamsTabKey)
    setCurrentTab(newStreamsTabKey)
  }

  return (
    <div className={cn("flex flex-col items-stretch flex-grow-0 flex-shrink h-full min-h-0")}>
      <Tabs
        type="card"
        className={styles.tabCard}
        activeKey={currentTab}
        onChange={handleTabChange}
        tabBarExtraContent={
          <TabsExtra
            sourceDataFromCatalog={sourceDataFromCatalog}
            setShowDocumentationDrawer={setShowDocumentationDrawer}
          />
        }
      >
        {tabs.map((tab: Tab) => {
          const key = tab.key === "streams" ? streamsTabKey : tab.key
          return (
            <React.Fragment key={key}>
              <Tabs.TabPane
                key={key}
                tab={<TabName name={tab.title} errorsCount={tab.errorsCount ?? 0} />}
                disabled={tabsDisabled?.has(tab.key)}
              >
                {tab.render}
              </Tabs.TabPane>
            </React.Fragment>
          )
        })}
      </Tabs>

      <div className="flex items-center flex-shrink flex-grow-0 border-t py-2">
        <SourceEditorViewControls
          mainButton={{
            title: "Save",
            loading: isSaving,
            handleClick: handleSave,
          }}
          dashedButton={{
            title: "Test Connection",
            loading: isTestingConnection,
            handleClick: handleTestConnection,
          }}
          dangerButton={{
            title: "cancel",
            handleClick: handleLeaveEditor,
          }}
          controlsDisabled={controlsDisabled}
        />
      </div>
    </div>
  )
}

const TabsExtra: React.FC<{
  sourceDataFromCatalog: SourceConnector
  setShowDocumentationDrawer: (value: boolean) => void
}> = ({ sourceDataFromCatalog, setShowDocumentationDrawer }) => {
  return (
    <span className="uppercase">
      <NavLink
        to={generatePath(taskLogsPageRoute, {
          sourceId: sourceDataFromCatalog.id ?? "not_found",
        })}
      >
        View Logs
      </NavLink>

      {sourceDataFromCatalog?.documentation && (
        <>
          {" "}
          <span className="text-link text-xl">•</span>{" "}
          <a onClick={() => setShowDocumentationDrawer(true)}>Documentation</a>
        </>
      )}
    </span>
  )
}
