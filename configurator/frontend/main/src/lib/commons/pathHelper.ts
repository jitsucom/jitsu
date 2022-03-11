/**
 * Utilities for working with path.
 * Includes few hacks to make configurator work within heroku environment
 */
import { concatenateURLs } from "lib/commons/utils"

const CONFIGURATOR_PREFIX = "/configurator"

export function getBaseUIPath() {
  return window.location.pathname.indexOf(CONFIGURATOR_PREFIX) === 0
    ? CONFIGURATOR_PREFIX
    : process.env.APP_PATH || undefined
}

export const getFullUiPath = () => {
  const appPath = getBaseUIPath() ?? ""
  return concatenateURLs(`${window.location.protocol}//${window.location.host}`, appPath)
}

export function getBackendApiBase(env: Record<string, string>) {
  let backendApiBase = env.BACKEND_API_BASE || `${window.location.protocol}//${window.location.host}`
  if (window.location.pathname.indexOf(CONFIGURATOR_PREFIX) === 0) {
    backendApiBase = concatenateURLs(backendApiBase, CONFIGURATOR_PREFIX)
  }
  return backendApiBase
}
