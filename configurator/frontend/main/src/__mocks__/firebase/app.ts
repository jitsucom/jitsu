// jest.requireActual('firebase');
jest.unmock("firebase/auth")
jest.unmock("firebase/app")
import { FirebaseApp } from "firebase/app"
import firebase from "firebase/auth"
import { mockUser, MockFirebaseUser } from "./__mockUser"

/**
 * need to mock:
 *
 * v firebase.User type
 * v firebase user object with all methods
 * - firebase auth methods: onAuthStateChanged,
 */

type MockFirebaseAuth = Pick<firebase.Auth, "onAuthStateChanged">

const mockFirebase = {
  initializeApp: jest.fn(),
  auth: jest.fn((app?: FirebaseApp): MockFirebaseAuth => {
    return {
      onAuthStateChanged: (callback: (user: MockFirebaseUser) => any): firebase.Unsubscribe => {
        callback(mockUser)
        console.log("user state changed")
        return () => {}
      },
    }
  }),
}

// firebase.auth().onAuthStateChanged = jest.fn((callback: any) => {
//   console.log('firebase mock fired');
//   console.log('callback: ', callback);
//   return null;
// });

// console.log('firebase mock is used');

export default mockFirebase
