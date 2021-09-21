import { IProject } from 'lib/services/model';
import { DatePoint, StatisticsService } from 'lib/services/stat';
import { withQueryParams } from 'utils/queryParams';
import { IDestinationsStore } from '../../stores/destinations';
import { ISourcesStore } from '../../stores/sources';
import ApplicationServices from './ApplicationServices';
import { BackendApiClient } from './BackendApiClient';

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
};

export const getPaymentPlanByName = (planName: string): PaymentPlan | null => {
  return Object.values(paymentPlans).find((plan) => plan.name === planName);
};

export const getFreePaymentPlan = () => paymentPlans.free;

/**
 * Status of current payment plan
 */
export type PaymentPlanStatus = {
  currentPlan: PaymentPlan;
  eventsThisMonth: number;
  sources: number;
  destinations: number;
};

export async function initPaymentPlan(
  project: IProject,
  backendApiClient: BackendApiClient,
  destinationsStore: IDestinationsStore,
  sourcesStore: ISourcesStore
): Promise<PaymentPlanStatus> {
  const statService = new StatisticsService(backendApiClient, project, true);
  let currentPlan;
  if (!project?.planId) {
    currentPlan = paymentPlans.free;
  } else {
    currentPlan = paymentPlans[project.planId];
    if (!currentPlan) {
      throw new Error(`Unknown plan ${project.planId}`);
    }
  }
  const date = new Date();

  let stat: DatePoint[];
  try {
    stat = await statService.get(
      new Date(date.getFullYear(), date.getMonth(), 1),
      new Date(date.getFullYear(), date.getMonth() + 1, 0),
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

  let eventsThisMonth = stat.reduce((res, item) => {
    res += item.events;
    return res;
  }, 0);

  return {
    currentPlan,
    eventsThisMonth,
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
  return withQueryParams(billingUrl, params);
}