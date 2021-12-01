import { withQueryParams } from "utils/queryParams"
import axios, { AxiosInstance } from "axios"
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
  // private readonly baseURL: string = "https://billing.jitsu.com/api/slack"
  // private readonly baseURL: string = "https://billing-dev.vercel.app/api/slack"
  private readonly baseURL: string = "http://localhost:3000/api/slack"
  private readonly request: AxiosInstance = axios.create()
  private readonly apiAccess: () => ApiAccess
  // private readonly supportSingningSecret: string = process.env.SLACK_SUPPORT_SIGNING_SECRET

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
    const response = await fetch(withQueryParams(`${this.baseURL}/${api}`, params), fetchOptions)
    return await response.json()
  }

  private async post(api: string, _body?: UnknownObject, options?: RequestOptions) {
    const fetchOptions = this.createFetchOptions(options)
    const body = _body ? JSON.stringify(_body) : null
    const response = await fetch(`${this.baseURL}/${api}`, { ...fetchOptions, method: "POST", body })
    return await response.json()
  }

  /** Creates support channel and returns a channel id string */
  private async createSupportChannel(name: string): Promise<string> {
    const response = await this.post("conversations.create", { name })
    if (!response.ok)
      throw new Error(`SlackAPI createSupportChannel method failed to create ${name} channel. ${response.error ?? ""}`)
    return response.channel.id
  }

  /** Creates a shareable invite link to a channel */
  private async createSharedInvitationToChannelUrl(channelId: string): Promise<string> {
    const response = await this.get("conversations.inviteShared", { channel: channelId })
    if (!response.ok)
      throw new Error(
        `SlackAPI createSharedInviteLinkToChannel method failed to create a link. ${response.error ?? ""}`
      )
    return response.url
  }

  public async createPrivateSupportChannel(project_id: string, project_name: string): Promise<string> {
    const response = await this.post("create-support-channel", {
      project_id,
      project_name,
    })
    if (!response.ok) throw new Error(response.error ?? "Slack API Service failed to create a channel")
    return response.url
  }

  public get supportApiAvailable(): boolean {
    return !!this.baseURL
  }
}
