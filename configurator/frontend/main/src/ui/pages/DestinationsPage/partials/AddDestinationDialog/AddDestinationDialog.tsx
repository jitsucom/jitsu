// @Libs
import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Link, generatePath, useHistory } from "react-router-dom"
import { Badge, Input, Modal, Switch } from "antd"
import cn from "classnames"
import debounce from "lodash/debounce"
// @Catalog destinations
import { destinationsReferenceList, destinationsReferenceMap } from "@jitsu/catalog"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Styles
import styles from "./AddDestinationDialog.module.less"
// @Types
import { Destination } from "@jitsu/catalog"
// @Icons
import { StarOutlined, StarFilled, ExclamationCircleOutlined } from "@ant-design/icons"
// @Routes
import { useServices } from "hooks/useServices"
import Checkbox from "antd/es/checkbox/Checkbox"
import destinationsPage from "../../DestinationsPage"
import { destinationPageRoutes } from "../../DestinationsPage.routes"
import { projectRoute } from "../../../../../lib/components/ProjectLink/ProjectLink"

/**
 * All not hidden destinations
 * Sort:
 * 1. native connectors
 * 4. deprecated(disabled)
 */

const allAvailableDestinations: Destination[] = destinationsReferenceList
  .filter(d => !d.hidden)
  .sort((a, b) => {
    if (a.deprecated && !b.deprecated) {
      return 1
    } else if (!a.deprecated && b.deprecated) {
      return -1
    }
    return a.displayName.localeCompare(b.displayName)
  })
  .map(d => d as Destination)

const destinations = {
  "Data Warehouses": allAvailableDestinations.filter(d => d.type === "database"),
  Services: allAvailableDestinations.filter(d => d.type === "other" && !d.community),
  "Community Plugins": allAvailableDestinations.filter(d => d.type === "other" && d.community),
}

const AddDestinationDialogComponent = () => {
  const history = useHistory()

  const [filterParam, setFilterParam] = useState<string>()
  const services = useServices()
  const [showDeprecatedDestinations, setShowDeprecatedDestinations] = useState(false)

  const handleClick = (dst: Destination) => (e: React.MouseEvent) => {
    if (dst.deprecated) {
      e.stopPropagation()
      e.preventDefault()
      services.analyticsService.track("deprecated_destination_attempt", {
        app: services.features.appName,
        connector_id: dst.id,
      })

      Modal.confirm({
        title: (
          <>
            <b>{dst.displayName}</b> - deprecated version notice!
          </>
        ),
        icon: <ExclamationCircleOutlined />,
        content: (
          <>
            {dst.deprecatedReplacement ? (
              <span>
                This version is not recommended to use because newer version{" "}
                <a href={projectRoute(destinationPageRoutes.newExact, { type: dst.deprecatedReplacement })}>
                  {destinationsReferenceMap[dst.deprecatedReplacement].displayName}
                </a>{" "}
                is available. Please use it instead.
              </span>
            ) : (
              <span>
                <b>{dst.displayName}</b> is not recommended to use due to known stability or compatibility issues.
              </span>
            )}
            <br />
            <br />
            Add deprecated version anyway?
          </>
        ),
        okText: "Add",
        cancelText: "Cancel",
        onOk: () => {
          services.analyticsService.track('"deprecated_destination_added', {
            app: services.features.appName,
            connector_id: dst.id,
          })
          history.push(projectRoute(destinationPageRoutes.newExact, { type: dst.id }))
        },
      })
    }
  }

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilterParam(e.target.value)
    }, []),
    500
  )

  const filterDestinationList = useCallback(
    dsts =>
      (filterParam
        ? dsts.filter(
            (dst: Destination) =>
              dst.displayName.toLowerCase().includes(filterParam.toLowerCase()) ||
              dst.id.toLowerCase().includes(filterParam.toLowerCase())
          )
        : dsts
      ).filter(d => showDeprecatedDestinations || !d.deprecated),
    [filterParam, showDeprecatedDestinations]
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
            placeholder="Filter by destination name or id"
            onChange={handleChange}
            className={styles.filterInput}
          />
        </div>
        <div className="pl-3 pt-2 flex items-center justify-end">
          <Switch size="small" onChange={checked => setShowDeprecatedDestinations(checked)} />
          <div className="px-3 font-sm text-secondaryText">Show deprecated destinations</div>
        </div>
      </div>
      {Object.keys(destinations).map(type => (
        <div key={type}>
          <h3>{type}:</h3>
          <div className={styles.list}>
            {filterDestinationList(destinations[type]).map((dst: Destination) => (
              <Link
                to={projectRoute(destinationPageRoutes.newExact, { type: dst.id })}
                key={dst.id}
                className={`${styles.item} ${dst.deprecated ? styles.item__disabled : ""}`}
                onClick={handleClick(dst)}
              >
                <span className={styles.pic}>{dst.ui.icon}</span>
                <span className={styles.title}>{dst.displayName}</span>
                {dst.deprecated ? <Badge.Ribbon text="Deprecated" className={styles.expertLabel} /> : <></>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

AddDestinationDialogComponent.displayName = "AddDestinationDialog"

export const AddDestinationDialog = memo(AddDestinationDialogComponent)
