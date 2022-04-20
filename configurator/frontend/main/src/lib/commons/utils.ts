import moment, { Duration, Moment } from "moment"
import { LS_ACCESS_KEY, LS_REFRESH_KEY } from "lib/services/UserServiceBackend"
import { assertHasOwnProperty, assertIsArray, assertIsObject } from "utils/typeCheck"
import { ReactNode } from "react"
import set from "lodash/set"

export function concatenateURLs(baseUrl: string, url: string) {
  let base = baseUrl.endsWith("/") ? baseUrl.substr(0, baseUrl.length - 1) : baseUrl
  return base + (url.startsWith("/") ? url : "/" + url)
}

/**
 * Sets debug info that is available as __enUIDebug in dev console. So far
 * sets the field in any case, later it will be possible to do in only in dev mode
 * @param field
 * @param obj
 */
export function setDebugInfo(field: string, obj: any, purify = true) {
  if (window) {
    if (!window["__enUIDebug"]) {
      window["__enUIDebug"] = {}
    }
    window["__enUIDebug"][field] = typeof obj === "object" && purify ? Object.assign({}, obj) : obj
  }
}

function circularReferencesReplacer() {
  let cache = []
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      // Duplicate reference found, discard key
      if (cache.includes(value)) return

      // Store value in our collection
      cache.push(value)
    }
    return value
  }
}

/**
 * Enhanced alert. Displays JSON representation of the
 * object and logs a copy to console
 */
export function alert(...object) {
  if (object.length === 1) {
    console.log("Object:", object[0])
    window.alert(JSON.stringify(object[0], circularReferencesReplacer(), 4))
  } else {
    console.log("Object:", object)
    window.alert(JSON.stringify(object, circularReferencesReplacer(), 4))
  }
}

export function isNullOrUndef(val) {
  return val === null || val === undefined
}

export function createError(msg: string, error?: any): Error {
  return new Error(error?.message ? `${msg}: ${error.message}` : msg)
}

export function withDefaultVal<T>(val: T, defaultVal: T): T {
  return isNullOrUndef(val) ? defaultVal : val
}

/**
 * First letter of string to lower ("Hello world!" -> "hello world").
 * Useful for nice messages display
 */
export function firstToLower(string: string) {
  if (string.length > 0) {
    return string.charAt(0).toLowerCase() + string.slice(1)
  }
  return string
}

/**
 * Fully reloads current page
 */
export function reloadPage(destination?: string) {
  if (!destination) {
    location.reload()
  } else {
    window.location.href = destination
  }
}

/**
 * Clean authorization tokens from local storage (without ApplicationServices context)
 */
export function cleanAuthorizationLocalStorage() {
  localStorage.removeItem(LS_ACCESS_KEY)
  localStorage.removeItem(LS_REFRESH_KEY)
}

type INumberFormatOpts = {}

type Formatter = (val: any) => string

export function numberFormat(opts?: INumberFormatOpts | any): any {
  if (opts == undefined) {
    return numberFormat({})
  } else if (typeof opts === "object") {
    return x => {
      if (x === undefined) {
        return "N/A"
      }
      return x.toLocaleString()
      //return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
    }
  } else {
    let formatter: Formatter = numberFormat({})
    return formatter(opts)
  }
}

export function withDefaults<T>(obj: T, defaults: Partial<T>): T {
  return { ...defaults, ...obj }
}

export function sleep(ms, retVal?: any | Error): Promise<void> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (retVal instanceof Error) {
        reject(retVal)
      } else {
        resolve(retVal)
      }
    }, ms)
  )
}

export function copyToClipboard(value, unescapeNewLines?: boolean) {
  const el = document.createElement("textarea")

  el.value = unescapeNewLines ? value.replace("\\\n", "") : value
  document.body.appendChild(el)
  el.select()
  document.execCommand("copy")
  document.body.removeChild(el)
}

export type TimeFormattedUserEvent = {
  time: Moment
  data: any
}

/**
 * Formats timestamps from raw user events to Moment.js format
 * and brings them to the top level of the object
 *
 * Assumes the following structure of raw events:
 *
 * @example
 * const rawEvents ={
 *  events: [
 *    {
 *      original: {
 *        _timestamp: <timestamp>
 *      }
 *    }
 *  ]
 * }
 *
 * @param {unknown} rawEvents object with raw user events
 * @returns array of objects with Moment time and rawEvent data
 *
 * @throws assertion error (if raw event data model is not supported)
 */
export function formatTimeOfRawUserEvents(rawEvents: unknown): TimeFormattedUserEvent[] {
  const ASSERTION_ERROR_PREDICATE = "Assertion error in formatTimeOfRawUserEvents function"

  assertIsObject(rawEvents, `${ASSERTION_ERROR_PREDICATE}: raw events is not an object`)
  assertHasOwnProperty(rawEvents, "events", `${ASSERTION_ERROR_PREDICATE}: raw events 'events' property not found`)
  const events = rawEvents.events

  assertIsArray(events, `${ASSERTION_ERROR_PREDICATE}: events content is not an array`)
  return events.map((rawEvent, index): TimeFormattedUserEvent => {
    assertIsObject(
      rawEvent,
      `${ASSERTION_ERROR_PREDICATE}: can not map raw events, raw event at index ${index} is not an object`
    )
    assertHasOwnProperty(
      rawEvent,
      "original",
      `${ASSERTION_ERROR_PREDICATE}: 'original' property not found in raw event at index ${index}`
    )

    const original = rawEvent.original
    assertIsObject(
      original,
      `${ASSERTION_ERROR_PREDICATE}: 'original' field of raw event at index ${index} is not an object`
    )
    assertHasOwnProperty(
      original,
      "_timestamp",
      `${ASSERTION_ERROR_PREDICATE}:  '_timestamp' property not found in raw event at index ${index}`
    )

    return {
      time: moment(original._timestamp),
      data: rawEvent,
    }
  })
}

/**
 * @param events - array of user events with Momet.js time at the top level
 * @returns array of same events sorted in descending order by time
 */
export function sortTimeFormattedUserEventsDescending(events: TimeFormattedUserEvent[]): TimeFormattedUserEvent[] {
  return events.sort((e1, e2) => {
    if (e1.time.isAfter(e2.time)) {
      return -1
    } else if (e2.time.isAfter(e1.time)) {
      return 1
    }
    return 0
  })
}

/**
 *
 * @param event user event with Momet.js time at the top level
 * @param timeAgo Moment.Duration period of time from the current date after which the latest event is considered to be 'a long ago'
 * @returns {boolean} Whether the event was before the (currentDate - timeAgo)
 */
export function userEventWasTimeAgo(event: TimeFormattedUserEvent, timeAgo: Duration): boolean {
  return event.time.isBefore(moment().subtract(timeAgo))
}

/**
 *
 * @param events Array of user events with Momet.js time at the top level
 * @returns the latest user event or null if input is empty array
 */
export function getLatestUserEvent(events: TimeFormattedUserEvent[]): TimeFormattedUserEvent | null {
  if (!events.length) return null
  return sortTimeFormattedUserEventsDescending(events)[0]
}

/**
 * Turns any object to string
 */
function safeToString(obj: any) {
  if (typeof obj === "string") {
    return obj
  } else if (obj?.toString && typeof obj?.toString === "function") {
    return obj.toString()
  } else {
    return obj + ""
  }
}

/**
 * Tries to the best to convert children from any type to string
 * @param children
 */
export function reactElementToString(children: ReactNode): string {
  if (!children) {
    return ""
  } else if (typeof children === "string") {
    return children
  } else if (Array.isArray(children)) {
    return children.map(reactElementToString).join("\n")
  } else {
    console.warn(`Can't convert react element to highlightable <Code />. Using to string`, safeToString(children))
  }
}

export function comparator<T>(f: (t: T) => any): (a1: T, a2: T) => number {
  return (a1: T, a2) => {
    let v1 = f(a1)
    let v2 = f(a2)
    if (v1 > v2) {
      return -1
    } else if (v1 < v2) {
      return 1
    }
    return 0
  }
}

export function trimMiddle(str: string, maxLen: number, ellisis = "...") {
  if (str.length <= maxLen) {
    return str
  } else {
    return str.substr(0, maxLen / 2 - (ellisis.length - 1)) + ellisis + str.substr(str.length - maxLen / 2 + 1)
  }
}

/**
 * Unflattens provided object.
 *
 * Example:
 *   {
 *     "x.y.z": 1,
 *     "a.b": 2
 *   }
 * is transformed into
 *   {
 *     "x": {
 *       "y": {
 *         "z": 1
 *        }
 *      },
 *      "a": {
 *        "b": 2
 *      }
 *   }
 *
 * Useful for saving form values into nested objects.
 *
 * @param values usually form.getFieldsValue()
 */
export function unflatten<T>(values: any): T {
  let result = {}
  for (let key of Object.keys(values)) {
    result = set(result, key, values[key])
  }

  return result as T
}

/**
 * Flattens provided nested object.
 *
 * Example:
 *   {
 *     "x": {
 *       "y": {
 *         "z": 1
 *        }
 *      },
 *      "a": {
 *        "b": 2
 *      }
 *   }
 * is transformed into
 *   {
 *     "x.y.z": 1,
 *     "a.b": 2
 *   }
 *
 * This is useful for setting form values
 *
 * @param data transfer object
 */
export function flatten(data: any): any {
  if (!data) {
    return
  }

  return Object.keys(data).reduce((acc, key) => {
    if (typeof data[key] !== "object" || !data[key]) {
      return {
        ...acc,
        [key]: data[key],
      }
    }

    const child = flatten(data[key])
    return {
      ...acc,
      ...Object.keys(child).reduce(
        (childAcc, childKey) => ({
          ...childAcc,
          [`${key}.${childKey}`]: child[childKey],
        }),
        {}
      ),
    }
  }, {})
}

export function getObjectDepth(value: unknown): number {
  return Object(value) === value ? 1 + Math.max(-1, ...Object.values(value).map(getObjectDepth)) : 0
}

export function sanitize<T>(
  obj: T,
  opts: { allow: string[]; block?: never } | { block: string[]; allow?: never }
): Partial<T> {
  const filter: (val) => boolean = opts.allow
    ? ([key]) => opts.allow.includes(key)
    : ([key]) => !opts.block.includes(key)
  return Object.entries(obj)
    .filter(filter)
    .reduce(
      (res, [key, value]) => ({
        ...res,
        [key]: value,
      }),
      {}
    )
}
