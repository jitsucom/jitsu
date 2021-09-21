import { withQueryParams } from 'utils/queryParams';
import { assertHasAllProperties, assertHasOwnProperty } from 'utils/typeCheck';
import AnalyticsService from './analytics';
import { BackendApiClient, JWTBackendClient } from './BackendApiClient';
import { ApiAccess } from './model';
import { UserService } from './UserService';

export interface IBillingApiClient {
  // generateCheckoutSession: (params: {
  //   user_id: string;
  //   user_email: string;
  //   success_url?: string;
  //   cancel_url?: string;
  // }) => Promise<{ sessionId: string }>;
  // createCustomerPortalLink: (params: {
  //   user_id: string;
  //   user_email: string;
  //   return_url?: string;
  // }) => Promise<{ url: string }>;
  getUserSubscription: (params: {
    user_id: string;
  }) => Promise<{ subscription: UnknownObject; product: UnknownObject }>;
  // getActiveProducts: () => Promise<UnknownObject>;
}

export class BillingApiClient implements IBillingApiClient {
  private readonly baseUrl: string;
  private readonly backendApiClient: BackendApiClient;

  constructor(
    billingBaseURL: string,
    apiAccess: () => ApiAccess,
    analyticsService: AnalyticsService
  ) {
    this.baseUrl = billingBaseURL;
    this.backendApiClient = new JWTBackendClient(
      this.baseUrl || '',
      this.baseUrl || '',
      apiAccess,
      analyticsService
    );
  }

  // public async generateCheckoutSession(params: {
  //   user_id: string;
  //   user_email: string;
  //   success_url?: string;
  //   cancel_url?: string;
  // }): Promise<{ sessionId: string }> {
  //   const result = await this.backendApiClient.get(
  //     withQueryParams('/get-checkout-session', params)
  //   );
  //   assertHasOwnProperty(result, 'sessionId');
  //   return result;
  // }

  // public async createCustomerPortalLink(params: {
  //   user_id: string;
  //   user_email: string;
  //   return_url?: string;
  // }): Promise<{ url: string }> {
  //   const result = await this.backendApiClient.get(
  //     withQueryParams('/create-portal-link', params)
  //   );
  //   assertHasOwnProperty(result, 'url');
  //   return result;
  // }

  public async getUserSubscription(params: {
    user_id: string;
  }): Promise<{ subscription: UnknownObject; product: UnknownObject }> {
    const result = await this.backendApiClient.get(
      withQueryParams('/get-user-subscription', params)
    );
    assertHasOwnProperty(result, 'url');
    return result;
  }

  // public async getActiveProducts(): Promise<UnknownObject> {
  //   return this.backendApiClient.get('/get-active-products');
  // }
}
