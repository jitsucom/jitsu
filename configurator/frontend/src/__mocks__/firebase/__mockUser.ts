jest.unmock('firebase/app');
import firebase from 'firebase/app';
import { mockTokenInfo } from './_mockTokenInfo';
import { mockUserFields, UserFields } from './_mockUserFields';

export type MockFirebaseUser = Pick<
  firebase.User,
  keyof UserFields | 'getIdTokenResult'
>;

export const mockUser: MockFirebaseUser = {
  ...mockUserFields,
  getIdTokenResult: jest.fn(() => Promise.resolve(mockTokenInfo))
};
