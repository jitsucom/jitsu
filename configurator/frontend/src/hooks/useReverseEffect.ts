import { useEffect } from "react"

/**
 * Works like useEffect, but re-runs only if `reverseDependencies` didn't change.
 * Please, use it only in case of severe need.
 * @param effect sideEffect to run, may return cleanup callback
 * @param reverseDependencies
 */
export const useReverseEffect = (effect: () => Optional<VoidFunction>, reverseDependencies: unknown[]) => {
  let shouldRunUseEffect: boolean = true

  useEffect(() => {
    shouldRunUseEffect = false
  }, [...reverseDependencies])

  useEffect(() => {
    if (shouldRunUseEffect) return effect()
  })
}
