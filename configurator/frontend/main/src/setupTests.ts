// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
import "@testing-library/jest-dom"
import "@testing-library/jest-dom/extend-expect"
import { LS_ACCESS_KEY, LS_REFRESH_KEY } from "lib/services/UserServiceBackend"

jest.setTimeout(300_000)

jest.mock("monaco-editor")
jest.mock("react-monaco-editor")
jest.mock("antd/lib/message")

if (process.env.FIREBASE_CONFIG) {
  jest.mock("firebase/app")
} else {
  localStorage.setItem(LS_ACCESS_KEY, "dummy_access_token")
  localStorage.setItem(LS_REFRESH_KEY, "dummy_refresh_token")
}

global['matchMedia'] = global['matchMedia'] ||
  function (query) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }
  }
