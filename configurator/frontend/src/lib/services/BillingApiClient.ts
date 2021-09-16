import { BackendApiClient, JWTBackendClient } from './BackendApiClient';

interface IBillingBackendClient {
  generateCheckoutSession: (
    user_id: string,
    user_email: string,
    success_url?: string,
    cancel_url?: string
  ) => Promise<{ sessionId: string }>;
}

export class BillingBackendClient implements IBillingBackendClient {
  private readonly baseUrl: string;
  private readonly backendApiClient: BackendApiClient;

  constructor(billingBaseURL: string) {
    this.baseUrl = billingBaseURL;
    // this.backendApiClient = new JWTBackendClient(
    //   this.baseUrl,
    //   this.baseUrl,
    //   () => this._userService.getUser().apiAccess,
    //   this._analyticsService)
  }

  public async generateCheckoutSession(
    user_id,
    user_email,
    success_url,
    cancel_url
  ) {
    return {
      sessionId: ''
    };
  }
}
