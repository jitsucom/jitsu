import ApplicationServices from "./ApplicationServices"

type OauthCredentials = { status: "success"; secrets: any }
type OauthError = { status: "error"; errorMessage: string; errorDetails?: any }
type OauthWarning = { status: "warning"; message: string }
type OauthResult = OauthCredentials | OauthWarning | OauthError

export type OauthSupportResponse = {
  status: "ok"
  supported: boolean
  message: string
}

interface IOauthService {
  checkIfOauthSupported(service: string): Promise<Boolean>
  getCredentialsInSeparateWindow(service: string): Promise<OauthResult>
}

export class OauthService implements IOauthService {
  private readonly _oauthApiBase: string

  constructor() {
    this._oauthApiBase = ApplicationServices.get().applicationConfiguration.oauthApiBase
  }

  public async checkIfOauthSupported(service: string): Promise<boolean> {
    if (!this._oauthApiBase) return false
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
          console.log("catched oauth message", e.data)
          result = e.data
          endOauthFlow(e.data)
          window.removeEventListener("message", messageListener)
          oauthWindow.close()
        }
      }
    }

    if (oauthWindow === null) {
      throw new Error("Oauth flow failed: can't open a popup window")
    }

    window.addEventListener("message", messageListener)

    // a hack for a cross-origin request
    const timer = setInterval(() => {
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
