import { useCallback, useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom"

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

  const setStateWithCallback = useCallback<SetState<T>>((newStateOrLazySetState, callback?) => {
    /**
     * `flushSync` disables state updates batching
     * This is needed to prevent loosing callbacks in case of multiple calls of setStateWithCallback
     * since those callbacks are stored in state
     * */
    ReactDOM.flushSync(() => {
      /** this part works the same as stock setState */
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
    })
  }, [])

  /** Runs the callback once state has changed */
  useEffect(() => {
    ;(async () => {
      await state.callback?.()
    })()
  }, [state])

  return [state.state, setStateWithCallback]
}
