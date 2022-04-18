import { UserService } from "./UserService"
import { merge } from "lodash"

export interface UserSettingsService {
  set(data: { [key: string]: any }): void

  get(settingName?: string): any
}

export class UserSettingsLocalService implements UserSettingsService {
  private _keyNamePrefix = "userSettings"
  private _userService: UserService

  constructor(userService: UserService) {
    this._userService = userService
  }

  private get keyName() {
    return `${this._keyNamePrefix}_${this._userService?.getUser()?.id}`
  }

  set(data: { [key: string]: any }): void {
    let settings = this.get()

    if (settings !== null) {
      settings = merge(settings, data)
    }

    localStorage.setItem(this.keyName, JSON.stringify(settings))
  }

  get(settingName?: string) {
    let json: string = localStorage.getItem(this.keyName)
    let data: any

    if (json !== null) {
      try {
        data = JSON.parse(json)
      } catch {
        return null
      }
    }

    if (settingName) {
      data = data[settingName] ?? null
    }

    return data
  }
}
