import { LoginFeatures, TelemetrySettings, UserEmailStatus, UserService } from "./UserService"
import { FirebaseApp, initializeApp } from "firebase/app"
import { ApiAccess, userFromDTO, userToDTO } from "./model"
import type { User as FirebaseUser } from "@firebase/auth"
import { BackendApiClient } from "./BackendApiClient"
import { ServerStorage } from "./ServerStorage"
import AnalyticsService from "./analytics"
import { FeatureSettings } from "./ApplicationServices"
import {
  createUserWithEmailAndPassword,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateEmail,
  updatePassword,
  getIdToken,
} from "firebase/auth"
import { reloadPage, setDebugInfo } from "../commons/utils"
import { SignupRequest, User } from "../../generated/conf-openapi"

export class FirebaseUserService implements UserService {
  private firebaseApp: FirebaseApp
  private user?: User
  private _apiAccess: ApiAccess
  private firebaseUser: FirebaseUser
  private backendApi: BackendApiClient
  private readonly storageService: ServerStorage
  private readonly analyticsService: AnalyticsService
  private readonly appFeatures: FeatureSettings

  constructor(
    config: any,
    backendApi: BackendApiClient,
    storageService: ServerStorage,
    analyticsService: AnalyticsService,
    appFeatures: FeatureSettings
  ) {
    this.firebaseApp = initializeApp(config)
    this.backendApi = backendApi
    this.storageService = storageService
    this.analyticsService = analyticsService
    this.appFeatures = appFeatures
  }

  private async trackSignup(email: string, signupType: "google" | "github" | "email") {
    return this.analyticsService.track("saas_signup", {
      app: this.appFeatures.appName,
      user: { email: email, signup_type: signupType },
    })
  }

  initiateGithubLogin(): Promise<string> {
    const provider = new GithubAuthProvider()
    provider.setCustomParameters({
      login: "",
    })
    return new Promise<string>((resolve, reject) => {
      signInWithPopup(getAuth(), provider)
        .then(a => {
          resolve(a.user.email)
          return a["additionalUserInfo"]?.isNewUser && this.trackSignup(a.user.email, "github")
        })
        .catch(error => {
          reject(error)
        })
    })
  }

  initiateGoogleLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({
        prompt: "select_account",
      })
      signInWithPopup(getAuth(), provider)
        .then(a => {
          resolve(a.user.email)
          return a["additionalUserInfo"]?.isNewUser && this.trackSignup(a.user.email, "google")
        })
        .catch(error => {
          reject(error)
        })
    })
  }

  async login(email: string, password: string): Promise<any> {
    let fbLogin = await signInWithEmailAndPassword(getAuth(), email, password)
    this._apiAccess = new ApiAccess(await fbLogin.user.getIdToken(false), null, () => {})
  }

  public async waitForUser(): Promise<void> {
    let fbUserPromise = new Promise<FirebaseUser>((resolve, reject) => {
      let unregister = onAuthStateChanged(
        getAuth(),
        (user: FirebaseUser) => {
          if (user) {
            this.firebaseUser = user
            setDebugInfo("firebaseUser", user)
            resolve(user)
          } else {
            resolve(null)
          }
          unregister()
        },
        error => {
          reject(error)
        }
      )
    })

    let fbUser = await fbUserPromise
    if (fbUser) {
      this._apiAccess = new ApiAccess(await fbUser.getIdToken(false), null, () => {})
      let userDTO = await this.storageService.getUserInfo()
      let user = userFromDTO(userDTO)
      user.id = fbUser.uid
      user.email = fbUser.email
      user.name = user.name || fbUser.displayName
      this.user = user
    }
  }

  removeAuth(callback: () => void) {
    signOut(getAuth()).finally(callback)
  }

  getUser(): User {
    if (!this.user) {
      throw new Error("User is null. Should you call services.userService.hasUser()?")
    }
    return this.user
  }

  getUserEmailStatus(): UserEmailStatus {
    return {
      needsConfirmation: true,
      isConfirmed: this.firebaseUser.emailVerified,
    }
  }

  async refreshToken(firebaseUser: FirebaseUser, forceRefresh: boolean) {
    const tokenInfo = await firebaseUser.getIdTokenResult(forceRefresh)
    const expirationMs = new Date(tokenInfo.expirationTime).getTime() - Date.now()
    console.log(
      `Firebase token (force=${forceRefresh}) which expire at ${tokenInfo.expirationTime} in ${expirationMs}ms=(${tokenInfo.expirationTime})`
    )
    this._apiAccess = new ApiAccess(tokenInfo.token, null, () => {})
    setTimeout(() => this.refreshToken(firebaseUser, true), expirationMs / 2)
  }

  async createUser(signup: SignupRequest): Promise<void> {
    let firebaseUser = await createUserWithEmailAndPassword(getAuth(), signup.email.trim(), signup.password.trim())

    await this.refreshToken(firebaseUser.user, false)
    this._apiAccess = new ApiAccess(await firebaseUser.user.getIdToken(false), null, () => {})

    let user: User = {
      suggestedCompanyName: undefined,
      id: firebaseUser.user.uid,
      name: firebaseUser.user.displayName,
      email: firebaseUser.user.email,
      emailOptout: false,
      forcePasswordChange: false,
      created: new Date().toISOString(),
    }
    await this.storageService.saveUserInfo(userToDTO(user))
    await this.trackSignup(signup.email, "email")
  }

  hasUser(): boolean {
    return !!this.user
  }

  sendPasswordReset(email?: string): Promise<void> {
    return sendPasswordResetEmail(getAuth(), email ? email : this.getUser().email, { url: window.location.href })
  }

  async sendConfirmationEmail(): Promise<void> {
    return sendEmailVerification(this.firebaseUser)
  }

  changePassword(newPassword: string, resetId?: string): Promise<void> {
    return updatePassword(this.firebaseUser, newPassword)
  }

  async changeEmail(newEmail: string): Promise<void> {
    await updateEmail(this.firebaseUser, newEmail)
    this.user.email = newEmail
    await this.storageService.saveUserInfo({ _email: newEmail })
  }

  async changeTelemetrySettings(newSettings: TelemetrySettings): Promise<void> {
    throw new Error("Not Available")
  }

  getLoginFeatures(): LoginFeatures {
    return { oauth: true, password: true, signupEnabled: true }
  }

  getSSOAuthLink(): string {
    return ""
  }

  sendLoginLink(email: string): Promise<void> {
    return sendSignInLinkToEmail(getAuth(), email, {
      url: document.location.protocol + "//" + document.location.host + "/login-link/" + btoa(email),
      handleCodeInApp: true,
    })
  }

  supportsLoginViaLink(): boolean {
    return true
  }

  isEmailLoginLink(href: string): boolean {
    return isSignInWithEmailLink(getAuth(), href)
  }

  loginWithLink(email: string, href: string): Promise<void> {
    return signInWithEmailLink(getAuth(), email, href).then()
  }

  apiAccess(): ApiAccess {
    return this._apiAccess
  }

  refreshAuth(): Promise<void> {
    return this.refreshToken(this.firebaseUser, true)
  }

  async getIdToken(): Promise<string> {
    return await getIdToken(this.firebaseUser)
  }
}
