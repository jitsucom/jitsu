import { Project } from 'lib/services/model';
import { BackendApiClient } from 'lib/services/ApplicationServices';
import { DatePoint, StatService, StatServiceImpl } from 'lib/services/stat';

export type PlanId = 'free' | 'growth' | 'premium' | 'enterprise';

export type PaymentPlan = {
  name: string,
  id: PlanId,
  events_limit: number
}

export const paymentPlans: Record<PlanId , PaymentPlan> = {
  free: { name: 'Startup (free)', id: 'free', events_limit: 250_000 },
  growth: { name: 'Growth', id: 'growth', events_limit: 1_000_000 },
  premium: { name: 'Premium', id: 'premium', events_limit: 10_000_000 },
  enterprise: { name: 'Enterprise', id: 'enterprise', events_limit: null }
}

/**
 * Status of current payment plan
 */
export class PaymentPlanStatus {
  private _currentPlan: PaymentPlan;

  private _eventsThisMonth: number;

  private _stat: StatService;

  public async init(project: Project, backendApiClient: BackendApiClient) {
    if (!project?.planId) {
      this._currentPlan = paymentPlans.free;
    } else {
      this._currentPlan = paymentPlans[project.planId];
      if (!this._currentPlan) {
        throw new Error(`Unknown plan ${project.planId}`);
      }
    }
    this._stat = new StatServiceImpl(backendApiClient, project, true);
    var date = new Date();

    let stat: DatePoint[];
    try {
      stat = await this._stat.get(new Date(date.getFullYear(), date.getMonth(), 1), new Date(date.getFullYear(), date.getMonth() + 1, 0), 'day');
    } catch (e) {
      console.info("Failed to obtain stat, it could happen if Jitsu configurator isn't connected to jitsu server", e);
      stat = []
    }

    this._eventsThisMonth = stat.reduce((res, item) => {
      res += item.events;
      return res;
    }, 0);
  }

  get currentPlan(): PaymentPlan {
    return this._currentPlan;
  }

  get eventsThisMonth(): number {
    return this._eventsThisMonth;
  }

}