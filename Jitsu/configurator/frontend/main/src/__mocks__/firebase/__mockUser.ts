jest.unmock("firebase/auth")
import { IdTokenResult, User } from "@firebase/auth"
import { mockTokenInfo } from "./_mockTokenInfo"
import { mockUserFields, UserFields } from "./_mockUserFields"

export type MockFirebaseUser = Pick<User, keyof UserFields | "getIdTokenResult">

export const mockUser: MockFirebaseUser = {
  ...mockUserFields,
  getIdTokenResult: jest.fn(() => Promise.resolve(mockTokenInfo) as any as Promise<IdTokenResult>),
}
