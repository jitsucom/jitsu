import { useCallback, useEffect, useRef } from "react"
import { debounce } from "lodash"
import type { DebouncedFunc } from "lodash"
import { useIsMounted } from "./useIsMounted"

export const useDebouncedCallback = <T extends (...args: any[]) => unknown>(
  callback: T,
  delay: number
): DebouncedFunc<T> => {
  // ...
  const inputsRef = useRef({ callback, delay })
  const isMounted = useIsMounted()

  useEffect(() => {
    inputsRef.current = { callback, delay }
  }, [callback, delay])

  return useCallback<DebouncedFunc<T>>(
    debounce<T>(
      ((...args) => {
        // Debounce is an async callback. Cancel it, if in the meanwhile
        // (1) component has been unmounted (see isMounted in snippet)
        // (2) delay has changed
        if (inputsRef.current.delay === delay && isMounted()) inputsRef.current.callback(...args)
      }) as T,
      delay
    ),
    [delay, debounce]
  )
}
