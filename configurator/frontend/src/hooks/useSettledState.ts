import { useEffect, useState } from "react"

/**
 * Works exactly as setState, but after the state is set it resets the state
 * to the `settleTo` triggering an additional re-render;
 * @param settleTo
 * @returns
 */
export const useSettledState = <S, T>(settleTo: T): [state: S | T, setState: (state: S) => void] => {
  const [state, setState] = useState<S | T>(settleTo)

  useEffect(() => {
    if (state !== settleTo) setState(settleTo)
  }, [state])

  return [state, setState]
}
