import { IProject } from 'lib/services/model';
import { DatePoint, StatisticsService } from 'lib/services/stat';
import { IDestinationsStore } from '../../stores/destinations';
import { ISourcesStore } from '../../stores/sources';
import { BackendApiClient } from './BackendApiClient';

export type PlanId = 'free' | 'growth' | 'premium' | 'enterprise';

export type PaymentPlan = {
  name: string;
  id: PlanId;
  eventsLimit: number;
  destinationsLimit: number;
  sourcesLimit: number;
};

export const paymentPlans: Record<PlanId, PaymentPlan> = {
  free: {
    name: 'Startup (free)',
    id: 'free',
    eventsLimit: 250_000,
    destinationsLimit: 2,
    sourcesLimit: 1
  },
  growth: {
    name: 'Growth',
    id: 'growth',
    eventsLimit: 1_000_000,
    destinationsLimit: 10,
    sourcesLimit: 5
  },
  premium: {
    name: 'Premium',
    id: 'premium',
    eventsLimit: 10_000_000,
    destinationsLimit: 10,
    sourcesLimit: 15
  },
  enterprise: {
    name: 'Enterprise',
    id: 'enterprise',
    eventsLimit: null,
    destinationsLimit: null,
    sourcesLimit: null
  }
};

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
