import * as React from "react"
import { useEffect, useState } from "react"
import { Code } from "../../Code/Code"
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"
import { Badge, Table, Tabs, Tooltip } from "antd"
import cn from "classnames"
import { Event, EventStatus, EventType } from "../shared"
import orderBy from "lodash/orderBy"
import { CodeInline } from "../../components"

/**
 * Tries to turn string into JSON if possible (=string contains valid JSON)
 * @param str
 */
export function tryParseJson(str: any) {
  if (typeof str === "string") {
    try {
      return JSON.parse(str)
    } catch (e) {
      return str
    }
  } else {
    return str
  }
}

/**
 * Attempts to make JSON look nicer
 * @param obj
 */
export function preprocessJson(obj: any) {
  if (obj.body) {
    obj.body = tryParseJson(obj.body)
  }
  if (obj.jitsu_sdk_extras) {
    obj.jitsu_sdk_extras = tryParseJson(obj.jitsu_sdk_extras)
  }
  return obj
}

function getResultView(obj: any) {
  if (obj.table && obj.record && Array.isArray(obj.record)) {
    let data = [...obj.record]
    data = orderBy(data, "field")
    return (
      <div>
        The event has been recorded to table <CodeInline>{obj.table}</CodeInline> with following structure:
        <Table
          className="mt-4"
          pagination={false}
          size="small"
          columns={[
            {
              title: "Column Name",
              dataIndex: "field",
              key: "field",
            },
            {
              title: "Column Type",
              dataIndex: "type",
              key: "type",
            },
            {
              title: "Value",
              dataIndex: "value",
              key: "value",
            },
          ]}
          dataSource={data}
        />
      </div>
    )
  }
  return (
    <Code className="bg-bgSecondary rounded-xl p-6 text-xs" language="json">
      {JSON.stringify(preprocessJson(obj), null, 2)}
    </Code>
  )
}

function trim(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str
  } else {
    return str.substr(0, maxLen - 3) + "..."
  }
}

const TabTitle: React.FC<{ icon: any; error?: boolean }> = ({ icon, error, children }) => {
  const maxLen = 50
  const titleString = children.toString()
  const title = (
    <div className="align-baseline flex items-center">
      <span className="inline-block h-6 w-6 pr-2">{icon}</span>
      <span>{trim(titleString, maxLen)}</span>
    </div>
  )
  const content = titleString.length > maxLen ? <Tooltip title={children}>{title}</Tooltip> : title
  return error ? (
    <Badge count={"!"} size="small">
      {content}
    </Badge>
  ) : (
    content
  )
}

export const EventsView: React.FC<{
  event: Event
  className?: string
  allDestinations: Record<string, DestinationData>
}> = ({ event, allDestinations, className }) => {
  const codeProps = { className: "bg-bgSecondary rounded-xl p-6 text-xs", language: "json" }
  const [opacityStyle, setOpacityStyle] = useState("opacity-0")
  useEffect(() => {
    setTimeout(() => {
      setOpacityStyle("opacity-100")
    }, 0)
  })

  if (event.type === EventType.Token) {
    return event.status === EventStatus.Error ? (
      <>
        <div className="font-monospace flex justify-left items-center text-error mt-3 mb-3">{event.rawJson.error}</div>
        <Code {...codeProps}>{event.rawJson.malformed}</Code>
      </>
    ) : (
      <>
        {event.resultJson && event.status === EventStatus.Skip ? (
          <div className="font-monospace flex justify-left items-center text-warning mt-3 mb-3">
            Event was skipped: {event.resultJson}
          </div>
        ) : null}
        <Code {...codeProps}>{JSON.stringify(event.rawJson, null, 2)}</Code>
      </>
    )
  }

  const destination = allDestinations[event.entityId]
  const destinationType = destinationsReferenceMap[destination._type]

  let display
  if (event.status === EventStatus.Error) {
    display = (
      <div className="font-monospace flex justify-center items-center text-error">
        {JSON.stringify(event.resultJson)} (error)
      </div>
    )
  } else if (event.status === EventStatus.Pending) {
    display = (
      <div className="font-monospace flex justify-center items-center text-warning">
        Event is in queue and hasn't been sent to {destination._id} yet
      </div>
    )
  } else if (event.status === EventStatus.Skip) {
    display = (
      <div className="font-monospace flex justify-center items-center">
        Event was skipped: {JSON.stringify(event.resultJson)}
      </div>
    )
  } else {
    display = getResultView(event.resultJson)
  }

  return (
    <Tabs
      tabPosition="left"
      defaultActiveKey="original"
      className={cn(className, opacityStyle, "transition-all duration-1000")}
    >
      <Tabs.TabPane
        tab={
          <TabTitle
            icon={
              <svg fill="currentColor" viewBox="0 0 50 50" width="100%" height="100%">
                <path d="M 17.226563 46.582031 C 17.105469 46.582031 16.984375 46.5625 16.871094 46.519531 C 7.976563 43.15625 2 34.507813 2 25 C 2 12.316406 12.316406 2 25 2 C 37.683594 2 48 12.316406 48 25 C 48 34.507813 42.023438 43.15625 33.128906 46.519531 C 32.882813 46.613281 32.605469 46.605469 32.363281 46.492188 C 32.121094 46.386719 31.933594 46.183594 31.839844 45.9375 L 26.890625 32.828125 C 26.695313 32.3125 26.953125 31.734375 27.472656 31.539063 C 30.179688 30.519531 32 27.890625 32 25 C 32 21.140625 28.859375 18 25 18 C 21.140625 18 18 21.140625 18 25 C 18 27.890625 19.820313 30.519531 22.527344 31.539063 C 23.046875 31.734375 23.304688 32.3125 23.109375 32.828125 L 18.160156 45.933594 C 18.066406 46.183594 17.878906 46.382813 17.636719 46.492188 C 17.507813 46.554688 17.367188 46.582031 17.226563 46.582031 Z" />
              </svg>
            }
          >
            original
          </TabTitle>
        }
        key="original"
      >
        <Code {...codeProps}>{JSON.stringify(event.rawJson, null, 2)}</Code>
      </Tabs.TabPane>
      <Tabs.TabPane
        tab={
          <TabTitle error={event.status === "error"} icon={destinationType.ui.icon}>
            {destination.displayName || destination._id}
          </TabTitle>
        }
        key={event.entityId}
      >
        {display}
      </Tabs.TabPane>
    </Tabs>
  )
}
