/* eslint-disable */
import { ApiAccess, Project, User } from './model';
import 'firebase/auth';
import 'firebase/firestore';
import Marshal from '../commons/marshalling';
import { BackendApiClient, LoginFeatures, ServerStorage, UserLoginStatus, UserService } from './ApplicationServices';
import { randomId } from '@util/numbers';
import { cleanAuthorizationLocalStorage, concatenateURLs } from "@./lib/commons/utils";
import { getBaseUIPath } from "@./lib/commons/pathHelper";

export const LS_ACCESS_KEY = 'en_access';
export const LS_REFRESH_KEY = 'en_refresh';

export class BackendUserService implements UserService {
  private user?: User;
  private apiAccess: ApiAccess;
  private backendApi: BackendApiClient;
  private readonly storageService: ServerStorage;
  private readonly smtpConfigured: boolean;

  constructor(backendApi: BackendApiClient, storageService: ServerStorage, smtpConfigured: boolean) {
    this.backendApi = backendApi;
    this.storageService = storageService;
    this.smtpConfigured = smtpConfigured;
  }

  initiateGithubLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      reject(new Error("GitHub authorization isn't supported in BackendUserService"));
    });
  }

  initiateGoogleLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      reject(new Error("Google authorization isn't supported in BackendUserService"));
    });
  }

  login(email: string, password: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.backendApi
        .post('/users/signin', { email: email, password: password }, { noauth: true })
        .then((response) => {
          this.apiAccess = new ApiAccess(response['access_token'], response['refresh_token'], this.localStorageUpdate);
          this.localStorageUpdate(response['access_token'], response['refresh_token']);

          resolve(response);
        })
        .catch((error) => reject(error));
    });
  }

  async createUser(email: string, password: string): Promise<void> {
    let signUpPayload = {
      email: email,
      password: password
    };

    let response = await this.backendApi.post('/users/signup', signUpPayload, { noauth: true });

    this.apiAccess = new ApiAccess(response['access_token'], response['refresh_token'], this.localStorageUpdate);
    this.localStorageUpdate(response['access_token'], response['refresh_token']);

    let user = new User(
      response['user_id'],
      () => this.apiAccess,
      {
        name: null,
        email: email,
        companyName: null
      },
      {
        _name: name,
        _project: new Project(randomId(), null)
      }
    );

    user.created = new Date();

    this.user = user;

    await this.update(user);
  }

  async setupUser({ email, password, name, company = '', emailOptout = false, usageOptout = false }): Promise<void> {
    if (!name || name === "") {
      throw new Error("Name is not set")
    }
    let signUpPayload = {
      email,
      password,
      name,
      company,
      emailOptout,
      usageOptout
    };
    let response = await this.backendApi.post('/users/onboarded/signup', signUpPayload, { noauth: true });

    this.apiAccess = new ApiAccess(response['access_token'], response['refresh_token'], this.localStorageUpdate);
    this.localStorageUpdate(response['access_token'], response['refresh_token']);

    let user = new User(
      response['user_id'],
      () => this.apiAccess,
      {
        name: name,
        email: email,
        companyName: company
      },
      {
        _name: name,
        _project: new Project(randomId(), company)
      }
    );

    user.created = new Date();
    user.emailOptout = emailOptout;
    user.onboarded = true;

    this.user = user;

    await this.update(user);
  }

  public waitForUser(): Promise<UserLoginStatus> {
    return new Promise<UserLoginStatus>((resolve, reject) => {
      if (this.user) {
        resolve({ user: this.user, loggedIn: true});
        return;
      }

      this.restoreUser()
        .then((user) => {
          if (user) {
            resolve({ user: user, loggedIn: true});
          } else {
            resolve({ user: null, loggedIn: false});
          }
        })
        .catch((error) => {
          localStorage.removeItem(LS_ACCESS_KEY);
          localStorage.removeItem(LS_REFRESH_KEY);

          reject(error)
        });
    });
  }

  private async restoreUser(): Promise<User> {
    let accessToken = localStorage.getItem(LS_ACCESS_KEY);
    let refreshToken = localStorage.getItem(LS_REFRESH_KEY);

    //not authorized
    if (!accessToken) {
      return null;
    }

    //initialize authorization for getting users info (auth required)
    this.apiAccess = new ApiAccess(accessToken, refreshToken, this.localStorageUpdate);
    this.user = new User(null, () => this.apiAccess, null, null);

    let userInfo = await this.storageService.getUserInfo();

    if (Object.keys(userInfo).length !== 0) {
      this.user = new User(userInfo['_uid'], () => this.apiAccess, userInfo['_suggestedInfo'], userInfo);

      return this.user;
    } else {
      throw new Error("User info wasn't found");
    }
  }

  private localStorageUpdate(accessToken: string, refreshToken: string): void {
    localStorage.setItem(LS_ACCESS_KEY, accessToken);
    localStorage.setItem(LS_REFRESH_KEY, refreshToken);
  }

  removeAuth(callback: () => void) {
    let cleaningCallback = () => {
      cleanAuthorizationLocalStorage()
      callback();
    }

    this.backendApi.post('/users/signout', {}).then(cleaningCallback).catch(cleaningCallback);
  }

  getUser(): User {
    if (!this.user) {
      throw new Error('User is null');
    }
    return this.user;
  }

  update(user: User): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (user.projects == null) {
        reject(new Error(`Can't update user without projects:` + JSON.stringify(user)));
      }
      if (user.projects.length != 1) {
        reject(
          new Error(`Can't update user projects ( ` + user.projects.length + `), should be 1` + JSON.stringify(user))
        );
      }
      let userData: any = Marshal.toPureJson(user);
      userData['_project'] = Marshal.toPureJson(user.projects[0]);
      delete userData['_projects'];
      return this.storageService.saveUserInfo(userData).then(resolve);
    });
  }

  sendPasswordReset(email?: string): Promise<void> {
    if (!this.smtpConfigured) {
      throw new Error(
        "SMTP isn't configured on the server. However you could change password by executing 'change_password.sh' from git repository!"
      );
    }

    if (!email) {
      email = this.getUser().email;
    }

    let appPath = ''
    let baseUIPath = getBaseUIPath()
    if (baseUIPath !== undefined){
      appPath = baseUIPath
    }

    return this.backendApi.post('/users/password/reset', {
      email: email,
      callback: concatenateURLs(`${window.location.protocol}//${window.location.host}`, concatenateURLs(appPath, `/reset_password/{{token}}`)),
    }, { noauth: true });
  }

  hasUser(): boolean {
    return !!this.user;
  }

  changePassword(newPassword: any, resetId?: string): Promise<void> {
    return this.backendApi
      .post('/users/password/change', { new_password: newPassword, reset_id: resetId }, { noauth: true } )
      .then((res) => {
        localStorage.removeItem(LS_ACCESS_KEY);
        localStorage.removeItem(LS_REFRESH_KEY);
      });
  }

  //isn't supported (without google authorization)
  async becomeUser(email: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      reject(new Error("becomeUser isn't supported in BackendUserService"));
    });
  }

  getLoginFeatures(): LoginFeatures {
    return { oauth: false, password: true, signupEnabled: false };
  }

  sendLoginLink(email: string): Promise<void> {
    throw new Error('sendLoginLink() is not implemented')
  }

  supportsLoginViaLink(): boolean {
    return false;
  }

  isEmailLoginLink(href: string): boolean {
    throw new Error('isEmailLoginLink() is not implemented');
  }

  loginWithLink(email: string, href: string): Promise<void> {
    throw new Error('loginWithLink() is not implemented');
  }


}
