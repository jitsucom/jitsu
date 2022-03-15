// @Libs
import { ReactElement } from "react"
import { Modal, Typography } from "antd"
import moment, { Moment } from "moment"
// @Services
import ApplicationServices from "./ApplicationServices"
import { BackendApiClient } from "./BackendApiClient"
// @Types
import type { destinationsStore as DestinationsStore } from "../../stores/destinations"
import type { sourcesStore as SourcesStore } from "../../stores/sources"
import { DatePoint, StatisticsService } from "lib/services/stat"
// @Utils
import { withQueryParams } from "utils/queryParams"
import { numberFormat } from "../commons/utils"
import { BillingPlanOptions } from "lib/components/BillingPlanOptions/BillingPlanOptions"

export type PricingPlanId = "opensource" | "free" | "growth" | "premium" | "enterprise"

export interface Quota extends Usage {
  //allowed schedules (sync frequency), see schedule.ts for IDs
  allowedSchedules: string[]
}

export type PricingPlan = {
  name: string
  id: PricingPlanId
  quota: Quota
  price?: number
}

const opensource: PricingPlan = {
  name: "Opensource",
  id: "opensource",
  quota: {
    destinations: 100,
    sources: 150,
    events: 10_000_000,
    allowedSchedules: ["1d", "1h", "5m", "1m"],
  },
}
const free: PricingPlan = {
  name: "Startup",
  id: "free",
  quota: {
    destinations: 2,
    sources: 1,
    events: 250_000,
    allowedSchedules: ["1d"],
  },
  price: 0,
}
const growth: PricingPlan = {
  name: "Growth",
  id: "growth",
  quota: {
    destinations: 10,
    sources: 5,
    events: 1_000_000,
    allowedSchedules: ["1d", "1h", "5m"],
  },
  price: 99,
}
const premium: PricingPlan = {
  name: "Premium",
  id: "premium",
  quota: {
    destinations: 10,
    sources: 15,
    events: 10_000_000,
    allowedSchedules: ["1d", "1h", "5m", "1m"],
  },
  price: 299,
}
const enterprise: PricingPlan = {
  name: "Enterprise",
  id: "enterprise",
  quota: {
    destinations: 100,
    sources: 150,
    events: 10_000_000,
    allowedSchedules: ["1d", "1h", "5m", "1m"],
  },
}
export const paymentPlans: Record<PricingPlanId, PricingPlan> = {
  opensource,
  free,
  growth,
  premium,
  enterprise,
} as const

export type Usage = {
  events: number
  sources: number
  destinations: number
}

/**
 * Status of current payment plan
 */
export type CurrentSubscription = {
  /**
   * Current plan. Might be 'free'
   */
  currentPlan: PricingPlan
  /**
   * Customer id in stripe. May be undefined if user paid directly
   */
  stripeCustomerId?: string
  /**
   * Start of the current billing period.
   */
  quotaPeriodStart: Moment
  /**
   * Current usage
   */
  usage: Usage
  /**
   * When subscription expires
   */
  expiration: Moment
  /**
   * Autorenew
   */
  autorenew: boolean
  /**
   * If UI shouldn't be blocked
   */
  doNotBlock: boolean
}

/**
 * Schema of the record in firebase
 */
export type FirebaseSubscriptionEntry = {
  /**
   * Pricing plan
   */
  planId: PricingPlanId
  /**
   * The start of current billing period. The date of last payment. Can be either last month (if customer pays
   * monthly), or any date if customer is billed annually
   *
   * ISO 8601 string. If absent, it's beginning of current month
   */
  subscriptionStart?: string
  /**
   * Expiration date of the subscription. Can be any date in future. If not set, it's subscriptionStart + 30 days.
   *
   * ISO 8601 string
   */
  subscriptionExpires?: string
  /**
   * Billing email
   */
  billingEmail: string
  /**
   * Current id of the customer
   */
  stripeCustomerId?: string

  /**
   * If UI shouldn't be blocked
   */
  doNotBlock?: boolean
}

/**
 * Returns the start of current quota period
 * @param subscriptionStart - can be undefined
 */
function getQuotaPeriodStart(subscriptionStart?: string): Moment {
  let quotaPeriodStart
  if (!subscriptionStart) {
    quotaPeriodStart = moment().startOf("month") //first
  } else {
    quotaPeriodStart = moment(subscriptionStart)
    //TODO: if subscription way in the past (annual billing - rewind forward to current month)
  }
  return quotaPeriodStart
}

function parseSubscription(fb: FirebaseSubscriptionEntry, usage: Usage): Readonly<CurrentSubscription> {
  const quotaPeriodStart = getQuotaPeriodStart(fb.subscriptionStart)
  const paymentPlan = paymentPlans[fb.planId]
  if (!paymentPlan) {
    throw new Error(`Unknown plan ${fb.planId}`)
  }
  return {
    currentPlan: paymentPlan,
    quotaPeriodStart,
    stripeCustomerId: fb.stripeCustomerId,
    usage,
    autorenew: !!fb.stripeCustomerId,
    expiration: fb.subscriptionExpires ? moment(fb.subscriptionExpires) : moment(quotaPeriodStart).add(1, "M"),
    doNotBlock: !!fb.doNotBlock,
  }
}

async function fetchCurrentSubscription(): Promise<FirebaseSubscriptionEntry> {
  const services = ApplicationServices.get()
  const billingUrl = services.applicationConfiguration.billingUrl

  if (!billingUrl) {
    return { planId: "opensource", billingEmail: "none@none.com" }
  }

  const project_id = services.activeProject.id
  const user_id = services.userService.getUser().id
  const id_token = await services.userService.getIdToken()

  try {
    const subscriptionResponse = await fetch(`${billingUrl}/api/get-current-subscription`, {
      method: "POST",
      body: JSON.stringify({ project_id, user_id, id_token }),
    })

    if (subscriptionResponse.status === 500) return { planId: "free", billingEmail: "", doNotBlock: true }

    const subscription = (await subscriptionResponse.json()).subscription

    if (!subscription) {
      return { planId: "free", billingEmail: "none@none.com" }
    }

    return subscription
  } catch (error) {
    console.error(
      "Failed to fetch subscription. User: ",
      services.userService.getUser(),
      "Project: ",
      services.activeProject,
      "Error: ",
      error
    )
    return { planId: "free", billingEmail: "none@none.com", doNotBlock: true }
  }
}

export async function getCurrentSubscription(
  projectId: string,
  backendApiClient: BackendApiClient,
  destinationsStore: typeof DestinationsStore,
  sourcesStore: typeof SourcesStore
): Promise<CurrentSubscription> {
  const statService = new StatisticsService(backendApiClient, projectId, true)

  const subscription = await fetchCurrentSubscription()

  let stat: DatePoint[]
  try {
    const quotaPeriodStart = getQuotaPeriodStart(subscription.subscriptionStart)
    stat = await statService.get(
      quotaPeriodStart.toDate(),
      quotaPeriodStart.add(1, "M").toDate(),
      "day",
      "source",
      "push",
      "success"
    )
  } catch (e) {
    console.info("Failed to obtain stat, it could happen if Jitsu configurator isn't connected to jitsu server", e)
    stat = []
  }

  let events = stat.reduce((res, item) => {
    res += item.events
    return res
  }, 0)

  return parseSubscription(subscription, {
    events,
    sources: sourcesStore.list.length,
    destinations: destinationsStore.list.length,
  })
}

/**
 * Checks if user is over the limits. Returns the description
 */
export function checkQuotas(status: CurrentSubscription): React.ReactElement {
  if (status.doNotBlock) {
    return null
  }
  if (status.usage.sources > status.currentPlan.quota.sources) {
    return (
      <>
        you currently using {status.usage.sources} sources which is above <b>{status.currentPlan.id}</b> plan limit{" "}
        (maximum number of sources is {status.currentPlan.quota.sources})
      </>
    )
  }
  if (status.usage.destinations > status.currentPlan.quota.destinations) {
    return (
      <>
        you currently using {status.usage.destinations} destinations which is above <b>{status.currentPlan.id}</b> plan
        limit (maximum number of destinations is {status.currentPlan.quota.destinations})
      </>
    )
  }
  if (status.usage.events > status.currentPlan.quota.events) {
    return (
      <>
        you processed <Typography.Text code>{numberFormat(status.usage.events)}</Typography.Text> events per current
        month, which is above your <b>{status.currentPlan.id}</b> plan (
        <Typography.Text code>{numberFormat(status.currentPlan.quota.events)}</Typography.Text> events per month) The
        quota restarts on: <b>{moment(status.quotaPeriodStart).add(1, "M").format("MMM Do, YY")}</b>
      </>
    )
  }
  return null
}

export function generateCheckoutLink(params: {
  project_id: string
  user_email: string
  plan_id: string
  redirect_base: string
}): string {
  const billingUrl = ApplicationServices.get().applicationConfiguration.billingUrl
  const link = withQueryParams(`${billingUrl}/api/init-checkout`, params, { encode: ["user_email"] })
  return link
}

export function generateCustomerPortalLink(
  params: {
    project_id: string
    user_email: string
    return_url: string
  },
  signToken?: string
): string {
  const billingUrl = ApplicationServices.get().applicationConfiguration.billingUrl
  return withQueryParams(
    `${billingUrl}/api/to-customer-portal`,
    !signToken
      ? params
      : {
          ...params,
        }
  )
}

export function showQuotaLimitModal(subscription: CurrentSubscription, msg: ReactElement) {
  Modal.info({
    content: (
      <div>
        <div className="text-lg text-center pt-4">{msg}</div>
        <BillingPlanOptions planStatus={subscription} />
      </div>
    ),
    closable: true,
    width: 800,
    title: "Please, upgrade your subscription",
  })
}
