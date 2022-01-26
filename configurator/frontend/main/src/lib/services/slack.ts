import { withQueryParams } from "utils/queryParams"
import { ApiAccess } from "./model"

export interface ISlackApiService {
  /**
   * Shows whether slack support methods are callable (i.e. if env var is set)
   */
  supportApiAvailable: boolean
  /**
   * Creates a private support channel and returns an invitation link.
   */
  createPrivateSupportChannel: (project_id: string, project_name: string) => Promise<string | null>
}

type RequestOptions = {
  token?: string
}

export class SlackApiService implements ISlackApiService {
  private readonly baseUrl: string = process.env.SLACK_API_URL

  private readonly apiAccess: () => ApiAccess

  constructor(apiAccess: () => ApiAccess) {
    this.apiAccess = apiAccess
  }

  private createFetchOptions(options?: RequestOptions) {
    const headers = new Headers()
    let requestOptions: RequestInit = {
      headers,
    }

    headers.append("X-Client-Auth", this.apiAccess().accessToken)

    if (options?.token)
      requestOptions = {
        ...requestOptions,
        headers: { ...requestOptions.headers, Authorization: `Bearer: ${options.token}` },
      }
    return requestOptions
  }

  private async get(api: string, params?: { [key: string]: string }, options?: RequestOptions) {
    const fetchOptions = this.createFetchOptions(options)
    const response = await fetch(withQueryParams(`${this.baseUrl}/${api}`, params), fetchOptions)
    return await response.json()
  }

  private async post(api: string, _body?: UnknownObject, options?: RequestOptions) {
    const fetchOptions = this.createFetchOptions(options)
    const body = _body ? JSON.stringify(_body) : null
    const response = await fetch(`${this.baseUrl}/${api}`, { ...fetchOptions, method: "POST", body })
    return await response.json()
  }

  public async createPrivateSupportChannel(project_id: string, project_name: string): Promise<string> {
    const response = await this.post("create-support-channel", {
      project_id,
      project_name,
    })
    if (!response.ok) throw new Error(response.error ?? "Slack API Service failed to create a channel")
    return response.channel?.url
  }

  public get supportApiAvailable(): boolean {
    return !!this.baseUrl
  }
}
