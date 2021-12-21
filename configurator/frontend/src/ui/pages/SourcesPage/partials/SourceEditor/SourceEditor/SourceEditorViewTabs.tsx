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
  sourceDataFromCatalog: SourceConnector
  controlsDisabled: SourceEditorControlsDisabled
  handleSave: AsyncUnknownFunction
  handleValidateAndTestConfig: AsyncUnknownFunction
  handleLeaveEditor: VoidFunction
  setShowDocumentationDrawer: (value: boolean) => void
}

export const SourceEditorViewTabs: React.FC<SourceEditorViewTabsProps> = ({
  tabs,
  sourceDataFromCatalog,
  controlsDisabled,
  handleSave,
  handleValidateAndTestConfig,
  handleLeaveEditor,
  setShowDocumentationDrawer,
}) => {
  const [currentTab, setCurrentTab] = useState<number>(0)
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false)

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true)
    try {
      await handleValidateAndTestConfig()
    } catch (error) {
      actionNotification.error(`${error}`)
    } finally {
      setIsTestingConnection(false)
    }
  }, [handleValidateAndTestConfig])

  return (
    <div className={cn("flex flex-col items-stretch flex-grow-0 flex-shrink h-full min-h-0")}>
      <Tabs
        type="card"
        className={styles.tabCard}
        // activeKey={"configuration"}
        // onChange={onTabChange}
        tabBarExtraContent={
          <TabsExtra
            sourceDataFromCatalog={sourceDataFromCatalog}
            setShowDocumentationDrawer={setShowDocumentationDrawer}
          />
        }
      >
        {tabs.map((tab: Tab) => {
          return (
            <React.Fragment key={tab.key}>
              <Tabs.TabPane
                key={tab.key}
                tab={<TabName name={tab.title} errorsCount={tab.errorsCount ?? 0} />}
                // tab={tab.title}
                forceRender
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
