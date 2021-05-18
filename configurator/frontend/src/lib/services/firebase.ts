/* eslint-disable */
import { ApiAccess, Project, SuggestedUserInfo, User } from './model';
import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import Marshal from '../commons/marshalling';
import { reloadPage } from '../commons/utils';
import {
  BackendApiClient,
  LoginFeatures,
  ServerStorage,
  setDebugInfo,
  UserLoginStatus,
  UserService
} from './ApplicationServices';
import { randomId } from '@util/numbers';

export class FirebaseUserService implements UserService {
  private user?: User;
  private apiAccess: ApiAccess;
  private unregisterAuthObserver: firebase.Unsubscribe;
  private firebaseUser: firebase.User;
  private backendApi: BackendApiClient;
  private readonly storageService: ServerStorage;

  constructor(backendApi: BackendApiClient, storageService: ServerStorage) {
    this.backendApi = backendApi;
    this.storageService = storageService;
  }

  initiateGithubLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      firebase
        .auth()
        .signInWithPopup(new firebase.auth.GithubAuthProvider())
        .then((a) => {
          resolve(a.user.email);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  initiateGoogleLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      firebase
        .auth()
        .signInWithPopup(new firebase.auth.GoogleAuthProvider())
        .then((a) => {
          resolve(a.user.email);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  login(email: string, password: string): Promise<any> {
    let fbLogin = firebase.auth().signInWithEmailAndPassword(email, password);
    return new Promise<any>((resolve, reject) => {
      fbLogin.then((login) => resolve(login)).catch((error) => reject(error));
    });
  }

  public waitForUser(): Promise<UserLoginStatus> {
    setDebugInfo(
      'loginAs',
      async (token) => {
        await firebase.auth().signInWithCustomToken(token);
      },
      false
    );

    let fbUserPromise = new Promise<firebase.User>((resolve, reject) => {
      let unregister = firebase.auth().onAuthStateChanged(
        (user: firebase.User) => {
          if (user) {
            this.firebaseUser = user;
            setDebugInfo('firebaseUser', user);
            setDebugInfo(
              'updateEmail',
              async (email) => {
                try {
                  let updateResult = await user.updateEmail(email);
                  console.log(`Attempt to update email to ${email}. Result`, updateResult);
                } catch (e) {
                  console.log(`Attempt to update email to ${email} failed`, e);
                }
              },
              false
            );
            resolve(user);
          } else {
            resolve(null);
          }
          unregister();
        },
        (error) => {
          reject(error);
        }
      );
    });
    return fbUserPromise.then((user: firebase.User) => {
      if (user != null) {
        return this.restoreUser(user).then((user) => {
          return { user: user, loggedIn: true, loginErrorMessage: null };
        });
      } else {
        return { user: null, loggedIn: false};
      }
    });
  }

  private async restoreUser(fbUser: firebase.User): Promise<User> {
    //initialize authorization
    await this.refreshToken(fbUser, false);
    this.user = new User(fbUser.uid, () => this.apiAccess, {} as SuggestedUserInfo);

    let userInfo: {};
    userInfo = await this.storageService.getUserInfo();
    let suggestedInfo = {
      email: fbUser.email,
      name: fbUser.displayName
    };
    if (Object.keys(userInfo).length !== 0) {
      this.user = new User(fbUser.uid, () => this.apiAccess, suggestedInfo, userInfo);
      //Fix a bug where created date is not set for a new user
      if (!this.user.created) {
        this.user.created = new Date();
        //await this.update(this.user);
      }
      return this.user;
    } else {
      this.user = new User(fbUser.uid, () => this.apiAccess, suggestedInfo);
      this.user.created = new Date();
      //await this.update(this.user);
      return this.user;
    }
  }

  removeAuth(callback: () => void) {
    firebase.auth().signOut().then(callback).catch(callback);
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
    return firebase.auth().sendPasswordResetEmail(email ? email : this.getUser().email);
  }

  async refreshToken(firebaseUser: firebase.User, forceRefresh: boolean) {
    let tokenInfo = await firebaseUser.getIdTokenResult(forceRefresh);
    let expirationMs = new Date(tokenInfo.expirationTime).getTime() - Date.now();
    console.log(
      `Firebase token (force=${forceRefresh}) which expire at ${tokenInfo.expirationTime} in ${expirationMs}ms=(${tokenInfo.expirationTime})`
    );
    this.apiAccess = new ApiAccess(tokenInfo.token, null, () => {});
    setTimeout(() => this.refreshToken(firebaseUser, true), expirationMs / 2);
  }

  async createUser(email: string, password: string): Promise<void> {
    let firebaseUser = await firebase.auth().createUserWithEmailAndPassword(email.trim(), password.trim());

    await this.refreshToken(firebaseUser.user, false);

    let user = new User(
      firebaseUser.user.uid,
      () => this.apiAccess,
      { name: null, email: email },
      {
        _name: name,
        _project: new Project(randomId(), null)
      }
    );

    user.created = new Date();

    this.user = user;

    await this.update(user);
  }

  setupUser(_): Promise<void> {
    throw new Error("Firebase doesn't support initial user setup");
  }

  hasUser(): boolean {
    return !!this.user;
  }

  changePassword(newPassword: any, resetId?: string): Promise<void> {
    return this.firebaseUser.updatePassword(newPassword);
  }

  async becomeUser(email: string): Promise<void> {
    let token = (await this.backendApi.get(`/become?user_id=${email}`))['token'];
    await firebase.auth().signInWithCustomToken(token);
    reloadPage();
  }

  getLoginFeatures(): LoginFeatures {
    return { oauth: true, password: true, signupEnabled: true };
  }
}

export function firebaseInit(config: any) {
  firebase.initializeApp(config);
}
