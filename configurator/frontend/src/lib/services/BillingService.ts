import { message } from 'antd';
import { withQueryParams } from 'utils/queryParams';
import { assert, assertIsObject, isObject } from 'utils/typeCheck';
import { ApplicationConfiguration } from './ApplicationConfiguration';
import { FeatureSettings } from './ApplicationServices';
import { BackendApiClient } from './BackendApiClient';
import { getPaymentPlanByName, PaymentPlan, paymentPlans } from './Billing';
import { IBillingApiClient } from './BillingApiClient';
import { User } from './model';
import { StatisticsService } from './stat';

export interface IBillingService {
  isBillingEnabled: boolean;
  currentPaymentPlan: PaymentPlan;
  // api: IBillingApiClient;
  configure: (
    user: User,
    applicationFeatures: FeatureSettings,
    backendApiClient: BackendApiClient
  ) => void;
  generateCheckoutLink: (product_name: string) => string;
}

export class BillingService implements IBillingService {
  private readonly CHECKOUT_REDIRECT_PATH: string = '/checkout-redirect';
  private readonly CHECKOUT_SUCCESS_URL: string = 'https://cloud.jitsu.com';
  private readonly CHECKOUT_CANCEL_URL: string = 'https://cloud.jitsu.com';
  private readonly _billingServiceBaseUrl: string;
  private readonly _apiClient: IBillingApiClient;
  private _isBillingEnabled: boolean | undefined;
  private _user: User | undefined;
  private _statisticsService: StatisticsService;
  private _paymentPlan: PaymentPlan = paymentPlans.free;
  private _paymentPlanStartDate: Date | null = null;
  private _eventsElapsed: number = 0;

  constructor(
    applicationConfiguration: ApplicationConfiguration,
    billingApiClient: IBillingApiClient
  ) {
    this._billingServiceBaseUrl = applicationConfiguration.billingUrl;
    this._apiClient = billingApiClient;
  }

  private assertUserConfigured(user: unknown): asserts user is User {
    if (!(user instanceof User))
      throw new Error('BillingService: User is not configured');
  }

  private assertBillingEnabled(
    isBillingEnabled: unknown
  ): asserts isBillingEnabled is true {
    if (typeof isBillingEnabled !== 'boolean')
      throw new Error('Attempted to use BillingService without initialization');
    if (!isBillingEnabled)
      throw new Error(
        'Attemted to use BillingService, but it is disabled in current env'
      );
  }

  private setPaymentPlan(product: UnknownObject): void {
    assertIsObject(product, `invalid product: ${product}`);
    assert(!!Object.keys(product).length, 'product object is empty');
    const paymentPlan = getPaymentPlanByName(`${product.name}`);
    assert(!!paymentPlan, 'failed to set a payment plan');
    this._paymentPlan = paymentPlan;
  }

  private setPaymentPlanStartDate(subscription: UnknownObject): void {
    assert(!!Object.keys(subscription).length, 'subscription object is empty');
    assertIsObject(subscription, `invalid subscription: ${subscription}`);
    const current_period_start = subscription.current_period_start;
    assertIsObject(
      current_period_start,
      `invalid current_period_start: ${current_period_start}`
    );
    assert(
      typeof current_period_start._seconds === 'number',
      `invalid current_period_start._seconds: ${current_period_start._seconds}`
    );

    this._paymentPlanStartDate = new Date(current_period_start._seconds * 1000);
  }

  private async setNumberOfElapsedEvents(): Promise<void> {
    const now = new Date();
    let periodStart: Date = new Date();
    periodStart.setMonth(now.getMonth() - 1);
    periodStart.setHours(0, 0, 0, 0);

    if (this._paymentPlan.id !== 'free') {
      if (!this._paymentPlanStartDate)
        throw new Error('failed to get the subscription start date');
      periodStart = this._paymentPlanStartDate;
    }

    const eventsSincePeriodStart = await this._statisticsService.get(
      periodStart,
      now,
      'day',
      'push_source'
    );

    const numOfEvents = eventsSincePeriodStart.reduce((res, item) => {
      res += item.events;
      return res;
    }, 0);

    this._eventsElapsed = numOfEvents;
  }

  public get isBillingEnabled(): boolean {
    return this._isBillingEnabled;
  }

  public get currentPaymentPlan(): PaymentPlan {
    return this._paymentPlan;
  }

  // public get api(): IBillingApiClient {
  //   return this._apiClient;
  // }

  public configure(
    user: User,
    applicationFeatures: FeatureSettings,
    backendApiClient: BackendApiClient
  ) {
    this._isBillingEnabled = applicationFeatures.billingEnabled;
    this._user = user;
    this._statisticsService = new StatisticsService(
      backendApiClient,
      user.projects[0],
      true
    );
  }

  public async init(): Promise<void> {
    try {
      this.assertBillingEnabled(this._isBillingEnabled);
      this.assertUserConfigured(this._user);
      const { product = null, subscription = null } =
        await this._apiClient.getUserSubscription({
          user_id: this._user.uid
        });

      this.setPaymentPlan(product);
      this.setPaymentPlanStartDate(subscription);
    } catch (error) {
      const messagePredicate = 'Failed to initialize BillingService';
      let errorMessage = `${error}`;
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      console.error(`
        ${messagePredicate};
        Reason: ${errorMessage}.
      `);
    }
  }

  public generateCheckoutLink(product_name: string): string {
    this.assertUserConfigured(this._user);
    this.assertBillingEnabled(this._isBillingEnabled);

    const user_id = this._user.uid;
    const user_email = this._user.email;
    const success_url = this.CHECKOUT_SUCCESS_URL;
    const cancel_url = this.CHECKOUT_CANCEL_URL;
    return withQueryParams(
      `${this._billingServiceBaseUrl}${this.CHECKOUT_REDIRECT_PATH}`,
      {
        user_id,
        user_email,
        success_url,
        cancel_url,
        product_name
      }
    );
  }
}
