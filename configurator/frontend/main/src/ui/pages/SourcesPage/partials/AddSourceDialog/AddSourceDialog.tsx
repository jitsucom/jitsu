// @Libs
import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Link, generatePath, useHistory } from "react-router-dom"
import { Badge, Input, Modal, Switch } from "antd"
import cn from "classnames"
import debounce from "lodash/debounce"
// @Catalog sources
import { allSources } from "@jitsu/catalog"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Styles
import styles from "./AddSourceDialog.module.less"
// @Types
import { SourceConnector } from "@jitsu/catalog"
// @Icons
import { StarOutlined, StarFilled, ExclamationCircleOutlined } from "@ant-design/icons"
// @Routes
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { useServices } from "hooks/useServices"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"

/**
 * All sources which are available for adding. Some filtering & sorting is applied
 * Sort:
 * 1. native connectors (protoType === undefined)
 * 2. not expert mode
 * 3. expert mode
 * 4. airbyte source on heroku (disabled)
 *
 * Airbyte connectors are disabled if the app is hosted using Heroku.
 */

const isAirbyteSourceOnHeroku = (source: SourceConnector): boolean => {
  return source.protoType === "airbyte" && ApplicationServices.get().features.environment === "heroku"
}

const allAvailableSources = allSources.sort((a, b) => {
  if (a.protoType === undefined && b.protoType !== undefined) {
    return -1
  } else if (a.protoType !== undefined && b.protoType === undefined) {
    return 1
  } else if (isAirbyteSourceOnHeroku(a) && !isAirbyteSourceOnHeroku(b)) {
    return 1
  } else if (!isAirbyteSourceOnHeroku(a) && isAirbyteSourceOnHeroku(b)) {
    return -1
  } else if (a.expertMode && !b.expertMode) {
    return 1
  } else if (!a.expertMode && b.expertMode) {
    return -1
  }
  return a.displayName.localeCompare(b.displayName)
})

const AddSourceDialogComponent = () => {
  const history = useHistory()

  const [filterParam, setFilterParam] = useState<string>()
  const services = useServices()
  const [showDeprecatedSources, setShowDeprecatedSources] = useState(false)

  const handleClick = (src: SourceConnector) => (e: React.MouseEvent) => {
    if (src.expertMode) {
      e.stopPropagation()
      e.preventDefault()
      services.analyticsService.track("singer_connector_attempt", {
        app: services.features.appName,
        connector_id: src.id,
      })

      Modal.confirm({
        title: (
          <>
            <b>{src.displayName}</b> - alpha version notice!
          </>
        ),
        icon: <ExclamationCircleOutlined />,
        content: (
          <>
            <b>{src.displayName}</b> connector is available as alpha version only, it requires an understanding of{" "}
            <a target="_blank" href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md">
              Singer Protocol
            </a>
            <br />
            <br />
            Do you want to continue?
          </>
        ),
        okText: "Add",
        cancelText: "Cancel",
        onOk: () => {
          services.analyticsService.track("singer_connector_added", {
            app: services.features.appName,
            connector_id: src.id,
          })
          history.push(projectRoute(sourcesPageRoutes.addExact, { source: src.id }))
        },
      })
    }

    if (isAirbyteSourceOnHeroku(src)) {
      e.stopPropagation()
      e.preventDefault()

      Modal.info({
        title: (
          <>
            <b>{src.displayName}</b> connector is not availabale for Heroku-based applications.
          </>
        ),
        icon: <ExclamationCircleOutlined />,
        content: (
          <>
            Currently, we do not support Airbyte sources for the applications deployed on Heroku due to its limited
            support for running docker containers inside docker container. To learn more, refer to{" "}
            <a
              target="_blank"
              href="https://devcenter.heroku.com/articles/container-registry-and-runtime#unsupported-dockerfile-commands"
            >
              Heroku documentation
            </a>
          </>
        ),
      })
    }
  }

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilterParam(e.target.value)
    }, []),
    500
  )

  const filteredSourcesList = useMemo<SourceConnector[]>(
    () =>
      filterParam
        ? allAvailableSources.filter(
            (src: SourceConnector) =>
              src.displayName.toLowerCase().includes(filterParam.toLowerCase()) ||
              src.id.toLowerCase().includes(filterParam.toLowerCase())
          )
        : allAvailableSources,
    [filterParam]
  )

  useEffect(() => {
    document.body.classList.add("custom-scroll-body")

    return () => document.body.classList.remove("custom-scroll-body")
  }, [])

  return (
    <div className={styles.dialog}>
      <div className={styles.filter}>
        <div className="flex-grow">
          <Input
            autoFocus
            placeholder="Filter by source name or id"
            onChange={handleChange}
            className={styles.filterInput}
          />
        </div>
        <div className="pl-3 pt-2 flex items-center justify-end">
          <Switch size="small" onChange={checked => setShowDeprecatedSources(checked)} />
          <div className="px-3 font-sm text-secondaryText">Show deprecated sources</div>
        </div>
      </div>

      <div className={styles.list}>
        {filteredSourcesList
          .filter(src => showDeprecatedSources || !src.deprecated)
          .map((src: SourceConnector) => (
            <Link
              to={generatePath(sourcesPageRoutes.addExact, { projectId: services.activeProject.id, source: src.id })}
              key={src.id}
              className={`${styles.item} ${isAirbyteSourceOnHeroku(src) ? styles.item__disabled : ""}`}
              onClick={handleClick(src)}
            >
              <span className={styles.pic}>{src.pic}</span>
              <span className={styles.title}>{src.displayName}</span>
              {src.protoType === "airbyte" && <span className={styles.airbyteLabel}>{"powered by Airbyte"}</span>}
              {src.protoType === "singer" && <span className={styles.airbyteLabel}>{"powered by Singer"}</span>}

              {src.expertMode ? (
                <Badge.Ribbon text="Expert mode" className={styles.expertLabel} />
              ) : src.protoType !== "airbyte" ? (
                <span className={styles.star}>
                  <StarOutlined className={cn(styles.starIcon, styles.strokeStar)} />
                  <StarFilled className={cn(styles.starIcon, styles.fillStar)} />
                </span>
              ) : (
                <></>
              )}
            </Link>
          ))}
      </div>
    </div>
  )
}

AddSourceDialogComponent.displayName = "AddSourceDialog"

export const AddSourceDialog = memo(AddSourceDialogComponent)
