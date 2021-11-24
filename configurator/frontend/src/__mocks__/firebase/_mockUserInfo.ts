jest.unmock("firebase/auth")
import firebase from "firebase/auth"

export type UserInfo = firebase.UserInfo

export const mockUserInfo: UserInfo = {
  uid: "ZMsokTbfoQN85RG2UEh4dFG5Yvr2",
  displayName: "Kirill Taletski",
  photoURL: "https://lh3.googleusercontent.com/a/AATXAJxCklWrcDqBA3QcjveWM_15uj5-hhXmPrxZ9M0=s96-c",
  email: "taletski@jitsu.com",
  phoneNumber: null,
  providerId: "firebase",
}
