/**
 * Hook that accepts a value and keeps it consistent between renders.
 * It will return a different value only if comparison (deep) of values shown that it has changed.
 */

import { isEqual } from "lodash"
import { useRef } from "react"

export const useDeepMemo = <T extends {}>(value: T): T => {
  const ref = useRef<T | null>(value) // will use the first passed value on the initial render

  const previousValue = ref.current

  if (value === previousValue) return value

  if (isEqual(value, previousValue)) {
    ref.current = value // helps to avoid deep comparisons on next renders
    return previousValue
  } else {
    ref.current = value
    return value
  }
}
