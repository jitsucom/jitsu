import { destinationsStore } from "../../../stores/destinations"
import { observer } from "mobx-react-lite"
import { useHistory, useLocation } from "react-router-dom"
import { Tabs } from "antd"
import * as React from "react"
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
import styles from "./EventsSteam.module.less"
import { apiKeysStore } from "../../../stores/apiKeys"
import { apiKeysReferenceMap } from "@jitsu/catalog/apiKeys/lib"
import { EventsList } from "./components/EventsList"
import { EventType, FilterOption } from "./shared"

const EventStreamComponent = () => {
  const location = useLocation()
  const history = useHistory()
  const params = new URLSearchParams(location.search)
  const defaultActiveKey = params.get("type") ?? EventType.Token

  const destinationsOptions = destinationsStore.listIncludeHidden.map(d => {
    const icon = destinationsReferenceMap[d._type]?.ui.icon
    return { value: d._uid, label: d._id, icon } as FilterOption
  })
  const apiKeysOptions = apiKeysStore.list.map(key => {
    return { value: key.uid, label: key.comment ?? key.uid, icon: apiKeysReferenceMap.js.icon } as FilterOption
  })

  return (
    <Tabs
      className={styles.eventsTabs}
      type="card"
      defaultActiveKey={defaultActiveKey}
      destroyInactiveTabPane={true}
      onChange={() => history.push({ search: null })}
    >
      <Tabs.TabPane className={styles.eventsListTab} tab="Incoming events" key={EventType.Token}>
        <EventsList type={EventType.Token} filterOptions={apiKeysOptions} />
      </Tabs.TabPane>
      <Tabs.TabPane className={styles.eventsListTab} tab="Processed events" key={EventType.Destination}>
        <EventsList type={EventType.Destination} filterOptions={destinationsOptions} />
      </Tabs.TabPane>
    </Tabs>
  )
}

const EventStream = observer(EventStreamComponent)

EventStream.displayName = "EventStream"

export default EventStream
