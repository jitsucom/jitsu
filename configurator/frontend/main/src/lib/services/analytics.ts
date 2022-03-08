import { FeatureSettings } from "./ApplicationServices"
// @ts-ignore
import LogRocket from "logrocket"
import murmurhash from "murmurhash"
import { isNullOrUndef, setDebugInfo } from "../commons/utils"
import { jitsuClient, JitsuClient } from "@jitsu/sdk-js"
import { getIntercom, initIntercom } from "lib/services/intercom-wrapper"
import { ApplicationConfiguration } from "./ApplicationConfiguration"

type ConsoleMessageListener = (level: string, ...args) => void

type IntercomClient = (...args) => void

type Executor<T> = (client: T, eventType: string, payload: any) => Promise<void> | void

interface AnalyticsExecutors extends Record<string, Executor<any>> {
  jitsu?: Executor<JitsuClient>
  intercom?: Executor<IntercomClient>
}

function defaultExecutors(execs: AnalyticsExecutors): AnalyticsExecutors {
  return {
    jitsu:
      execs?.jitsu ??
      ((jitsu, eventType, payload) => {
        if (!AnalyticsBlock.isBlocked()) {
          return jitsu.track(eventType, payload || {})
        }
      }),
    intercom:
      execs?.intercom ??
      ((intercom, eventType, payload) => {
        if (!AnalyticsBlock.isBlocked()) {
          intercom("trackEvent", eventType, payload || {})
        }
        return Promise.resolve()
      }),
  }
}

/**
 * Allows to block all calls to any analytics service. For become user feature
 */
export const AnalyticsBlock = {
  blockAll: () => {
    localStorage.setItem("jitsuBlockAllTracking", "true")
  },
  unblockAll: () => {
    localStorage.setItem("jitsuBlockAllTracking", "false")
  },
  isBlocked: (): boolean => {
    return localStorage.getItem("jitsuBlockAllTracking") === "true"
  },
}
class ConsoleLogInterceptor {
  private initialized: boolean = false
  private listeners: ConsoleMessageListener[] = []
  private originalError: (message?: any, ...optionalParams: any[]) => void

  public addListener(listener: ConsoleMessageListener) {
    this.listeners.push(listener)
  }

  public init() {
    if (this.initialized) {
      return
    }
    let interceptor = this

    ;(function () {
      interceptor.originalError = console.error
      console.error = function () {
        interceptor.listeners.forEach((listener: ConsoleMessageListener) => {
          try {
            listener("error", arguments)
          } catch (e) {
            console.warn("Error applying error listener")
          }
        })
        interceptor.originalError.apply(this, Array.prototype.slice.call(arguments))
      }
    })()
  }

  public error(message?: any, ...optionalParams: any[]) {
    this.originalError.apply(this, Array.prototype.slice.call(arguments))
  }
}

type ApiErrorInfo = {
  method: string
  url: string
  requestPayload: any
  responseStatus: number
  responseObject?: any
  errorMessage?: string
}

class ApiErrorWrapper extends Error {
  private apiDetails: ApiErrorInfo

  constructor(message: string, apiDetails: ApiErrorInfo) {
    super(message)
    this.apiDetails = apiDetails
  }
}

function findError(args: any): Error {
  if (typeof args === "string" || typeof args === "number" || typeof args === "boolean") {
    return null
  }
  args = Array.prototype.slice.call(args)
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (isError(arg)) {
      return arg
    } else if (Array.isArray(Array.prototype.slice.call(arg))) {
      let error = findError(arg)
      if (error) {
        return error
      }
    }
  }
  return null
}

function isError(obj: any) {
  if (isNullOrUndef(obj)) {
    return false
  }
  return (
    obj instanceof Error || obj.constructor.name === "Error" || (obj.message !== undefined && obj.stack !== undefined)
  )
}

export type UserProps = {
  name?: string
  email: string
  id: string
}

export function getErrorPayload(error: Error) {
  return {
    error_message: error.message ?? "Empty message",
    error_name: error.name ?? "name_unknown",
    error_stack: error.stack ?? "",
  }
}

export default class AnalyticsService {
  private globalErrorListenerPresent: boolean = false
  private appConfig: ApplicationConfiguration
  private user: UserProps
  private jitsu?: JitsuClient
  private logRocketInitialized: boolean = false
  private consoleInterceptor: ConsoleLogInterceptor = new ConsoleLogInterceptor()
  private _anonymizeUsers = false
  private _appName = "unknown"
  private buildId: string

  constructor(appConfig: ApplicationConfiguration) {
    this.appConfig = appConfig
    this.consoleInterceptor.init()
    if (this.appConfig.rawConfig.keys.eventnative && !AnalyticsBlock.isBlocked()) {
      this.jitsu = jitsuClient({
        key: this.appConfig.rawConfig.keys.eventnative,
        tracking_host: "https://t.jitsu.com",
        cookie_domain: "jitsu.com",
        randomize_url: true,
      })
      this.jitsu.set(
        {
          app: this._appName,
          buildId: appConfig.buildId,
        },
        {}
      )
    }
    this.setupGlobalErrorHandler()
    this.consoleInterceptor.addListener((level, ...args) => {
      let error = findError(args)
      if (error) {
        this.onGlobalError(error, true)
      }
    })
  }

  public ensureLogRocketInitialized() {
    if (!this.logRocketInitialized && this.appConfig.rawConfig.keys.logrocket && !AnalyticsBlock.isBlocked()) {
      LogRocket.init(this.appConfig.rawConfig.keys.logrocket)
      setDebugInfo("logRocket", LogRocket, false)
      this.logRocketInitialized = true
    }
  }

  public userHasDomain(email: string, domains: string[]) {
    return domains.find(domain => email.indexOf("@" + domain) > 0) !== undefined
  }

  public onUserKnown(userProps?: UserProps) {
    if (!userProps) {
      return
    }
    this.user = userProps
    this.ensureLogRocketInitialized()
    if (this.appConfig.rawConfig.keys.logrocket) {
      LogRocket.identify(userProps.id, {
        email: userProps.email,
      })
    }
    if (this.jitsu) {
      this.jitsu.id(this.getJitsuIdPayload(userProps))
    }
    if (this.appConfig.rawConfig.keys.intercom && !AnalyticsBlock.isBlocked()) {
      initIntercom(this.appConfig.rawConfig.keys.intercom, {
        email: userProps.email,
        name: userProps.name,
        user_id: userProps.id,
      })
    }
  }

  public getJitsuIdPayload({ email, id }) {
    return {
      email: this._anonymizeUsers ? "masked" : email,
      internal_id: this._anonymizeUsers ? "hid_" + murmurhash.v3(email || id) : id,
    }
  }

  public track(eventType: string, payload?: any, customHandlers?: AnalyticsExecutors): Promise<void> {
    const waitlist: Promise<any>[] = []
    const add = <T>(exec: Executor<T>, client: T) => {
      if (client) {
        const res = exec(client, eventType, payload)
        //if res is promise
        if (res && typeof res === "object" && typeof res.then === "function") {
          waitlist.push(res)
        }
      }
    }
    const execs = defaultExecutors(customHandlers)
    add(execs.jitsu, this.jitsu)
    add(execs.intercom, getIntercom())
    return Promise.all(waitlist).then()
  }

  public configure(features: FeatureSettings) {
    this._anonymizeUsers = features.anonymizeUsers
    const { appName, ...otherFeatures } = features
    this._appName = appName
    if (this.jitsu) {
      this.jitsu.set(
        {
          app: this._appName,
          sysFeatures: otherFeatures,
        },
        {}
      )
    }
  }

  private isDev() {
    return this.appConfig.appEnvironment === "development"
  }

  public onPageLoad({ pagePath }: { pagePath: string }) {
    this.track(
      "app_page",
      { path: pagePath, app: this._appName },
      {
        intercom: (intercom, eventType, payload) => {},
      }
    )
  }

  public onGlobalError(error: Error, doNotLog?: boolean) {
    if (!doNotLog) {
      //call console log through interceptor, to make sure it won't be handled
      this.consoleInterceptor.error("[Jitsu] uncaught error", error)
    }
    if (!this.isDev()) {
      try {
        this.sendException(error)
      } catch (e) {
        console.warn("Failed to send event to error monitoring", e)
      }
    }
  }

  public onGlobalErrorEvent(event: ErrorEvent) {
    this.consoleInterceptor.error(
      `[Jitsu] uncaught error '${event.message || "unknown"}' at ${event.filename}:${event.lineno}:${event.colno}`,
      event.error
    )
    if (!this.isDev()) {
      try {
        this.sendException(event.error)
      } catch (e) {
        console.warn("Failed to send event to error monitoring", e)
      }
    }
  }

  setupGlobalErrorHandler() {
    if (!this.globalErrorListenerPresent) {
      window.addEventListener("error", event => this.onGlobalErrorEvent(event))
      window.addEventListener("unhandledrejection", event => {
        this.onGlobalError(new Error("Unhandled rejection: " + JSON.stringify(event.reason)))
      })
      this.globalErrorListenerPresent = true
    }
  }

  onFailedAPI(param: ApiErrorInfo) {
    let message = `[Jitsu] ${param.method.toUpperCase()} ${param.url} failed with ${
      param.responseStatus
    }:${JSON.stringify(param.responseObject)}`
    this.consoleInterceptor.error(message)
    if (!this.isDev()) {
      this.sendException(new ApiErrorWrapper(message, param))
    }
  }

  private sendException(error: Error) {
    if (!this.isDev()) {
      console.log("Sending error to monitoring system")
      this.ensureLogRocketInitialized()
      if (this.appConfig.rawConfig.keys.logrocket) {
        LogRocket.captureException(error, {
          tags: {
            environment: window.location.host,
          },
        })
      }
      this.track("error", getErrorPayload(error))
    }
  }
}
