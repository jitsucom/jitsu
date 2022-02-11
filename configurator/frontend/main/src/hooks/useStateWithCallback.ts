import { useCallback, useEffect, useState } from "react"

type NewStateOrLazySetState<T> = T | ((prevState: T) => T)
type Callback = () => unknown | Promise<unknown>
type SetState<T> = (newStateOrLazySetState: NewStateOrLazySetState<T>, callback?: Callback) => void

type State<T> = {
  state: T
  callback?: Callback
}

/**
 * Works the same as a regular `useState`, but allows to pass a callback
 * as a second argument of `setState`. The callback will run once the
 * state was updated.
 *
 * Note: this implementation does NOT support batching of state updates.
 * Use this hook only if you are sure that sequential updates won't slow down your UI.
 * @param initialState
 * @returns
 */
export const useStateWithCallback = <T = any>(initialState: T): [T, SetState<T>] => {
  const [state, setState] = useState<State<T>>({
    state: initialState,
  })

  const setStateWithCallback = useCallback<SetState<T>>(async (newStateOrLazySetState, callback?) => {
    /**
     * `flushSync` disables state updates batching.
     * This might be needed to prevent loosing callbacks in case of multiple calls of setStateWithCallback
     * since those callbacks are stored in state.
     *
     * The problem with flushSync is that React can not flush during the rendering
     * This means setStateWithCallback can not be called in the lifecycle methods -- react will throw warnings to console.
     *
     * Remove this code and comment later on if this proves to work fine without flushing.
     * */

    /** this part works the same as an ordinary setState */
    if (newStateOrLazySetState instanceof Function) {
      const lazySetState = newStateOrLazySetState
      setState(prev => {
        return {
          state: lazySetState(prev.state),
          callback,
        }
      })
    } else {
      const newState = newStateOrLazySetState
      setState({
        state: newState,
        callback,
      })
    }
  }, [])

  /** Runs the callback once state has changed */
  useEffect(() => {
    ;(async () => {
      await state.callback?.()
    })()
  }, [state])

  return [state.state, setStateWithCallback]
}
