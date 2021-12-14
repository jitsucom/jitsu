import { useEffect, useRef, useState } from "react"
import { Poll, PollingSetupCallback } from "utils/polling"

type UsePollingOptions = {
  /**
   * Polling interval. Is 1 second by default.
   */
  interval_ms?: number
  /**
   * Polling timeout after which the poll will cancel itself.
   * Is 5 minutes by default.
   */
  timeout_ms?: number
}

type UsePollingReturnType<T> = {
  /**
   * Contains an error if the polling failed, otherwise is `null`
   */
  error: Error | null
  /**
   * Contains the data if polling succeeded, otherwise is `null`
   * (including the case when the pollin was stopped manually).
   */
  data: T | null
  /**
   * Flag indicating whether the polling is in progress
   */
  isLoading: boolean
  /**
   * Callback for cancelling the poll manually. Helpful for a manual
   * cleanup when component unmounts.
   */
  cancel: VoidFunction
  /**
   * Callback for restarting the poll.
   */
  reload: VoidFunction
}

type PollingHookConfigurator<T = unknown> = {
  configure: () => {
    pollingCallback: PollingSetupCallback<T>
    onBeforePollingStart?: () => void
    onAfterPollingEnd?: () => void
  }
}

const defaultOptions: UsePollingOptions = {
  interval_ms: 1000,
  timeout_ms: 5 * 60 * 1000,
}

/**
 * React hook for polling the data until the polling condition is
 * satisfied or until it is timed out.
 */
export const usePolling = <T>(
  /**
   *
   */
  callbackOrConfigurator: PollingSetupCallback<T> | PollingHookConfigurator<T>,

  /**
   * Polling options such as interval and timeout
   */
  options: UsePollingOptions = {}
): UsePollingReturnType<T> => {
  const pollingHookConfigurator: PollingHookConfigurator<T> =
    "configure" in callbackOrConfigurator
      ? callbackOrConfigurator
      : { configure: () => ({ pollingCallback: callbackOrConfigurator }) }
  const { pollingCallback, onBeforePollingStart, onAfterPollingEnd } = pollingHookConfigurator.configure()
  const { interval_ms, timeout_ms } = { ...defaultOptions, ...(options ?? {}) }
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const cancelCurrentPoll = useRef<Optional<VoidFunction>>(null)
  const outdateCurrentPoll = useRef<Optional<VoidFunction>>(null)

  const poll = async () => {
    setIsLoading(true)
    setError(null)

    let blockStateUpdates: boolean = false
    outdateCurrentPoll.current = () => {
      blockStateUpdates = true
    }

    try {
      const poll = new Poll<T>(pollingCallback, interval_ms, timeout_ms)
      onBeforePollingStart?.()
      poll.start()

      cancelCurrentPoll.current = poll.cancel

      const result = await poll.wait()
      !blockStateUpdates && setData(result)
    } catch (e) {
      let error = e
      if (!(error instanceof Error)) {
        error = new Error(e)
      }
      !blockStateUpdates && setError(error)
    } finally {
      !blockStateUpdates && setIsLoading(false)
      onAfterPollingEnd?.()
    }
  }

  const cancel = () => {
    outdateCurrentPoll.current?.()
    cancelCurrentPoll.current?.()
  }

  const reload = () => {
    cancel()
    poll()
  }

  useEffect(() => {
    cancel()
    poll()
  }, [])

  /**
   * Cleans up unfinished poll when component is unmounted;
   */
  useEffect(() => cancel, [])

  return {
    error,
    data,
    isLoading,
    cancel,
    reload,
  }
}
