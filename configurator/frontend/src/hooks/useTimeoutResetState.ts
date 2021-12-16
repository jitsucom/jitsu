import { isEqual } from "lodash"
import { useEffect, useState } from "react"

/** Allows to set state that will be returned to initial after a timeout */
export const useTimeoutResetState = <T = unknown>(initialState: T, timeoutMs: number): [T, ReactSetState<T>] => {
  const [state, setState] = useState<T>(initialState)
  useEffect(() => {
    let timeout: number | null = null
    if (state !== initialState)
      timeout = window.setTimeout(() => {
        setState(initialState)
      }, timeoutMs)
    return () => {
      if (timeout) window.clearTimeout(timeout)
    }
  }, [state])
  return [state, setState]
}
