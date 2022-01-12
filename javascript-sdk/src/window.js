/**
 * Checks if global variable 'window' is available. If it's available,
 * code runs in browser environment
 */
import { getLogger } from "./log"

export function isWindowAvailable(warnMsg = undefined) {
  let windowAvailable = !!globalThis.window
  if (!windowAvailable && warnMsg) {
    getLogger().warn(warnMsg);
  }
  return windowAvailable;
}


/**
 * @param msg
 * @return {Window}
 */
export function requireWindow(msg = undefined) {
  if (!isWindowAvailable()) {
    throw new Error(msg || "window' is not available. Seems like this code runs outside browser environment. It shouldn't happen")
  }
  return window;
}



