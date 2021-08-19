import { useEffect, useState } from 'react';
import { Poll } from 'utils/polling';
import useLoader, { Loader } from './useLoader';

type UsePollingOptions = {
  /**
   * Polling interval. Is 1 second by default.
   */
  interval_ms?: number;
  /**
   * Polling timeout after which the poll will cancel itself. Is 5 minutes by default.
   */
  timeout_ms?: number;
};

type UsePollingReturnType<T> = {
  /**
   * Contains an error if the polling failed, otherwise is `null`
   */
  error: Error | null;
  /**
   * Contains the data if polling succeeded, otherwise is `null` (including the case when the pollin was stopped manually).
   */
  data: T | null;
  /**
   * Flag indicating whether the polling is in progress
   */
  isLoading: boolean;
  /**
   * Callback for cancelling the poll manually. Helpful for a clean up when component unmounts.
   */
  cancel: () => void;
};

const defaultOptions: UsePollingOptions = {
  interval_ms: 1000,
  timeout_ms: 5 * 60 * 1000
};

/**
 * React hook for polling the data until the polling condition is satisfied or until it is timed out.
 */
export const usePolling = <T>(
  /**
   * Loader function which returns the data promise. This function will be polled.
   */
  loader: Loader<T>,
  /**
   * Function that receives the polling response data and returns `boolean` indicating whether or not to stop polling.
   */
  condition: (data: T) => boolean,
  /**
   * Polling options such as interval and timeout
   */
  options: UsePollingOptions = {}
): UsePollingReturnType<T> => {
  const a = async () => {
    debugger;
    return null;
  };
  const { interval_ms, timeout_ms } = { ...defaultOptions, ...(options || {}) };
  const [_loader, setLoader] = useState<Loader<T | null>>(null);
  const [cancel, setCancel] = useState<() => void>(() => {});
  const [error, data, , , isLoading] = useLoader<T | null>(_loader || a, [
    _loader
  ]);

  useEffect(() => {
    const poll = new Poll<T>(
      (end, fail) => async () => {
        debugger;
        let response: T;
        try {
          response = await loader();
        } catch (error) {
          fail(error);
        }
        if (condition(response)) {
          end(response);
        }
      },
      interval_ms,
      timeout_ms
    );
    poll.start();
    setLoader(() => poll.wait);
    setCancel(() => poll.cancel);
  }, []);

  return {
    error,
    data,
    isLoading,
    cancel
  };
};
