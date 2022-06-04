// @Libs
import { Badge, Button, Dropdown, Empty, Typography } from "antd"
import React, { useCallback, useEffect, useRef } from "react"
import { useHistory } from "react-router-dom"
import { observer } from "mobx-react-lite"
import LeaderLine from "leader-line-new"
// @Store
import { apiKeysStore } from "stores/apiKeys"
import { sourcesStore } from "stores/sources"
import { destinationsStore } from "stores/destinations"
// @Components
import { EntityCard } from "lib/components/EntityCard/EntityCard"
import { EntityIcon } from "lib/components/EntityIcon/EntityIcon"
import { DropDownList } from "ui/components/DropDownList/DropDownList"
// @Hooks
import { useServices } from "hooks/useServices"
// @Icons
import { PlusOutlined } from "@ant-design/icons"
// @Utils
import { APIKeyUtil } from "utils/apiKeys.utils"
import { DestinationsUtils } from "utils/destinations.utils"
import { SourcesUtils } from "utils/sources.utils"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
// @Reference
import { destinationPageRoutes } from "../DestinationsPage/DestinationsPage.routes"
// @Styles
import styles from "./ConnectionsPage.module.less"

const CONNECTION_LINE_SIZE = 3
const CONNECTION_LINE_COLOR = "#415969"
const CONNECTION_LINE_HIGHLIGHTED_COLOR = "#878afc"

const connectionLines: { [key: string]: LeaderLine } = {}

const ConnectionsPageComponent = () => {
  const history = useHistory()
  const containerRef = useRef<HTMLDivElement>(null)

  const updateLines = () => {
    destinationsStore.list.forEach(({ _uid, _onlyKeys = [], _sources = [] }) => {
      ;[..._onlyKeys, ..._sources].forEach(sourceId => {
        const start = document.getElementById(sourceId)
        const end = document.getElementById("dst_" + _uid)

        if (start && end && !connectionLines[`${sourceId}-${_uid}`])
          connectionLines[`${sourceId}-${_uid}`] = new LeaderLine(start, end, {
            endPlug: "behind",
            startSocket: "right",
            endSocket: "left",
            color: CONNECTION_LINE_COLOR,
            size: CONNECTION_LINE_SIZE,
          })
      })
    })
  }

  const handleAddClick = useCallback(() => {
    history.push(projectRoute(destinationPageRoutes.add))
  }, [history])

  const eraseLines = () => {
    Object.entries(connectionLines).forEach(([key, line]) => {
      line.remove()
      delete connectionLines[key]
    })
  }

  const handleCardMouseEnter = useCallback((sourceId: string) => {
    Object.keys(connectionLines).forEach(key => {
      if (key.startsWith(sourceId) || key.endsWith(sourceId)) {
        connectionLines[key]?.setOptions({
          color: CONNECTION_LINE_HIGHLIGHTED_COLOR,
        })
      } else {
        connectionLines[key]?.setOptions({ size: 0.01 })
      }
    })
  }, [])

  const handleCardMouseLeave = useCallback(() => {
    Object.keys(connectionLines).forEach(key => {
      connectionLines[key]?.setOptions({ color: CONNECTION_LINE_COLOR })
      connectionLines[key]?.setOptions({ size: CONNECTION_LINE_SIZE })
    })
  }, [])

  useEffect(() => {
    updateLines()
    return () => {
      eraseLines()
    }
  }, [destinationsStore.list, sourcesStore.list, apiKeysStore.list])

  return (
    <div ref={containerRef} className="relative flex justify-center w-full h-full overflow-y-auto">
      <div className="flex items-stretch w-full h-full max-w-3xl">
        <Column
          className="max-w-xs w-full"
          header={
            <div className="flex w-full mb-3">
              <h3 className="block flex-auto text-3xl mb-0">{"Sources"}</h3>
              <Dropdown
                trigger={["click"]}
                overlay={<AddSourceDropdownOverlay />}
                className="flex-initial"
                placement="bottomRight"
              >
                <Button type="ghost" size="large" icon={<PlusOutlined />}>
                  Add
                </Button>
              </Dropdown>
            </div>
          }
        >
          {!!apiKeysStore.list.length || !!sourcesStore.list.length ? (
            [
              ...apiKeysStore.list.map(apiKey => {
                return (
                  <CardContainer id={apiKey.uid} key={apiKey.uid}>
                    <EntityCard
                      name={<CardTitle title={APIKeyUtil.getDisplayName(apiKey)} />}
                      message={<EntityMessage connectionTestOk={true} />}
                      link={"/api-keys/edit/" + apiKey.uid}
                      icon={
                        <IconWrapper sizeTailwind={12}>
                          <EntityIcon entityType="api_key" />
                        </IconWrapper>
                      }
                      onMouseEnter={() => handleCardMouseEnter(apiKey.uid)}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  </CardContainer>
                )
              }),
              ...sourcesStore.list.map(source => {
                return (
                  <CardContainer id={source.sourceId} key={source.sourceId}>
                    <EntityCard
                      name={<CardTitle title={SourcesUtils.getDisplayName(source)} />}
                      message={<EntityMessage connectionTestOk={source.connected} />}
                      link={`/sources/edit/${source.sourceId}`}
                      icon={
                        <IconWrapper sizeTailwind={12}>
                          <EntityIcon entityType="source" entitySubType={source.sourceProtoType} />
                        </IconWrapper>
                      }
                      onMouseEnter={() => handleCardMouseEnter(source.sourceId)}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  </CardContainer>
                )
              }),
            ]
          ) : (
            <SourcesEmptyList />
          )}
        </Column>

        <Column />

        <Column
          className="max-w-xs w-full"
          header={
            <div className="flex w-full mb-3">
              <h3 className="block flex-auto text-3xl mb-0">{"Destinations"}</h3>
              <Button type="ghost" size="large" icon={<PlusOutlined />} onClick={handleAddClick}>
                Add
              </Button>
            </div>
          }
        >
          {destinationsStore.list.length ? (
            destinationsStore.list.map(dst => {
              return (
                <CardContainer id={"dst_" + dst._uid} key={"dst_" + dst._uid}>
                  <EntityCard
                    name={<CardTitle title={DestinationsUtils.getDisplayName(dst)} />}
                    message={<EntityMessage connectionTestOk={dst._connectionTestOk} />}
                    link={`/destinations/edit/${dst._id}`}
                    icon={
                      <IconWrapper sizeTailwind={12}>
                        <EntityIcon entityType="destination" entitySubType={dst._type} />
                      </IconWrapper>
                    }
                    onMouseEnter={() => handleCardMouseEnter(dst._uid)}
                    onMouseLeave={handleCardMouseLeave}
                  />
                </CardContainer>
              )
            })
          ) : (
            <DestinationsEmptyList />
          )}
        </Column>
      </div>
    </div>
  )
}

const ConnectionsPage = observer(ConnectionsPageComponent)
ConnectionsPage.displayName = "ConnectionsPage"

export default ConnectionsPage

const AddSourceDropdownOverlay: React.FC = () => {
  return (
    <DropDownList
      hideFilter
      list={[
        {
          id: "api_key",
          title: "Add JS Events API Key",
          link: projectRoute("/api-keys/new"),
        },
        {
          id: "connectors",
          title: "Add Connector Source",
          link: projectRoute("/sources/add"),
        },
      ]}
    />
  )
}

const EntityMessage: React.FC<{ connectionTestOk: boolean }> = ({ connectionTestOk }) => {
  return (
    <div>
      <Badge
        size="default"
        status={connectionTestOk ? "processing" : "error"}
        text={
          connectionTestOk ? (
            <span className={styles.processing}>{"Active"}</span>
          ) : (
            <span className={styles.error}>{"Connection test failed"}</span>
          )
        }
      />
    </div>
  )
}

const IconWrapper: React.FC<{ sizeTailwind: number }> = ({ children, sizeTailwind }) => {
  return <div className={`flex justify-center items-center h-${sizeTailwind} w-${sizeTailwind} m-3`}>{children}</div>
}

const Column: React.FC<{ header?: React.ReactNode; className?: string }> = ({ header, className, children }) => {
  return (
    <div className={`flex flex-col flex-auto ${className}`}>
      {header && <div>{header}</div>}
      <div className={`flex flex-col`}>{children}</div>
    </div>
  )
}

const CardContainer: React.FC<{ id: string }> = ({ id, children }) => {
  return (
    <div key={id} className={`my-2 w-full`} id={id}>
      {children}
    </div>
  )
}

const ELLIPSIS_SUFFIX_LENGTH = 3

const CardTitle: React.FC<{ title: string }> = ({ title }) => {
  const parsedTitle = {
    start: title.slice(0, title.length - ELLIPSIS_SUFFIX_LENGTH),
    end: title.slice(-ELLIPSIS_SUFFIX_LENGTH),
  }

  return (
    <Typography.Text
      className="w-full"
      ellipsis={{
        suffix: parsedTitle.end,
      }}
    >
      {parsedTitle.start}
    </Typography.Text>
  )
}

const DestinationsEmptyList: React.FC = () => {
  const services = useServices()
  return (
    <Empty
      className="mt-20"
      description={
        <span>
          The list is empty.{" "}
          {services.features.createDemoDatabase && (
            <>
              You can add a destination manually or{" "}
              <Button
                type="link"
                size="small"
                className={styles.linkButton}
                onClick={() => destinationsStore.createFreeDatabase()}
              >
                create a free demo database
              </Button>{" "}
              if you are just trying it out.
            </>
          )}
        </span>
      }
    />
  )
}

const SourcesEmptyList: React.FC = () => {
  return <Empty className="mt-20" description={`The list is empty`} />
}
