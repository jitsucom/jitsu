/* eslint-disable */
import Marshal from '../commons/marshalling';

export class Project {
  private readonly _id: string;
  private _name: string;
  private _planId?: string;

  constructor(id: string, name: string) {
    this._id = id;
    this._name = name;
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value;
  }

  get planId(): string {
    return this._planId;
  }

  set planId(value: string) {
    this._planId = value;
  }
}

/**
 * User information that was retried from auth method. Might contain
 * some information that will be usefull for autofill during on-boarding process
 */
export type SuggestedUserInfo = {
  //mandatory: user email (lower-case)
  email: string;
  //user name (Firstname Lastname)
  name?: string;
  //Company name
  companyName?: string;
};

export enum Permission {
  BECOME_OTHER_USER
}

export class User {
  private readonly _apiAccessAccessor: () => ApiAccess;
  private readonly _uid: string;
  private _email: string;
  private _name: string;
  private _projects: Project[] = [];
  private _onboarded = false;
  private readonly _suggestedInfo: SuggestedUserInfo;
  private _emailOptout: boolean = false;
  private _forcePasswordChange: boolean = false;
  private _created: string; //creation date in ISO string

  constructor(uid: string, apiAccessAccessor: () => ApiAccess, suggested: SuggestedUserInfo, data?: any) {
    if (data) {
      let projectSingleton = data._project;
      delete data['_project'];
      Object.assign(this, data);
      if (projectSingleton) {
        this._projects = [Marshal.newKnownInstance(Project, projectSingleton)];
      }
    }
    this._suggestedInfo = { ...suggested };

    //This piece of code is very WEIRD and should be rewritten.
    //The idea to make sure that this and suggestedInfo both has full data
    if (!this._name && this._suggestedInfo.name) {
      this._name = this._suggestedInfo.name;
    }
    if (!this._email && this._suggestedInfo.email) {
      this._email = suggested.email;
    }
    if (!this._suggestedInfo.email && this._email) {
      this._suggestedInfo.email = this._email;
    }
    if (!this._suggestedInfo.name && this._name) {
      this._suggestedInfo.name = this._name;
    }
    if (!this._suggestedInfo.companyName && this.projects && this.projects.length > 0 && this.projects[0].name) {
      this._suggestedInfo.companyName = this.projects[0].name;
    }
    //End of WEIRD code

    this._apiAccessAccessor = apiAccessAccessor;
    this._uid = uid;
  }

  set created(value: Date) {
    this._created = value.toISOString();
  }

  get apiAccess(): ApiAccess {
    return this._apiAccessAccessor();
  }

  get uid(): string {
    return this._uid;
  }

  get onboarded(): boolean {
    return this._onboarded;
  }

  get suggestedInfo(): SuggestedUserInfo {
    return this._suggestedInfo;
  }

  set onboarded(value: boolean) {
    this._onboarded = value;
  }

  get email(): string {
    return this._email;
  }

  set email(newEmail: string) {
    this._email = newEmail;
  }

  get name(): string {
    return this._name;
  }

  get projects(): Project[] {
    return this._projects;
  }

  set name(value: string) {
    this._name = value;
  }

  set projects(value: Project[]) {
    this._projects = value;
  }

  get emailOptout(): boolean {
    return this._emailOptout;
  }

  set emailOptout(value: boolean) {
    this._emailOptout = value;
  }

  get forcePasswordChange(): boolean {
    return this._forcePasswordChange;
  }

  set forcePasswordChange(value: boolean) {
    this._forcePasswordChange = value;
  }

  hasPermission(permission: Permission): boolean {
    return this.email.endsWith('@jitsu.com') || this.email.endsWith('@ksense.io');
  }
}

export type Domain = {
  name: string;
  status: 'pending' | 'verified';
  comment?: string;
};

export class ApiAccess {
  private _accessToken: string;
  private _refreshToken: string;
  private _localStorageUpdateCallback: (accessToken: string, refreshToken: string) => void;

  constructor(
    accessToken: string,
    refreshToken: string,
    localStorageUpdateCallback: (accessToken: string, refreshToken: string) => void
  ) {
    this._accessToken = accessToken;
    this._refreshToken = refreshToken;
    this._localStorageUpdateCallback = localStorageUpdateCallback;
  }

  get accessToken(): string {
    return this._accessToken;
  }

  get refreshToken(): string {
    return this._refreshToken;
  }

  supportRefreshToken(): boolean {
    return this._refreshToken != null;
  }

  updateTokens(accessToken: string, refreshToken: string) {
    this._accessToken = accessToken;
    this._refreshToken = refreshToken;
    this._localStorageUpdateCallback(accessToken, refreshToken);
  }
}
