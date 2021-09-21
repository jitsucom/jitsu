import { IProject } from 'lib/services/model';
import { DatePoint, StatisticsService } from 'lib/services/stat';
import { withQueryParams } from 'utils/queryParams';
import { IDestinationsStore } from '../../stores/destinations';
import { ISourcesStore } from '../../stores/sources';
import ApplicationServices from './ApplicationServices';
import { BackendApiClient } from './BackendApiClient';
import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import { isObject } from 'utils/typeCheck';

export type PaymentPlanId = 'free' | 'growth' | 'premium' | 'enterprise';

export type PaymentPlan = {
  name: string;
  id: PaymentPlanId;
  eventsLimit: number;
  destinationsLimit: number;
  sourcesLimit: number;
  price_currency?: 'usd';
  price_amount?: number;
};

export const paymentPlans: Record<PaymentPlanId, PaymentPlan> = {
  free: {
    name: 'Startup',
    id: 'free',
    eventsLimit: 250_000,
    destinationsLimit: 2,
    sourcesLimit: 1,
    price_currency: 'usd',
    price_amount: 0
  },
  growth: {
    name: 'Growth',
    id: 'growth',
    eventsLimit: 1_000_000,
    destinationsLimit: 10,
    sourcesLimit: 5,
    price_currency: 'usd',
    price_amount: 99
  },
  premium: {
    name: 'Premium',
    id: 'premium',
    eventsLimit: 10_000_000,
    destinationsLimit: 10,
    sourcesLimit: 15,
    price_currency: 'usd',
    price_amount: 299
  },
  enterprise: {
    name: 'Enterprise',
    id: 'enterprise',
    eventsLimit: null,
    destinationsLimit: null,
    sourcesLimit: null
  }
} as const;

export const getPaymentPlanByName = (planName: string): PaymentPlan | null => {
  return Object.values(paymentPlans).find((plan) => plan.name === planName);
};

export const getFreePaymentPlan = () => paymentPlans.free;

/**
 * Status of current payment plan
 */
export type PaymentPlanStatus = {
  currentPlan: PaymentPlan;
  eventsInCurrentPeriod: number;
  sources: number;
  destinations: number;
};

export async function getCurrentPlanInfo(projectId: string): Promise<{
  planId: string;
  currentPeriodStart: Date | null;
} | null> {
  const subscription = await firebase
    .firestore()
    .collection('subscriptions')
    .doc(projectId)
    .get();

  let { jitsu_plan_id, current_period_start } = subscription.data() ?? {};

  if (!jitsu_plan_id || typeof jitsu_plan_id !== 'string') return null;

  if (!isObject(current_period_start)) current_period_start = {};

  const seconds = current_period_start._seconds;

  let currentPeriodStart = seconds ? new Date(seconds * 1000) : null;

  return {
    planId: jitsu_plan_id,
    currentPeriodStart
  };
}

export async function initPaymentPlan(
  project: IProject,
  backendApiClient: BackendApiClient,
  destinationsStore: IDestinationsStore,
  sourcesStore: ISourcesStore
): Promise<PaymentPlanStatus> {
  const statService = new StatisticsService(backendApiClient, project, true);
  let { planId, currentPeriodStart } =
    (await getCurrentPlanInfo(project.id)) ?? {};

  let currentPlan: PaymentPlan | undefined;
  if (!planId) {
    currentPlan = paymentPlans.free;
  } else {
    currentPlan = paymentPlans[planId];
    if (!currentPlan) throw new Error(`Unknown plan ${planId}`);
  }
  const date = new Date();
  const now = new Date();

  let currentStatPeriodStart: Date = new Date();
  // a month ago by default
  currentStatPeriodStart.setMonth(now.getMonth() - 1);
  currentStatPeriodStart.setHours(0, 0, 0, 0);
  // get from subscription if not on free plan
  if (currentPlan.id !== 'free') currentStatPeriodStart = currentPeriodStart;

  let stat: DatePoint[];
  try {
    stat = await statService.get(
      currentStatPeriodStart,
      now,
      'day',
      'push_source'
    );
  } catch (e) {
    console.info(
      "Failed to obtain stat, it could happen if Jitsu configurator isn't connected to jitsu server",
      e
    );
    stat = [];
  }

  let eventsInCurrentPeriod = stat.reduce((res, item) => {
    res += item.events;
    return res;
  }, 0);

  return {
    currentPlan,
    eventsInCurrentPeriod,
    sources: sourcesStore.sources.length,
    destinations: destinationsStore.destinations.length
  };
}

export function generateCheckoutLink(params: {
  project_id: string;
  current_plan_id: string;
  plan_id_to_purchase: string;
  user_email: string;
  success_url: string;
  cancel_url: string;
}): string {
  const billingUrl =
    ApplicationServices.get().applicationConfiguration.billingUrl;
  return withQueryParams(`${billingUrl}/checkout-redirect`, params);
}