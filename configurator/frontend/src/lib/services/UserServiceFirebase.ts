/* eslint-disable */
import { ApiAccess, Project, SuggestedUserInfo, User } from "./model"
import {
  getAuth,
  User as FirebaseUser,
  signInWithPopup,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInWithEmailLink,
  signOut,
  createUserWithEmailAndPassword,
  GithubAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  updateEmail,
  updatePassword,
  getIdToken,
} from "firebase/auth"
import { initializeApp, FirebaseApp } from "firebase/app"
import Marshal from "../commons/marshalling"
import { reloadPage, setDebugInfo } from "../commons/utils"
import { randomId } from "utils/numbers"
import { LoginFeatures, TelemetrySettings, UserLoginStatus, UserService } from "./UserService"
import { BackendApiClient } from "./BackendApiClient"
import { ServerStorage } from "./ServerStorage"

export class FirebaseUserService implements UserService {
  private firebaseApp: FirebaseApp
  private user?: User
  private apiAccess: ApiAccess
  private firebaseUser: FirebaseUser
  private backendApi: BackendApiClient
  private readonly storageService: ServerStorage

  constructor(config: any, backendApi: BackendApiClient, storageService: ServerStorage) {
    this.firebaseApp = initializeApp(config)
    this.backendApi = backendApi
    this.storageService = storageService
  }

  initiateGithubLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      signInWithPopup(getAuth(), new GithubAuthProvider())
        .then(a => {
          resolve(a.user.email)
        })
        .catch(error => {
          reject(error)
        })
    })
  }

  initiateGoogleLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      signInWithPopup(getAuth(), new GoogleAuthProvider())
        .then(a => {
          resolve(a.user.email)
        })
        .catch(error => {
          reject(error)
        })
    })
  }

  login(email: string, password: string): Promise<any> {
    let fbLogin = signInWithEmailAndPassword(getAuth(), email, password)
    return new Promise<any>((resolve, reject) => {
      fbLogin.then(login => resolve(login)).catch(error => reject(error))
    })
  }

  public waitForUser(): Promise<UserLoginStatus> {
    setDebugInfo(
      "loginAs",
      async token => {
        await signInWithCustomToken(getAuth(), token)
      },
      false
    )

    let fbUserPromise = new Promise<FirebaseUser>((resolve, reject) => {
      let unregister = onAuthStateChanged(
        getAuth(),
        (user: FirebaseUser) => {
          if (user) {
            this.firebaseUser = user
            setDebugInfo("firebaseUser", user)
            setDebugInfo(
              "updateEmail",
              async email => {
                try {
                  let updateResult = await updateEmail(user, email)
                  console.log(`Attempt to update email to ${email}. Result`, updateResult)
                } catch (e) {
                  console.log(`Attempt to update email to ${email} failed`, e)
                }
              },
              false
            )
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
    return fbUserPromise.then((user: FirebaseUser) => {
      debugger
      if (user != null) {
        return this.restoreUser(user).then(user => {
          return { user: user, loggedIn: true, loginErrorMessage: null }
        })
      } else {
        return { user: null, loggedIn: false }
      }
    })
  }

  private async restoreUser(fbUser: FirebaseUser): Promise<User> {
    //initialize authorization
    await this.refreshToken(fbUser, false)
    this.user = new User(fbUser.uid, () => this.apiAccess, {} as SuggestedUserInfo)

    const userInfo = await this.storageService.getUserInfo()
    debugger
    const suggestedInfo = {
      email: fbUser.email,
      name: fbUser.displayName,
    }
    if (Object.keys(userInfo).length !== 0) {
      this.user = new User(fbUser.uid, () => this.apiAccess, suggestedInfo, userInfo)
      //Fix a bug where created date is not set for a new user
      if (!this.user.created) {
        this.user.created = new Date()
        await this.update(this.user)
      }
    } else {
      // creates new user with a fresh project
      this.user = new User(fbUser.uid, () => this.apiAccess, suggestedInfo, {
        _project: new Project(randomId(), null),
      })
      this.user.created = new Date()
      await this.update(this.user)
    }
    return this.user
  }

  removeAuth(callback: () => void) {
    signOut(getAuth()).then(callback).catch(callback)
  }

  getUser(): User {
    if (!this.user) {
      throw new Error("User is null")
    }
    return this.user
  }

  async getUserEmailStatus(): Promise<{
    needsConfirmation: true
    isConfirmed: boolean
  }> {
    return {
      needsConfirmation: true,
      isConfirmed: this.firebaseUser.emailVerified,
    }
  }

  update(user: User): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (user.projects == null) {
        reject(new Error(`Can't update user without projects:` + JSON.stringify(user)))
      }
      if (user.projects.length != 1) {
        reject(
          new Error(`Can't update user projects ( ` + user.projects.length + `), should be 1` + JSON.stringify(user))
        )
      }
      let userData: any = Marshal.toPureJson(user)
      userData["_project"] = Marshal.toPureJson(user.projects[0])
      delete userData["_projects"]
      return this.storageService.saveUserInfo(userData).then(resolve)
    })
  }

  async refreshToken(firebaseUser: FirebaseUser, forceRefresh: boolean) {
    const tokenInfo = await firebaseUser.getIdTokenResult(forceRefresh)
    const expirationMs = new Date(tokenInfo.expirationTime).getTime() - Date.now()
    console.log(
      `Firebase token (force=${forceRefresh}) which expire at ${tokenInfo.expirationTime} in ${expirationMs}ms=(${tokenInfo.expirationTime})`
    )
    this.apiAccess = new ApiAccess(tokenInfo.token, null, () => {})
    setTimeout(() => this.refreshToken(firebaseUser, true), expirationMs / 2)
  }

  async createUser(email: string, password: string): Promise<void> {
    let firebaseUser = await createUserWithEmailAndPassword(getAuth(), email.trim(), password.trim())

    await this.refreshToken(firebaseUser.user, false)

    let user = new User(
      firebaseUser.user.uid,
      () => this.apiAccess,
      { name: null, email: email },
      {
        _name: name,
        _project: new Project(randomId(), null),
      }
    )

    user.created = new Date()

    this.user = user

    await this.update(user)
  }

  setupUser(_): Promise<void> {
    throw new Error("Firebase doesn't support initial user setup")
  }

  hasUser(): boolean {
    return !!this.user
  }

  sendPasswordReset(email?: string): Promise<void> {
    return sendPasswordResetEmail(getAuth(), email ? email : this.getUser().email)
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
    await this.update(this.user)
  }

  async changeTelemetrySettings(newSettings: TelemetrySettings): Promise<void> {
    throw new Error("Not Available")
  }

  async becomeUser(email: string): Promise<void> {
    let token = (await this.backendApi.get(`/become`, { urlParams: { user_id: email } }))["token"]
    await signInWithCustomToken(getAuth(), token)
    reloadPage()
  }

  getLoginFeatures(): LoginFeatures {
    return { oauth: true, password: true, signupEnabled: true }
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

  async getIdToken(): Promise<string> {
    return await getIdToken(this.firebaseUser)
  }
}
