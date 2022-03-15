import { useCallback, useState } from "react"

export function useForceUpdate() {
  const [, updateState] = useState<object>()

  return useCallback(() => updateState({}), [])
}

/**
 * @returns callback that triggers the force update. The callback
 * takes an optional key parameter that partially updates the state
 * which allows to target specific force updates in `useEffect` or
 * similar dependency-based hooks.
 *
 * If the key if not specified, hook updates all keys and thus behaves
 * the same as `useforceUpdate` hook
 */
export const useForceUpdateTarget = (): {
  forceUpdatedTargets: UnknownObject
  forceUpdateTheTarget: (key?: string) => void
} => {
  const [state, setState] = useState<UnknownObject>({})

  const forceUpdatedTargets = state
  const forceUpdateTheTarget = useCallback((key?: string) => {
    key
      ? setState(state => ({ ...state, [key]: {} }))
      : setState(state => Object.keys(state).reduce<UnknownObject>((result, key) => ({ ...result, [key]: {} }), {}))
  }, [])

  return {
    forceUpdatedTargets,
    forceUpdateTheTarget,
  }
}
