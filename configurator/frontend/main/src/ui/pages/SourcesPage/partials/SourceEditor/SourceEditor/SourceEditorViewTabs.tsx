import cn from "classnames"
import React, { useCallback, useMemo, useState } from "react"
import { Tabs } from "antd"
import { SourceEditorViewControls } from "./SourceEditorViewControls"
import styles from "./SourceEditor.module.less"
import { NavLink } from "react-router-dom"
import { SourceConnector } from "@jitsu/catalog/sources/types"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { TabName } from "ui/components/Tabs/TabName"
import { HandleSaveSource, HandleValidateTestConnection } from "./SourceEditor"
import { ErrorDetailed } from "lib/commons/errors"
import { uniqueId } from "lodash"
import { projectRoute } from "../../../../../../lib/components/ProjectLink/ProjectLink"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { useSourceEditorState } from "./SourceEditor.state"

type Tab = {
  key: string
  title: string
  description: string
  errorsCount?: number
  render: React.ReactNode
  proceedButtonTitle?: string
  proceedAction?: AsyncUnknownFunction
}

type SourceEditorViewTabsProps = {
  sourceId: string
  tabs: Tab[]
  sourceDataFromCatalog: SourceConnector
  handleSave: HandleSaveSource
  handleValidateAndTestConnection: HandleValidateTestConnection
  handleLeaveEditor: VoidFunction
  setShowDocumentationDrawer: (value: boolean) => void
}

const disabledTabsKeys = new Set<string>()

export const SourceEditorViewTabs: React.FC<SourceEditorViewTabsProps> = ({
  sourceId,
  tabs,
  sourceDataFromCatalog,
  handleSave: _handleSave,
  handleValidateAndTestConnection,
  handleLeaveEditor,
  setShowDocumentationDrawer,
}) => {
  const sourceEditorViewState = useSourceEditorState()

  const [currentTab, setCurrentTab] = useState<string>("configuration")
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false)

  const [streamsTabKey, setStreamsTabKey] = useState<string>("streams")

  const disabledTabs = useMemo<Set<string>>(() => {
    const { isLoadingConfig, isLoadingOauthStatus, isOauthFlowCompleted } = sourceEditorViewState.status

    /** Streams tab handling */
    isLoadingConfig || isLoadingOauthStatus || !isOauthFlowCompleted
      ? disabledTabsKeys.add(streamsTabKey)
      : disabledTabsKeys.delete(streamsTabKey)

    return disabledTabsKeys
  }, [sourceEditorViewState.status, streamsTabKey])

  const handleTabChange = useCallback((_key: string) => {
    let key = _key
    // reset streams tab key to re-mount the component to reload the list of streams
    if (key.includes("streams")) {
      key = uniqueId("streams-")
      setStreamsTabKey(key)
    }
    setCurrentTab(key)
  }, [])

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
        switchToStreamsTab()
        return
      }
      default: {
        actionNotification.error(error.message)
        return
      }
    }
  }

  const switchToStreamsTab = () => {
    setCurrentTab(streamsTabKey)
  }

  return (
    <div className={cn("flex flex-col items-stretch flex-grow-0 flex-shrink h-full min-h-0")}>
      <Tabs
        type="card"
        className={styles.tabCard}
        activeKey={currentTab}
        tabBarExtraContent={
          <TabsExtra
            sourceId={sourceId}
            sourceDataFromCatalog={sourceDataFromCatalog}
            setShowDocumentationDrawer={setShowDocumentationDrawer}
          />
        }
        onChange={handleTabChange}
      >
        {tabs.map((tab: Tab) => {
          const tabKey = tab.key === "streams" ? streamsTabKey : tab.key
          return (
            <Tabs.TabPane
              key={tabKey}
              tab={<TabName name={tab.title} errorsCount={tab.errorsCount ?? 0} />}
              disabled={disabledTabs.has(tabKey)}
            >
              {tab.render}
            </Tabs.TabPane>
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
        />
      </div>
    </div>
  )
}

const TabsExtra: React.FC<{
  sourceId: string
  sourceDataFromCatalog: SourceConnector
  setShowDocumentationDrawer: (value: boolean) => void
}> = ({ sourceId, sourceDataFromCatalog, setShowDocumentationDrawer }) => {
  return (
    <span className="uppercase">
      <NavLink
        to={projectRoute(sourcesPageRoutes.logs, {
          sourceId: sourceId ?? "not_found",
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
