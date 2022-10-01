import { ApiAccess } from "./model"
import { SignupRequest, User } from "../../generated/conf-openapi"

/**
 * User Service
 */

export interface LoginFeatures {
  oauth: boolean
  password: boolean
  signupEnabled: boolean
}

export type UserEmailStatus = { needsConfirmation: true; isConfirmed: boolean } | { needsConfirmation: false }

export type TelemetrySettings = {
  isTelemetryEnabled: boolean
}

export interface SetupUserProps {
  email: string
  password: string
  name?: string
  company?: string
  emailOptout?: boolean
}

export interface UserService {
  /**
   * Logs in user. On success user must reload
   * @param email email
   * @param password password
   * @returns a promise
   */
  login(email: string, password: string): Promise<void>

  getLoginFeatures(): LoginFeatures

  getSSOAuthLink(): string

  /**
   * Initiates google login. Returns promise on email of the user . On success user must reload
   * page.
   */
  initiateGoogleLogin(redirect?: string): Promise<string>

  apiAccess(): ApiAccess

  /**
   * Initiates google login
   */
  initiateGithubLogin(redirect?: string)

  /**
   * Get (wait for) logged in user (or null if user is not logged in).
   */
  waitForUser(): Promise<void>

  /**
   * Get current logged in user. Throws exception if user is not available
   */
  getUser(): User

  /**
   * Checks if current user's email needs confirmation and if it is confirmed.
   * @returns an object with the corresponding fields
   */
  getUserEmailStatus(): UserEmailStatus

  /**
   * Checks if any valid user is logged in.
   */
  hasUser(): boolean

  /**
   * Sends user a reset password link via email
   * @param email - email to send the link to
   */
  sendPasswordReset(email?: string)

  sendConfirmationEmail(): Promise<void>

  /**
   * Changes account password if signed up with email and password.
   * @param value new password
   * @param resetId token from the password reset link; Needed if user is not logged in.
   */
  changePassword(value: string, resetId?: string): Promise<void>

  /**
   * Changes account email.
   * @param value - new email
   */
  changeEmail(value: string): Promise<void>

  /**
   * Changes user's telemetry preferences.
   * @param newSettings - telemetry settings
   */
  changeTelemetrySettings(newSettings: TelemetrySettings): Promise<void>

  removeAuth(callback: () => void)

  createUser(signup: SignupRequest): Promise<void>

  supportsLoginViaLink(): boolean

  sendLoginLink(email: string): Promise<void>

  isEmailLoginLink(href: string): boolean

  loginWithLink(email: string, href: string): Promise<void>

  /**
   * Returns a token which can be user by external services to perform authorization.
   */
  getIdToken(): Promise<string>
}
