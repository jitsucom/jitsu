import { BackendApiClient } from "./BackendApiClient"

type OauthResult = OauthCredentials | OauthWarning | OauthError

type OauthCredentials = { status: "success"; secrets: any }
type OauthWarning = { status: "warning"; message: string }
type OauthError = {
  status: "error"
  message?: string
  /** @deprecated as of Jan 2022 */
  errorMessage?: string
  errorDetails?: any
}

export type OauthSupportResponse = {
  status: "ok"
  supported: boolean
  message: string
}

export interface IOauthService {
  getAvailableBackendSecrets(sourceType: string, projectId: string): Promise<string[]>
  checkIfOauthSupported(service: string): Promise<boolean>
  getCredentialsInSeparateWindow(service: string): Promise<OauthResult>
}

export class OauthService implements IOauthService {
  private readonly _oauthApiBase: string
  private readonly _oauthSupported: boolean
  private readonly _backendApiClient: BackendApiClient

  constructor(oauthApiBase: string, backendApiClient: BackendApiClient) {
    this._oauthApiBase = oauthApiBase
    this._oauthSupported = !!oauthApiBase
    this._backendApiClient = backendApiClient
  }

  public async getAvailableBackendSecrets(sourceType: string, projectId: string): Promise<string[]> {
    const secretsStatus = await this._backendApiClient.get(
      `sources/oauth_fields/${sourceType}?project_id=${projectId}`,
      {
        proxy: true,
      }
    )

    return (
      Object.entries(secretsStatus).reduce<string[]>((result, [key, status]) => {
        if (!status["provided"]) return result
        result.push(key)
        return result
      }, []) ?? []
    )
  }

  public async checkIfOauthSupported(service: string): Promise<boolean> {
    if (!this._oauthSupported) return false
    const response = await fetch(`${this._oauthApiBase}/info/${service}`)
    if (response.status === 200) {
      const result: OauthSupportResponse = await response.json()
      return result.supported
    }
    return false
  }

  public async getCredentialsInSeparateWindow(service: string): Promise<OauthResult> {
    if (!this._oauthApiBase)
      throw new Error(
        "Failed to get oauth credentials. Did you forget to set OAUTH_BACKEND_API_BASE environment variable?"
      )

    const oauthWindow = window.open(
      `${this._oauthApiBase}/oauth/${service}/init`,
      `Authorize ${service}`,
      "toolbar=no, menubar=no, location=no, width=600, height=700, top=100, left=100"
    )

    let endOauthFlow = (result: OauthResult) => {}
    const oauthFlowPromise = new Promise<OauthResult>(resolve => {
      endOauthFlow = resolve
    })

    let result
    function messageListener(e: MessageEvent) {
      if (e.isTrusted && e.source === oauthWindow) {
        if (oauthWindow !== null) {
          result = e.data
          endOauthFlow(e.data)
          window.removeEventListener("message", messageListener)
          oauthWindow.close()
        }
      }
    }

    if (oauthWindow === null) {
      throw new Error("OAuth flow failed: can't open a popup window")
    }

    window.addEventListener("message", messageListener)

    const timer = setInterval(() => {
      // using polling as a hack for a cross-origin request
      if (oauthWindow.closed && !result) {
        clearInterval(timer)
        endOauthFlow({ status: "warning", message: "Oauth did not complete because popup window has been closed" })
        window.removeEventListener("message", messageListener)
      }
    }, 400)

    result = await oauthFlowPromise

    return result
  }
}
