import { observer } from "mobx-react-lite"
import { useHistory, useLocation } from "react-router-dom"
import { Tabs } from "antd"
import * as React from "react"
import styles from "./EventsSteam.module.less"
import { EventsList } from "./components/EventsList"
import { EventType } from "./shared"
import { getAllApiKeysAsOptions, getAllDestinationsAsOptions } from "../Filters/shared"

const EventStreamComponent = () => {
  const location = useLocation()
  const history = useHistory()
  const params = new URLSearchParams(location.search)
  const defaultActiveKey = params.get("type") ?? EventType.Token

  return (
    <Tabs
      className={styles.eventsTabs}
      type="card"
      defaultActiveKey={defaultActiveKey}
      destroyInactiveTabPane={true}
      onChange={() => history.push({ search: null })}
    >
      <Tabs.TabPane className={styles.eventsListTab} tab="Incoming events" key={EventType.Token}>
        <EventsList type={EventType.Token} filterOptions={getAllApiKeysAsOptions()} />
      </Tabs.TabPane>
      <Tabs.TabPane className={styles.eventsListTab} tab="Processed events" key={EventType.Destination}>
        <EventsList type={EventType.Destination} filterOptions={getAllDestinationsAsOptions()} />
      </Tabs.TabPane>
    </Tabs>
  )
}

const EventStream = observer(EventStreamComponent)

EventStream.displayName = "EventStream"

export default EventStream
